# OpenAI Codex Chrome Extension (Code Exchange Skeleton)

这是一个 **标准 code-exchange 骨架**：

1. 插件发起 OAuth 授权
2. 浏览器回调拿到 `code`
3. 插件将 `code` POST 给你的服务端
4. 服务端执行真实 token exchange（目前这里先是骨架）
5. 服务端返回结果给插件

## 当前实现

- Chrome Extension Manifest V3
- `chrome.identity.launchWebAuthFlow(...)`
- Authorization Code + PKCE 骨架
- 可配置：
  - authorize URL
  - clientId
  - scope
  - callbackPath
  - backendExchangeUrl
- popup 查看状态
- options 页查看/编辑配置

## 默认配置

- Authorize URL: `https://auth.openai.com/oauth/authorize`
- Backend exchange URL: `http://localhost:8080/api/ext/oauth/exchange`

## 使用方法

### 1. 加载扩展

在 Chrome 中打开：
- `chrome://extensions/`
- 打开“开发者模式”
- 选择“加载已解压的扩展程序”
- 指向本目录

### 2. 打开设置页

填写：
- `clientId`
- `authorizeBaseUrl`（通常保持默认）
- `scope`
- `backendExchangeUrl`

设置页会显示当前扩展生成的 Redirect URI。

### 3. 启动服务端

默认后端地址是：
- `http://localhost:8080/api/ext/oauth/exchange`

确保 `payouthub` 已启动。

### 4. 开始授权

点击 popup 里的“开始授权”：
- 插件会打开授权页
- 回调后拿到 `code`
- 自动请求你的 Go 服务端
- 返回结果展示在 popup / options 页面

## 真实 token 交换逻辑

当前插件已完成：
- 发起 OAuth
- 获取 code
- 调后端 exchange 接口

当前 **未完成** 的部分在服务端：
- 用 `code + code_verifier + redirect_uri + client_id` 去调用真实 token endpoint
- 把返回的 `access_token / refresh_token / expires_in / id_token` 等信息返回给插件

## 关键文件

- `manifest.json`
- `background.js`
- `popup.html`
- `popup.js`
- `options.html`
- `options.js`
