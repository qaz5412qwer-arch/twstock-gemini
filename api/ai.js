export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 未設定，請至 Vercel 後台填寫環境變數。' });

  const { market_status, foreign_investment, style, risk, notes } = req.body || {};

 const prompt = `
請根據以下條件，推薦 3 檔符合條件的台股個股，並給出具體投資策略：
1. 大盤走勢：${market_status || '未指定'}
2. 外資動向：${foreign_investment || '未指定'}
3. 選股風格：${style || '動能突破型（短線）'}
4. 風險承受度：${risk || '穩健'}
5. 特殊事件/盤前資訊：${notes || '無'}

請嚴格依照下方的 JSON 陣列格式回傳資料，不要包含任何 Markdown 標記、註解或客套話。
為了相容前端所有可能的欄位命名，請幫我把每一個股票物件「完整填滿」以下所有重複的欄位（包含中文與英文變體）：

[
  {
    "id": "2330",
    "stock_id": "2330",
    "code": "2330",
    "symbol": "2330",
    "股票代號": "2330",
    "代號": "2330",

    "name": "台積電",
    "stock_name": "台積電",
    "股票名稱": "台積電",
    "名稱": "台積電",

    "market": "半導體",
    "category": "半導體",
    "sector": "半導體",
    "板塊": "半導體",
    "產業": "半導體",

    "price": "900",
    "current_price": "900",
    "現價": "900",

    "valuation": "950",
    "target_price": "950",
    "estimate_price": "950",
    "估價": "950",

    "momentum": "強勢突破",
    "score": "90",
    "reason": "符合動能突破與外資大量買超條件。",
    "strategy": "於突破前波高點時進場，設定跌破5日均線為停損點。",
    "risk": "高基期修正壓力及地緣政治風險。"
  }
]
`;

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
            maxOutputTokens: 3000,
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

      // 🛑 終極防禦：移除所有搞事的換行符、標記、以及可能破壞 JSON 結構的控制字元
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

      const arrStart = text.indexOf('[');
      const arrEnd = text.lastIndexOf(']');
      if (arrStart !== -1 && arrEnd > arrStart) {
        text = text.slice(arrStart, arrEnd + 1);
      }

      // 🛑 字串深度清洗：把真正會導致 "Unexpected end of JSON input" 的不合法控制字元（如斷行、縮排）強制處理掉
      text = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 

      // 在後端進行最後一次嚴格自我檢驗，如果連後端都 parse 失敗，直接換下一個模型，絕不把垃圾資料丟給前端
      try {
        JSON.parse(text);
      } catch (jsonErr) {
        lastError = `模型 ${model} 的 JSON 在後端驗證失敗: ${jsonErr.message}`;
        continue;
      }

      // 保證乾淨後，包成前端期待的格式回傳
      return res.status(200).json({ text: text, model: model });

    } catch (err) {
      lastError = `程式異常 (${model}): ${err.message}`;
      continue;
    }
  }

  return res.status(500).json({
    error: `所有備用模型皆已嘗試，但皆因額度用光或結構殘缺而失敗。\n最後攔截到的錯誤：${lastError}`
  });
}
