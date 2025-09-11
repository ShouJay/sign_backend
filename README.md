# 簽名後端服務 - 啟動指南

這是一個基於 Node.js 的簽名後端服務，提供管理員和簽名者兩個介面。

## 系統需求

- Node.js (建議版本 14 或以上)
- npm (通常隨 Node.js 一起安裝)

## 快速啟動步驟

### 1. 檢查 Node.js 是否已安裝
```bash
node --version
npm --version
```

如果沒有安裝 Node.js，請到 [nodejs.org](https://nodejs.org/) 下載並安裝。

### 2. 安裝依賴套件
在專案資料夾中執行：
```bash
npm install
```

### 3. 啟動服務器
```bash
npm start
```

### 4. 訪問應用程式
服務器啟動後，您可以在瀏覽器中訪問：

- **管理員頁面**: http://localhost:3000/admin.html
- **簽名者頁面**: http://localhost:3000/signer.html

## 詳細說明

### 專案結構
```
sign_backend/
├── server.js          # 主服務器檔案
├── admin.html         # 管理員介面
├── signer.html        # 簽名者介面
├── package.json       # 專案配置和依賴
├── data.db           # SQLite 資料庫（自動建立）
└── node_modules/     # 依賴套件（npm install 後產生）
```

### 主要功能
- **用戶註冊/登入系統**
- **建立簽名活動房間**
- **即時簽名協作**
- **QR Code 生成**
- **圖片上傳功能**

### API 端點
- `POST /api/register` - 用戶註冊
- `POST /api/login` - 用戶登入
- `POST /api/events` - 建立活動
- `GET /api/events` - 列出活動
- `POST /api/images` - 上傳圖片

### 停止服務器
在終端機中按 `Ctrl + C` 即可停止服務器。

### 重新啟動
```bash
npm start
```

## 故障排除

### 如果遇到 "Cannot GET /admin.html" 錯誤
這表示靜態檔案服務配置有問題。請確認 `server.js` 中有以下設定：
```javascript
app.use(express.static(__dirname));
```

### 如果端口 3000 被佔用
可以設定環境變數使用其他端口：
```bash
PORT=8080 npm start
```

### 如果 npm install 失敗
嘗試清除 npm 快取：
```bash
npm cache clean --force
npm install
```

## 開發模式

如果您要進行開發，可以使用 nodemon 來監聽檔案變更：
```bash
npm run dev
```

## 聯絡資訊

如有問題，請檢查：
1. Node.js 版本是否符合需求
2. 所有依賴套件是否正確安裝
3. 端口 3000 是否可用
4. 防火牆設定是否阻擋連線
