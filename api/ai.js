export default async function handler(req, res) {
  // 設定 CORS 標頭
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 未設定，請至 Vercel 後台填寫環境變數。' });

  const { prompt, maxTokens } = req.body || {};
  if (!prompt) return res.status(400).json({ error: '缺少 prompt' });

  // 調整順序：2026年首選最新主力 gemini-3.5-flash，Token 用量最小且速度最快
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
          contents: [{ parts: [{ text: prompt + "\n\n請嚴格以 JSON 格式回傳，不可包含任何 Markdown 標記、註解或客套話。" }] }],
          generationConfig: {
            maxOutputTokens: maxTokens || 2000,
            temperature: 0.1,             // 降低溫度，強迫 AI 嚴格遵循結構，拒絕胡言亂語
            responseMimeType: "application/json" // ⭐ 核心優化：直接要求 Gemini 輸出標準 JSON，不帶任何雜質
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const msg = (data && data.error && data.error.message) ? data.error.message : JSON.stringify(data);
        // 如果是配額爆了，記錄錯誤並切換到下一個模型
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

      if (!text) { lastError = 'AI 回傳內容空白'; continue; }

      // 基礎清洗：移除任何可能意外夾帶的 ```json 標記
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

      // 安全截取：精準擷取外層的大括號 {} 或 中括號 []
      const arrStart = text.indexOf('[');
      const arrEnd = text.lastIndexOf(']');
      const objStart = text.indexOf('{');
      const objEnd = text.lastIndexOf('}');

      if (arrStart !== -1 && arrEnd > arrStart) {
        text = text.slice(arrStart, arrEnd + 1);
      } else if (objStart !== -1 && objEnd > objStart) {
        text = text.slice(objStart, objEnd + 1);
      }

      // ⭐ 格式安全檢查：在後端先進行 JSON 解析測試
      try {
        JSON.parse(text); 
      } catch (e) {
        // 如果此模型的 JSON 格式損壞，丟給下一個模型嘗試處理
        lastError = `JSON 結構異常: ${e.message}`;
        continue;
      }

      // 格式完全正確，回傳資料與使用的模型名稱
      return res.status(200).json({ text, model });

    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  // 若輪詢完所有模型都失敗，則輸出最終錯誤
  return res.status(500).json({
    error: `選股系統處理失敗。原因可能是 API 限流、資料過大或 Vercel 平台超時。\n詳細錯誤：${lastError}`
  });
}
