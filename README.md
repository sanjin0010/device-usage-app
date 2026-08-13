# 设备使用登记与预约 APP

第一阶段核心闭环：本地账号登录、设备列表/搜索/详情、登记使用、结束使用、我的使用记录，以及管理员新增/编辑/删除设备。

## 运行

```bash
npm install
npm start
```

默认访问 `http://localhost:3000`。若端口被占用，服务会自动改用下一个空闲端口并在控制台提示。

应用已支持 PWA：在手机浏览器打开后，可通过“添加到主屏幕”安装为 App 体验；也可用 PWABuilder 等工具打包成 APK 分享。

## 打包 Android APK

仓库内置 GitHub Actions 工作流 `.github/workflows/build-apk.yml`：推送 `main` 分支后，Actions 会用 Capacitor 自动构建 `app-debug.apk`，产物可在 Actions 运行页面的 Artifacts 中下载。

## 演示账号

- 管理员：`admin / admin123`
- 员工：`staff / staff123`

## 测试

```bash
npm test
```

## 目录结构

- `server.js`：服务入口与端口选择
- `src/db.js`：SQLite 建表与种子数据
- `src/app.js`：Express 路由与业务规则
- `src/auth.js`：密码哈希与会话管理
- `public/`：移动端风格前端（原生 HTML/CSS/JS）
- `tests/`：API 集成测试
- `data/app.db`：运行后自动生成的 SQLite 数据库
