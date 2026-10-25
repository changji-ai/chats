# ChatHub · 聊天聚合桌面工作台

把多个聊天平台集合到一个窗口里统一查看、回复消息。**协议直连**（不嵌网页、不用 webview）：
Electron 主进程为每个「账号」跑一个协议连接器，收发消息都走协议本身，界面完全自绘。

## 账号模型

侧边栏只显示你**添加过的账号**：点侧边栏「＋」→ 选平台 → 按提示填凭据 → 保存即连接。
同一平台可加多个账号（如两个 QQ、QQ + 微信各挂一个 OneBot 实例）。删账号在 ⚙ 设置里。

## 支持的平台

| 平台 | 协议 | 接入方式 |
|------|------|----------|
| QQ | OneBot v11（WebSocket） | 本机跑 NapCat 并登录 QQ，本工具连它的 WebSocket，可加多个 |
| 微信 | OneBot v11 桥 | 本机跑 PC 微信 ob11 桥（WeChatFerry 系），扫码在桥侧完成 |
| Telegram | MTProto（gramjs） | 个人账号 + api_id/api_hash，首次登录输验证码，之后免登录 |
| WhatsApp | 多设备协议（Baileys） | 个人号，直接连接扫码登录，之后免登录 |
| Discord | 官方 Bot（discord.js） | 创建 Bot、打开 MESSAGE CONTENT / DIRECT MESSAGES 特权意图 |
| 飞书 / Lark | 官方开放 API + 长连接 | 企业自建应用 + 机器人，App ID/Secret |
| 钉钉 | 官方 Stream 模式机器人 | 企业内部应用，Client ID/Secret，免公网 |
| Slack | 官方 Socket Mode + Web API | Bot Token (xoxb) + App Token (xapp) |
| Matrix | 开放协议（matrix-js-sdk） | 个人账号密码登录，支持自建服务器 |
| IRC | 开放协议（irc-framework） | 任意 IRC 服务器，昵称 + 频道列表 |
| OneBot | 任意 OneBot v11 实现 | 上面没列到的 ob11 实现（多开 NapCat、其他桥）都能接 |

> iMessage / Messenger / Instagram / LINE / Viber / KakaoTalk / Teams / Zoom 因平台限制
>（webhook-only、生态锁定或需企业配置）无法本地协议直连。

## 运行

```powershell
npm install
npm run dev      # 开发
npm run build; npm start   # 正式运行
```

## 使用

1. 侧边栏点「＋」→ 选平台，按弹窗提示准备凭据并填写（以后在 ⚙ 设置里可改）：
   - **QQ**：先装 [NapCat](https://napneko.github.io/)，在 NapCat WebUI 里登录 QQ，网络配置新建「WebSocket 服务器」（默认端口 3001），然后这里填 `ws://127.0.0.1:3001`
   - **Telegram**：到 [my.telegram.org](https://my.telegram.org) 申请 api_id / api_hash；连接时按弹窗输手机号 → 验证码（→ 两步验证密码）
   - **Discord**：[开发者后台](https://discord.com/developers/applications)建应用 → Bot 拿 Token，打开特权意图，把 bot 邀请进服务器
   - **WhatsApp**：无需填写任何信息，连接后弹二维码，用手机扫码即可
   - **微信**：本机跑 PC 微信的 OneBot 桥（如 WeChatFerry 系），填桥的 WebSocket 地址
   - **飞书**：开放平台建企业自建应用 + 机器人，权限 im:message / im:chat，事件订阅选长连接
   - **钉钉**：开放平台建企业内部应用 + 机器人，填 Client ID / Secret（Stream 模式免公网）
   - **Slack**：建 App 开 Socket Mode，填 Bot Token (xoxb-) + App Token (xapp-)
   - **Matrix**：填服务器地址、用户名、密码（首次后免密）
   - **IRC**：填服务器 / 端口 / 昵称 / 频道
2. 连上后左侧出现会话列表，点开会话即可查看最近消息并直接回复

凭据用 Electron `safeStorage`（Windows DPAPI）加密后存于 `%APPDATA%/chat-hub/vault.json`。

## 功能

- 统一三栏界面：平台栏（连接状态、未读角标）→ 会话列表（未读、最后一条）→ 聊天窗（历史 + 回复）
- 新消息系统通知（点击跳转会话），支持按平台免打扰；任务栏角标显示总未读
- 快捷键：`Ctrl+1…9` 切换平台、`Ctrl+,` 设置
- 深色 / 浅色主题、开机自启

## 新增平台

连接器框架是开放的：在 `src/main/connectors/` 新建一个实现 `Connector` 接口（start / stop / listChats / history / sendText）的类，在 `connectors/index.ts` 注册，并在 `src/shared/platforms.ts` 加平台定义（字段表单自动生成）即可。
微信暂无官方个人号协议，可后续接 wechaty 或企业微信 API；飞书 / 钉钉 / Slack 均有官方开放 API，可按同一框架添加。

## 发布与自动更新

- 推送 `v*` 标签触发 GitHub Actions 三平台构建：Windows NSIS（x64+arm64 合一安装包）、
  macOS universal（dmg + zip）、Linux（AppImage + deb，x64/arm64），产物发布到
  [Releases](https://github.com/changji-ai/chats/releases)。
- 应用内置 electron-updater：启动后自动检查新版本 → 后台下载（设置里看进度）→
  一键「重启并更新」静默安装并重启；退出时也会自动安装已下载的更新。
- 本地打包：`npm run dist`（不发布）/ `npm run release`（发布到 GitHub）。

## 已知限制

- 消息只保留本次运行内的缓存（切换会话时拉最近 50 条），不做本地全量历史
- 仅支持文本消息收发；图片 / 语音等显示为占位标记
- QQ 历史消息依赖 NapCat 的扩展接口（`get_group_msg_history` 等），其他 OneBot 实现可能返回空
