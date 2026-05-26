export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 未設定' });

  const { prompt, maxTokens } = req.body || {};
  if (!prompt) return res.status(400).json({ error: '缺少 prompt' });

  // 調整順序：將最新、最省 Token 且不易爆配額的 3.5-flash 放最前面
  // 移除相容性低的 lite 避免浪費 Vercel 珍貴的 10 秒時間
  const models = [
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
          // 在 Prompt 後方加上結構化提示，雙重保險
          contents: [{ parts: [{ text: prompt + "\n\n請務必、嚴格以 JSON 格式回傳，不要包含任何 Markdown 語法或客套話。" }] }],
          generationConfig: {
            maxOutputTokens: maxTokens || 3000,
            temperature: 0.2, // 降低溫度讓 AI 輸出結構更嚴謹、不胡言亂語
            responseMimeType: "application/json" // ⭐ 核心優化：直接要求 Gemini 輸出純 JSON 格式
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

      // 基礎清理：只移除可能意外夾帶的 Markdown 標記，不破壞內部換行
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

      // 安全截取：精準保留 JSON 陣列或物件的主體內容，拋棄前後可能夾帶的雜質
      const arrStart = text.indexOf('[');
      const arrEnd = text.lastIndexOf(']');
      const objStart = text.indexOf('{');
      const objEnd = text.lastIndexOf('}');

      if (arrStart !== -1 && arrEnd > arrStart) {
        text = text.slice(arrStart, arrEnd + 1);
      } else if (objStart !== -1 && objEnd > objStart) {
        text = text.slice(objStart, objEnd + 1);
      }

      // ⭐ 驗證機制：先在後端嘗試解析，確保格式百分之百健全
      try {
        JSON.parse(text); 
      } catch (e) {
        // 如果 JSON 在半路斷掉（例如超時），則紀錄錯誤並跳過換下一個模型試試看
        lastError = `JSON 格式不完整 (解析失敗): ${e.message}`;
        continue;
      }

      // 完全沒問題，回傳給前端 Streamlit
      return res.status(200).json({ text, model });

    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  // 走到這裡代表所有模型都失敗了
  return res.status(429).json({
    error: `所有模型額度已用完，或因 Vercel 免費版 10 秒超時限制。請重新整理或至 Google AI Studio 檢查金鑰狀態。\n\n最後錯誤訊息：${lastError}`
  });
}
