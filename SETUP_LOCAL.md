# 本地运行指南

## 1. 安装依赖
```bash
cd "D:/Users/Admin/WorkBuddy AI/2026-11-17-08-42-30"
npm install
```

## 2. 配置环境变量
复制并编辑 .env 文件：
```bash
copy .env.example .env
notepad .env
```

确保以下关键配置正确：
```ini
PORT=3000
NODE_ENV=development
APP_BASE_URL=http://localhost:3000
COOKIE_SECURE=false
```

## 3. 启动后端服务
```bash
npm start
```
或者使用 nodemon（自动重启）：
```bash
npm run dev
```

后端将运行在: http://localhost:3000

## 4. 前端访问方式

### 方式A：直接打开HTML文件
```
双击打开: public/index.html
```
然后修改JS中的API前缀：
```javascript
const API_PREFIX = '/api'; // 改为相对路径，这样会从当前域名请求
```

### 方式B：用Python简单HTTP服务器
```bash
cd public
python -m http.server 8080
```
然后访问: http://localhost:8080

注意：这种方式API请求会失败，因为需要代理到后端。

### 方式C：使用Netlify CLI本地开发（推荐）
```bash
npx netlify-cli dev --dir=public --port=8888
```
访问: http://localhost:8888
会自动代理 /api/* 到本地后端
```

