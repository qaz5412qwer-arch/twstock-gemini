module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 未設定' });

  const { prompt, maxTokens } = req.body || {};
  if (!prompt) return res.status(400).json({ error: '缺少 prompt' });

  // Try models in order until one works
  const models = [
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-8b',
    'gemini-1.5-flash-latest',
    'gemini-pro',
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
            maxOutputTokens: maxTokens || 2000,
            temperature: 0.5,
          },
        }),
      });

      const data = await response.json();

      // If quota exceeded, try next model
      if (!response.ok) {
        const msg = (data && data.error && data.error.message) ? data.error.message : JSON.stringify(data);
        if (msg.includes('quota') || msg.includes('Quota') || msg.includes('RESOURCE_EXHAUSTED') || response.status === 429) {
          lastError = msg;
          continue; // try next model
        }
        return res.status(response.status).json({ error: msg });
      }

      const text = (
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] &&
        data.candidates[0].content.parts[0].text
      ) || '';

      if (!text) {
        lastError = '回傳空白';
        continue;
      }

      return res.status(200).json({ text, model });

    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  // All models failed
  return res.status(429).json({ 
    error: `所有模型額度已用完。請至 https://aistudio.google.com 確認帳號狀態或升級方案。\n\n詳細錯誤：${lastError}`
  });
};
