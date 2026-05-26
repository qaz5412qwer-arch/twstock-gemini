export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 未設定，請至 Vercel 後台填寫環境變數。' });

  const { market_status, foreign_investment, style, risk, notes, maxTokens } = req.body || {};

  // 調整提示詞：精準固定為 3 檔，減少字數避免爆 Token
  const prompt = `
請根據以下台股市場背景與投資偏好，挑選並推薦「精準 3 檔」符合條件的台股個股，並給出具體的投資策略：
1. 大盤走勢：${market_status || '未指定'}
2. 外資動向：${foreign_investment || '未指定'}
3. 選股風格：${style || '動能突破型（短線）'}
4. 風險承受度：${risk || '穩健'}
5. 特殊事件/盤前資訊：${notes || '無'}

請嚴格依照下方的 JSON 陣列格式回傳資料，不可包含任何 Markdown 標記、註解或客套話。
必須確保每個欄位名稱（如 name, id, price）完全與範例一致：

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
            maxOutputTokens: maxTokens || 2500, // 稍微拉高最大 Token 限制
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

      // 基礎清洗
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

      const arrStart = text.indexOf('[');
      const arrEnd = text.lastIndexOf(']');
      
      if (arrStart !== -1) {
        if (arrEnd > arrStart) {
          text = text.slice(arrStart, arrEnd + 1);
        } else {
          // 💡 核心防禦：如果找到了開頭 [ 但沒有結尾 ]，說明字數被切斷了，自動在結尾補上大括號與中括號
          text = text.slice(arrStart);
          if (!text.endsWith(']')) {
            // 嘗試自動封閉未完成的 JSON 結構
            if (text.endsWith('}')) text += ']';
            else if (text.endsWith('"') || text.endsWith('0') || text.endsWith('1') || text.endsWith('2') || text.endsWith('3') || text.endsWith('4') || text.endsWith('5') || text.endsWith('6') || text.endsWith('7') || text.endsWith('8') || text.endsWith('9')) text += '}]';
            else text += '"}]';
          }
        }
      }

      text = text.trim();

      try {
        const parsedData = JSON.parse(text); 
        return res.status(200).json(parsedData); 
      } catch (e) {
        // ⭐ 如果自動補齊後依舊無法解析，交給下一個模型重新挑戰
        lastError = `模型 ${model} 的 JSON 依然殘缺。錯誤: ${e.message}。原始文字末段: ${text.slice(-30)}`;
        continue;
      }

    } catch (err) {
      lastError = `程式異常 (${model}): ${err.message}`;
      continue;
    }
  }

  return res.status(500).json({
    error: `所有備用模型皆已嘗試，但皆因額度用光或結構殘缺而失敗。\n最後攔截到的錯誤：${lastError}`
  });
}
