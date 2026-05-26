export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 未設定，請至 Vercel 後台填寫環境變數。' });

  const input = req.body || {};
  const limitPrice = input.price_limit || input.max_price || input.priceLimit || input.price || 100;

  // 提示詞優化：加入現實股價常識約束，避免大立光變 98 元的笑話
  const prompt = `
請根據以下條件，推薦 3 檔符合條件的台股個股，並給出具體投資策略：
1. 大盤走勢：${input.market_status || '未指定'}
2. 外資動向：${input.foreign_investment || '未指定'}
3. 選股風格：${input.style || '動能突破型（短線）'}
4. 風險承受度：${input.risk || '穩健'}
5. 特殊事件/盤前資訊：${input.notes || '無'}
6. ⚠️【核心硬性價格限制】：所選個股的「目前真實價格」絕對必須低於 ${limitPrice} 元！
   【重要常識】：請優先挑選市場上原本就低於此價格的中低價概念股或金融股。絕對不要把大立光、台積電、聯發科、聯詠等幾百幾千元的高價股硬編成幾十元回傳！

請嚴格依照下方的 JSON 陣列格式回傳資料，不要包含任何 Markdown 標記、註解或客套話。
為了完美解鎖前端表格的【估價】與所有欄位，請必須幫我把每一個股票物件「完整填滿」以下所有重複變數：

[
  {
    "id": "2330",
    "code": "2330",
    "stockId": "2330",
    "stock_id": "2330",
    "stockCode": "2330",
    "stock_code": "2330",

    "name": "台積電",
    "stockName": "台積電",
    "stock_name": "台積電",

    "market": "半導體",
    "sector": "半導體",
    "category": "半導體",
    "industry": "半導體",

    "price": "90",
    "currentPrice": "90",
    "current_price": "90",

    "valuation": "95",
    "targetPrice": "95",
    "target_price": "95",
    "estimatePrice": "95",
    "estimate_price": "95",
    "estimatedPrice": "95",
    "estimated_price": "95",
    "target": "95",
    "estimate": "95",
    "fairValue": "95",
    "fair_value": "95",
    "predictedPrice": "95",
    "predicted_price": "95",
    "valuationPrice": "95",
    "valuation_price": "95",

    "momentum": "強勢突破",
    "score": "90",
    "reason": "符合低價動能突破條件。",
    "strategy": "於股價站穩突破點後進場，設定移動停損點。",
    "risk": "注意低價股流動性修正壓力。"
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

      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

      const arrStart = text.indexOf('[');
      const arrEnd = text.lastIndexOf(']');
      if (arrStart !== -1 && arrEnd > arrStart) {
        text = text.slice(arrStart, arrEnd + 1);
      }

      text = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 

      try {
        JSON.parse(text);
      } catch (jsonErr) {
        lastError = `模型 ${model} 的 JSON 在後端驗證失敗: ${jsonErr.message}`;
        continue;
      }

      return res.status(200).json({ text: text, model: model });

    } catch (err) {
      lastError = `程式異常 (${model}): ${err.message}`;
      continue;
    }
  }

  return res.status(500).json({
    error: `選股處理失敗。詳細原因：${lastError}`
  });
}
