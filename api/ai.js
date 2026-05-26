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

  // 自動組合成完整的 AI 提示詞，並嚴格約束欄位名稱符合前端預期
  const prompt = `
請根據以下台股市場背景與投資偏好，挑選並推薦 3~5 檔符合條件的台股個股，並給出具體的投資策略：
1. 大盤走勢：${market_status || '未指定'}
2. 外資動向：${foreign_investment || '未指定'}
3. 選股風格：${style || '動能突破型（短線）'}
4. 風險承受度：${risk || '穩健'}
5. 特殊事件/盤前資訊：${notes || '無'}

請嚴格依照下方的 JSON 陣列格式回傳資料，不可包含任何 Markdown 標記（如 \`\`\`json）、註解或客套話。
必須確保每個欄位名稱（如 name, id, price）完全與範例一致，以便網頁正確解析：

[
  {
    "id": "2330",
    "name": "台積電",
    "market": "半導體",
    "price": 900,
    "valuation": 950,
    "momentum": "強勢突破",
    "score": 90,
    "reason": "符合動能突破與外資大量買超條件，基本面強勁。",
    "strategy": "於突破前波高點時進場，設定跌破5日均線為停損點，目標價設為估價。",
    "risk": "高基期修正壓力及地緣政治風險。"
  }
]
`;

  // 2026 官方最嚴謹標準代號
  const models = [
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.5-flash'
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
        lastError = `模型 ${model} 失敗: ${msg}`;
        continue; 
      }

      let text = (
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] &&
        data.candidates[0].content.parts[0].text
      ) || '';

      if (!text) { lastError = `模型 ${model} 回傳內容空白`; continue; }

      // 清洗 Markdown 標籤
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

      // ⭐ 核心優化：直接回傳解析後的 JSON 物件/陣列，不再套上 { text, model } 的外殼
      try {
        const parsedData = JSON.parse(text); 
        return res.status(200).json(parsedData); // ✅ 這樣前端拿到的就是純粹的股票資料陣列了！
      } catch (e) {
        lastError = `模型 ${model} 的 JSON 結構異常: ${e.message}`;
        continue;
      }

    } catch (err) {
      lastError = `程式異常 (${model}): ${err.message}`;
      continue;
    }
  }

  return res.status(500).json({
    error: `所有備用模型皆已嘗試，但皆因額度用光或超時而失敗。\n最後攔截到的錯誤：${lastError}`
  });
}
