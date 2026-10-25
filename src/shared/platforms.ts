import type { PlatformDef } from './types'

/** 已实现协议直连的平台（连接器在 src/main/connectors/index.ts 注册） */
export const PLATFORMS: PlatformDef[] = [
  {
    id: 'qq-onebot',
    name: 'QQ',
    glyph: 'Q',
    color: '#12b7f5',
    protocol: 'onebot',
    hints: [
      '通过 OneBot v11 协议连接。先在本机跑一个 OneBot 实现（推荐 NapCat），并在其中登录 QQ。',
      'NapCat WebUI → 网络配置 → 新建「WebSocket 服务器」，端口默认 3001，本工具填 ws://127.0.0.1:3001。',
      'QQ 扫码登录在 NapCat 的 WebUI 里完成，这里只负责收发消息。'
    ],
    fields: [
      { key: 'wsUrl', label: 'WebSocket 地址', type: 'text', placeholder: 'ws://127.0.0.1:3001', required: true },
      { key: 'accessToken', label: 'Access Token（可选）', type: 'password' }
    ]
  },
  {
    id: 'wechat',
    name: '微信',
    glyph: '微',
    color: '#07c160',
    protocol: 'onebot',
    hints: [
      '微信无官方个人号 API：需在本机跑 PC 微信的 OneBot v11 桥（如 WeChatFerry 系框架及其 ob11 适配），扫码登录在桥侧完成。',
      '这里填桥暴露的正向 WebSocket 地址（如 ws://127.0.0.1:8080）。'
    ],
    fields: [
      { key: 'wsUrl', label: 'WebSocket 地址', type: 'text', placeholder: 'ws://127.0.0.1:8080', required: true },
      { key: 'accessToken', label: 'Access Token（可选）', type: 'password' }
    ]
  },
  {
    id: 'telegram',
    name: 'Telegram',
    glyph: 'T',
    color: '#2aabee',
    hints: [
      '官方 MTProto 协议直连个人账号：首次连接依次输入手机号 → 验证码 → 两步验证密码（若有）。',
      'api_id / api_hash 在 my.telegram.org → API development tools 免费申请。',
      '登录一次后 session 加密保存在本机，之后自动上线。'
    ],
    fields: [
      { key: 'apiId', label: 'api_id', type: 'text', placeholder: '123456', required: true },
      { key: 'apiHash', label: 'api_hash', type: 'password', required: true },
      { key: 'phone', label: '手机号（可留空，连接时再输）', type: 'text', placeholder: '+8613800138000' }
    ]
  },
  {
    id: 'discord',
    name: 'Discord',
    glyph: 'D',
    color: '#5865f2',
    hints: [
      '官方 Bot 协议（discord.js）。在 discord.com/developers/applications 创建应用 → Bot → Reset Token。',
      'Bot 页面需打开「MESSAGE CONTENT INTENT」与「DIRECT MESSAGES INTENT」特权意图，否则收不到消息。',
      '用 OAuth2 URL Generator（scopes=bot）把 bot 邀请进你的服务器。'
    ],
    fields: [{ key: 'token', label: 'Bot Token', type: 'password', required: true }]
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    glyph: 'W',
    color: '#25d366',
    hints: [
      '点击「保存并连接」后弹出二维码，用手机 WhatsApp 扫码（设置 → 已关联的设备 → 关联设备）。',
      '登录一次后会话保存在本机，之后自动上线。基于开源多设备协议（Baileys），非官方接口，建议不要用于大量群发。',
      '会话列表包含你所在的群；私聊会随收到的新消息逐步出现。'
    ],
    fields: []
  },
  {
    id: 'feishu',
    name: '飞书',
    glyph: '飞',
    color: '#3370ff',
    hints: [
      '在飞书开放平台（open.feishu.cn）创建企业自建应用，开通「机器人」能力，添加权限：im:message、im:message:send_as_bot、im:chat（读取会话与历史）。',
      '事件订阅选「长连接」方式，订阅 im.message.receive_v1；应用发布后把机器人拉进需要的会话。',
      '海外 Lark 账号把「域名」填 larksuite。机器人收发（非个人号身份）。'
    ],
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', required: true },
      { key: 'appSecret', label: 'App Secret', type: 'password', required: true },
      { key: 'domain', label: '域名（feishu / larksuite）', type: 'text', placeholder: 'feishu' }
    ]
  },
  {
    id: 'dingtalk',
    name: '钉钉',
    glyph: '钉',
    color: '#0089ff',
    hints: [
      '在钉钉开放平台创建企业内部应用 → 添加「机器人」能力，获取 Client ID / Client Secret。',
      'Stream 模式收消息（无需公网）；会话列表从机器人收到消息后逐步出现；在群里需 @机器人 对话，单聊直接收发。'
    ],
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true }
    ]
  },
  {
    id: 'slack',
    name: 'Slack',
    glyph: 'S',
    color: '#e01e5a',
    hints: [
      '在 api.slack.com/apps 创建 App：启用 Socket Mode（拿 App-Level Token xapp-…），订阅事件 message / im.message / app_mention（Bot Token Scopes: chat:write、channels:history、groups:history、im:history、mpim:history、users:read）。',
      '把 Bot (xoxb-…) 装进工作区并邀请进需要的频道/私聊。'
    ],
    fields: [
      { key: 'botToken', label: 'Bot Token（xoxb-…）', type: 'password', required: true },
      { key: 'appToken', label: 'App Token（xapp-…）', type: 'password', required: true }
    ]
  },
  {
    id: 'matrix',
    name: 'Matrix',
    glyph: 'M',
    color: '#0dbd8b',
    hints: [
      '开放协议（matrix.org / 自建服务器），个人账号密码登录，首次成功后自动保存令牌免密。',
      '填服务器地址、用户名（如 @user:matrix.org）、密码。'
    ],
    fields: [
      { key: 'homeserver', label: '服务器地址', type: 'text', placeholder: 'https://matrix.org', required: true },
      { key: 'user', label: '用户名', type: 'text', placeholder: '@user:matrix.org', required: true },
      { key: 'password', label: '密码', type: 'password', required: true }
    ]
  },
  {
    id: 'irc',
    name: 'IRC',
    glyph: 'I',
    color: '#8e44ad',
    hints: [
      '开放协议，任何 IRC 服务器（libera.chat 等）；频道用逗号分隔，可带 #。',
      'TLS 默认开启；服务器密码可选（部分网络要求注册账号）。'
    ],
    fields: [
      { key: 'host', label: '服务器', type: 'text', placeholder: 'irc.libera.chat', required: true },
      { key: 'port', label: '端口', type: 'text', placeholder: '6697' },
      { key: 'nick', label: '昵称', type: 'text', required: true },
      { key: 'channels', label: '频道（逗号分隔）', type: 'text', placeholder: '#libera,#chat' },
      { key: 'password', label: '密码（可选）', type: 'password' },
      { key: 'tls', label: 'TLS（yes/no）', type: 'text', placeholder: 'yes' }
    ]
  },
  {
    id: 'onebot-custom',
    name: 'OneBot',
    glyph: 'O',
    color: '#6b7f94',
    protocol: 'onebot',
    hints: [
      '连接任意 OneBot v11 实现（NapCat 多开、微信桥、其他 QQ 实现等）：填写其正向 WebSocket 地址。',
      '一个账号连一个实例；同一平台可添加多个账号。'
    ],
    fields: [
      { key: 'wsUrl', label: 'WebSocket 地址', type: 'text', placeholder: 'ws://127.0.0.1:3001', required: true },
      { key: 'accessToken', label: 'Access Token（可选）', type: 'password' }
    ]
  }
]

export const DEFAULT_SETTINGS = {
  theme: 'dark' as const,
  notifications: true,
  autoLaunch: false,
  muted: {} as Record<string, boolean>,
  accounts: [] as import('./types').Account[]
}
