# OpenAI Codex Chrome Extension (Code Exchange Skeleton)

这是一个 **后端主导的 code-exchange 骨架**：

1. 插件向后端请求授权 URL
2. 后端生成 OAuth 授权地址
3. 浏览器打开授权页并跳回后端本地回调
4. 后端自动接收 `code`
5. 后端执行真实 token exchange 并返回结果

## 当前实现

- Chrome Extension Manifest V3
- 扩展通过 `chrome.tabs.create(...)` 打开授权页
- 后端生成 Authorization Code + PKCE 授权 URL
- 后端启动本地回调服务器，默认监听 `http://localhost:1455/auth/callback`
- 可配置：
  - backend base URL
  - scope
- popup 查看状态
- popup 会轮询 `status` 接口，直到 flow 完成或过期
- options 页查看/编辑配置

## 默认配置

- Backend base URL: `http://localhost:8080/api/ext/oauth`

后端默认会复用 pi-mono 当前使用的 OpenAI Codex `client_id`。如果你有自己的 OAuth 客户端，可以通过环境变量覆盖。

## 使用方法

### 1. 加载扩展

在 Chrome 中打开：
- `chrome://extensions/`
- 打开“开发者模式”
- 选择“加载已解压的扩展程序”
- 指向本目录

### 2. 打开设置页

填写：
- `backendBaseUrl`
- `scope`

设置页会显示后端将使用的 `start` / `status` 地址，以及默认的本地回调地址。

### 3. 启动服务端

默认后端地址是：
- `http://localhost:8080/api/ext/oauth/start`
- `http://localhost:8080/api/ext/oauth/status`
- `http://localhost:1455/auth/callback`

启动后端：

```bash
node backend.js
```

可选环境变量：

- `OPENAI_CODEX_BACKEND_HOST`
- `OPENAI_CODEX_BACKEND_PORT`
- `OPENAI_CODEX_CALLBACK_HOST`
- `OPENAI_CODEX_CALLBACK_PORT`
- `OPENAI_CODEX_CLIENT_ID`
- `OPENAI_CODEX_AUTHORIZE_URL`
- `OPENAI_CODEX_TOKEN_URL`
- `OPENAI_CODEX_ORIGINATOR`
- `OPENAI_CODEX_FLOW_TTL_MS`
- `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`
- `http_proxy` / `https_proxy` / `no_proxy`
- `ALL_PROXY` / `all_proxy`

如果你不改 `clientId`，后端会使用和 pi-mono 一致的默认值。
`backend.js` 的 token 交换请求会优先读取这些代理环境变量；如果你只有 SOCKS5 代理，是否可用取决于当前 Node 的代理实现，HTTP/HTTPS 代理最稳。

### 4. 开始授权

点击 popup 里的“开始授权”：
- 插件会打开授权页
- 回调会先到后端本地服务器
- 后端自动完成 token exchange
- 返回结果展示在 popup / options 页面

## 真实 token 交换逻辑

当前插件已完成：
- 向后端请求授权 URL
- 由后端完成回调接收和 token 交换
- 可查询后端 flow 状态

当前 **实际执行 OAuth 闭环** 的代码在 `backend.js`：
- 生成 authorizeUrl
- 用 `code + code_verifier + redirect_uri` 去调用真实 token endpoint
- 把返回的 `access_token / refresh_token / expires_in / id_token` 等信息保存在内存 flow 并通过 `status` 暴露给扩展

`status` 接口用于调试当前 flow 是否仍然存在，不做持久化。
`me` 接口会在当前 flow 已完成后，使用 `access_token` 去请求 OpenAI `/v1/me`，再把可展示的用户和账号字段裁剪后返回给扩展。

`exchange` 接口目前只保留兼容占位，实际不会再由扩展调用。

可用的只读接口：

- `http://localhost:8080/api/ext/status?flowId=...`
- `http://localhost:8080/api/ext/me?flowId=...`

如果 OpenAI 对当前 redirect URI 不接受，后端还是会报错；那时需要改成一个真正被该 OAuth 客户端允许的 redirect URI。

## 关键文件

- `manifest.json`
- `backend.js`
- `background.js`
- `popup.html`
- `popup.js`
- `options.html`
- `options.js`
