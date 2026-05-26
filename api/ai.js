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

  // ⭐ 超強大備用軍團：依據你主機後台有的模型，全部拉進來輪詢
  const models = [
    'gemini-3.5-flash',     // 第一順位：最新最聰明（你已用 18 次）
    'gemini-2.5-flash',     // 第二順位：穩定的 2.5 世代（獨立 20 次額度）
    'gemini-1.5-flash',     // 第三順位：老牌經典款（獨立 1500 次大額度備用）
    'gemini-2.0-flash-exp', // 第四順位：2.0 的標準實驗版（單獨計費區）
    'gemini-3.1-flash'      // 第五順位：3.1 世代輕量版（防禦備用）
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

      // ⭐ 核心修正：不管是限流、超額、還是任何錯誤，一律無條件 continue 跳下一個模型！
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
        lastError = `模型 ${model} 的 JSON 結構異常: ${e.message}`;
        continue;
      }

      // 只要成功一個，就直接回傳前端並中斷迴圈
      return res.status(200).json({ text, model });

    } catch (err) {
      lastError = `程式異常 (${model}): ${err.message}`;
      continue;
    }
  }

  // 如果 5 個模型全部輪完了都死掉，才噴 500
  return res.status(500).json({
    error: `所有備用模型皆已嘗試，但皆因額度用光或超時而失敗。\n最後攔截到的錯誤：${lastError}`
  });
}
