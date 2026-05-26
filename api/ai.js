export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 未設定，請至 Vercel 後台填寫環境變數。' });

  const input = req.body || {};
  
  // 💡 1. 動態捕捉前端的「價格上限」
  const limitPrice = input.price_limit || input.max_price || input.priceLimit || input.price || 100;

  // 💡 2. 徹底修正：動態捕捉前端的「選股數量」變數，不再鎖死 3 檔！（預設值給 3 作為保底）
  const stockCount = input.stock_count || input.count || input.num_stocks || input.quantity || input.limit || input.stockCount || input.counts || 3;

  // 提示詞：完全交由變數控制數量
  const prompt = `
請根據以下條件，推薦精準 ${stockCount} 檔符合條件的台股個股，並給出具體投資策略：
1. 大盤走勢：${input.market_status || '未指定'}
2. 外資動向：${input.foreign_investment || '未指定'}
3. 選股風格：${input.style || '動能突破型（短線）'}
4. 風險承受度：${input.risk || '穩健'}
5. 特殊事件/盤前資訊：${input.notes || '無'}
6. ⚠️【核心價格限制】：所選個股的「目前價格」絕對必須低於 ${limitPrice} 元！
7. ⚠️【核心數量限制】：必須精準推薦 ${stockCount} 檔個股，不能多也不能少！

請嚴格依照下方的 JSON 陣列格式回傳資料，不要包含任何 Markdown 標記、註解或客套話：

[
  {
    "id": "2330",
    "name": "台積電",
    "market": "半導體",
    "price": "90",
    "targetPrice": "95",
    "momentum": "強勢突破",
    "score": "90",
    "reason": "符合低價動能突破條件與外資大量買超條件。",
    "strategy": "於股價站穩突破點後進場，設定移動停損點。",
    "risk": "注意低價股流動性及板塊輪動修正壓力。"
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
            maxOutputTokens: 3500, // 放大 Token 容許量，確保自訂高數量選股時不會斷頭
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
        let parsedArray = JSON.parse(text);
        if (!Array.isArray(parsedArray)) {
          if (typeof parsedArray === 'object' && parsedArray !== null) {
            parsedArray = [parsedArray];
          } else {
            parsedArray = [];
          }
        }

        // 後端 JavaScript 暴力複製所有可能的欄位變體，保證解鎖估價、代號等所有前端表格
        const completelyFilledArray = parsedArray.map(item => {
          const p = item.price || item.currentPrice || item.current_price || "0";
          const t = item.targetPrice || item.target_price || item.valuation || item.target || "0";
          const idVal = item.id || item.code || item.stockId || "0000";
          const nameVal = item.name || item.stockName || "未知";
          const marketVal = item.market || item.industry || item.sector || "其他";

          return {
            ...item,
            id: idVal, code: idVal, stockId: idVal, stock_id: idVal, stockCode: idVal, stock_code: idVal, symbol: idVal,
            name: nameVal, stockName: nameVal, stock_name: nameVal,
            market: marketVal, sector: marketVal, category: marketVal, industry: marketVal,
            price: p, currentPrice: p, current_price: p, stockPrice: p, stock_price: p,
            valuation: t, targetPrice: t, target_price: t, estimatePrice: t, estimate_price: t,
            estimatedPrice: t, estimated_price: t, target: t, estimate: t, fairValue: t, fair_value: t,
            predictedPrice: t, predicted_price: t, expectedPrice: t, expected_price: t, aiPrice: t, ai_price: t,
            priceTarget: t, price_target: t, intrinsicValue: t, intrinsic_value: t, suggestedPrice: t, suggested_price: t,
            predict: t, prediction: t, predictPrice: t, predict_price: t, futurePrice: t, future_price: t
          };
        });

        return res.status(200).json({ text: JSON.stringify(completelyFilledArray), model: model });

      } catch (jsonErr) {
        lastError = `模型 ${model} 的 JSON 在後端驗證失敗: ${jsonErr.message}`;
        continue;
      }

    } catch (err) {
      lastError = `程式異常 (${model}): ${err.message}`;
      continue;
    }
  }

  return res.status(500).json({
    error: `選股處理失敗。詳細原因：${lastError}`
  });
}
