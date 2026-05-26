# 台股 AI 選股系統（Gemini 版 · 完全免費）

## 部署步驟（約 5 分鐘）

### 步驟 1：取得免費 Gemini API Key
1. 前往 https://aistudio.google.com
2. 用 Google 帳號登入
3. 點左側「Get API Key」→「Create API Key」
4. 複製 Key（格式為 AIza...）

### 步驟 2：上傳到 GitHub
1. 前往 https://github.com，登入後點「New repository」
2. 取名（例如 tw-stock-ai），設為 Public，點「Create」
3. 點「uploading an existing file」，把這個資料夾所有檔案上傳
4. 點「Commit changes」

### 步驟 3：部署到 Vercel
1. 前往 https://vercel.com，用 GitHub 帳號登入
2. 點「Add New Project」→ 選剛才的 repository
3. Framework Preset 選「Other」，Root Directory 不用改
4. 點「Deploy」

### 步驟 4：設定 Gemini API Key
1. 部署完成後，進入專案頁面
2. 點上方「Settings」→ 左側「Environment Variables」
3. 新增變數：
   - Name：GEMINI_API_KEY
   - Value：貼上剛才複製的 Key
4. 點「Save」
5. 回到「Deployments」→「Redeploy」

### 完成！
Vercel 給你的網址（例如 tw-stock-ai.vercel.app）分享給任何人，完全免費使用。

## 檔案結構
```
twstock-gemini/
├── api/
│   └── ai.js          # 後端 proxy（轉發到 Gemini API）
├── public/
│   └── index.html     # 前端網頁
├── vercel.json        # Vercel 設定
└── README.md
```

## 費用
- Vercel 主機：免費
- Gemini API：免費（每分鐘 15 次請求，每天 1500 次，個人使用完全夠用）
- 對方使用：完全免費，不需要帳號
