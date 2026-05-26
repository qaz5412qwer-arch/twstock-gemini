export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 未設定，請至 Vercel 後台填寫環境變數。' });

  // 接收前端 Streamlit 的選股設定欄位
  const { market_status, foreign_investment, style, risk, notes, maxTokens } = req.body || {};

  // 自動組合成完整的 AI 提示詞
  const prompt = `
請根據以下台股市場背景與投資偏好，挑選並推薦 3~5 檔符合條件的台股個股，並給出具體的投資策略：
1. 大盤走勢：${market_status || '未指定'}
2. 外資動向：${foreign_investment || '未指定'}
3. 選股風格：${style || '動能突破型（短線）'}
4. 風險承受度：${risk || '穩健'}
5. 特殊事件/盤前資訊：${notes || '無'}

請嚴格以 JSON 格式回傳，不可包含任何 Markdown 標記、註解或客套話。
`;

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
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: maxTokens || 2000,
            temperature: 0.1,
            responseMimeType: "application/json"
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

      if (!text) { lastError = 'AI 回傳內容空白'; continue; }

      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

      const arrStart = text.indexOf('[');
      const arrEnd = text.lastIndexOf(']');
      const objStart = text.indexOf('{');
      const objEnd = text.lastIndexOf('}');

      if (arrStart !== -1 && arrEnd > arrStart) {
        text = text.slice(arrStart, arrEnd + 1);
      } else if (objStart !== -1 && objEnd > objStart) {
        text = text.slice(objStart, objEnd + 1);
      }

      try {
        JSON.parse(text); 
      } catch (e) {
        lastError = `JSON 結構異常: ${e.message}`;
        continue;
      }

      return res.status(200).json({ text, model });

    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  return res.status(500).json({
    error: `選股系統處理失敗。原因可能是 API 限流、資料過大或 Vercel 平台超時。\n詳細錯誤：${lastError}`
  });
}
