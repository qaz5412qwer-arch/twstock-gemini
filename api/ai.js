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

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
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
    if (!response.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : JSON.stringify(data);
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

    if (!text) return res.status(500).json({ error: 'Gemini 回傳空白內容' });
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
};

