# 本地运行指南 - AI Job Search Web

## 📁 项目位置
```
D:/Users/Admin/WorkBuddy AI/2026-11-17-08-42-30/
```

---

## ✅ 已完成配置
- ✅ npm install（依赖已安装）
- ✅ .env 文件已创建并配置为本地开发模式

---

## 🚀 启动步骤

### 第一步：打开终端
打开 Git Bash 或 PowerShell，进入项目目录：
```bash
cd "D:/Users/Admin/WorkBuddy AI/2026-11-17-08-42-30"
```

### 第二步：启动后端服务器
在新终端中运行：
```bash
npm start
```

你会看到类似输出：
```
[ready] server listening on port 3000
[database] connected to SQLite at data/careercompass.sqlite
```

保持这个终端窗口打开！

### 第三步：启动前端开发服务器
打开**另一个终端**，在同一目录下运行：
```bash
npx netlify dev --dir=public --port=8888
```

你会看到类似输出：
```
▶  Netlify Dev
◈  Server now ready on http://localhost:8888
```

---

## 🌐 访问地址

| 服务 | URL |
|------|-----|
| **前端应用** | http://localhost:8888 |
| **后端API** | http://localhost:3000 |

---

## 🔑 登录凭据

```
邮箱: admin@local.app
密码: admin1234
```

---

## 🧪 测试功能

### 1. 测试Admin Edit按钮
1. 打开 http://localhost:8888
2. 登录后点击左侧菜单 **Tools → Admin**
3. 点击用户行的 **[Edit]** 按钮
4. 应该弹出模态框显示用户信息

### 2. 测试中文简历解析
1. 进入 **Profile** 页面
2. 在 "Upload Resume" 区域选择 `.txt` 文件
3. 点击 **"Read Resume File"**
4. 检查是否正确提取工作经历

### 3. 测试权限系统
1. 所有导航菜单项应可见（无锁定图标）
2. Admin面板应可正常访问和操作

---

## ⚠️ 注意事项

1. **两个终端都要保持打开**
   - 终端1：运行 `npm start`（后端）
   - 终端2：运行 `npx netlify dev`（前端）

2. **如需修改代码后自动重启**
   ```bash
   npm run dev
   ```
   （使用 nodemon 自动检测文件变化）

3. **停止服务**
   - 在每个终端按 `Ctrl+C` 停止服务

---

## 🛠️ 常见问题

### Q: 端口 3000 被占用？
编辑 `.env` 文件，修改端口号：
```ini
PORT=3001
```

### Q: 前端无法连接后端API？
确保后端正在运行：http://localhost:3000/api/auth/me  
如果返回JSON数据，说明后端正常。

### Q: 中文简历解析不准确？
这是已知问题，已在最新代码中修复。请确保：
1. 使用最新的代码版本
2. 后端服务器已重启加载新代码

---

## 📝 文件结构

```
D:/Users/Admin/WorkBuddy AI/2026-11-17-08-42-30/
├── server/
│   ├── index.js          # 后端主服务
│   └── extract_text.py   # Python简历文本提取器
├── public/
│   ├── index.html        # 前端入口
│   ├── js/app.js         # 前端主JS
│   └── css/style.css     # 样式文件
├── data/
│   └── careercompass.sqlite  # 数据库文件
└── .env                  # 环境变量配置
```
