res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 未設定' });

  const { prompt, maxTokens } = req.body || {};
  if (!prompt) return res.status(400).json({ error: '缺少 prompt' });

  const models = [
    'gemini-2.0-flash-lite',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    
  ];

  let lastError = '';

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: maxTokens || 3000,
            temperature: 0.3,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const msg = (data && data.error && data.error.message) ? data.error.message : JSON.stringify(data);
        if (msg.includes('quota') || msg.includes('Quota') || msg.includes('RESOURCE_EXHAUSTED') || response.status === 429) {
          lastError = msg;
          continue;
        }
        return res.status(response.status).json({ error: msg });
      }

      let text = (
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] &&
        data.candidates[0].content.parts[0].text
      ) || '';

      if (!text) { lastError = '回傳空白'; continue; }

      // Aggressively clean non-JSON content
      text = text
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .replace(/^\s*\*\s+/gm, '')
        .replace(/\*\*/g, '')
        .trim();

      // Extract only the JSON array or object, discard everything else
      const arrStart = text.indexOf('[');
      const arrEnd = text.lastIndexOf(']');
      const objStart = text.indexOf('{');
      const objEnd = text.lastIndexOf('}');

      if (arrStart !== -1 && arrEnd > arrStart) {
        text = text.slice(arrStart, arrEnd + 1);
      } else if (objStart !== -1 && objEnd > objStart) {
        text = text.slice(objStart, objEnd + 1);
      }

      // Remove any lines that are not part of JSON (rating/comment lines like "(4) - OK")
      // Keep only lines that look like JSON
      const lines = text.split('\n');
      const jsonLines = lines.filter(line => {
        const t = line.trim();
        if (!t) return true; // keep empty lines
        // Skip lines that look like ratings/comments (e.g. "(4) - OK", "- 理由")
        if (/^\s*\([\d]+\)\s*-/.test(t)) return false;
        if (/^[^\[{\]}"',:\d\-]/.test(t) && !t.startsWith('"')) return false;
        return true;
      });
      text = jsonLines.join('\n');

      return res.status(200).json({ text, model });

    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  return res.status(429).json({
    error: `所有模型額度已用完，請至 https://aistudio.google.com 確認帳號或升級方案。\n\n${lastError}`
  });
};

