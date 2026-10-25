/** 连接状态 */
export type ConnStatus = 'idle' | 'connecting' | 'waiting-auth' | 'online' | 'offline' | 'error'

/** 账号配置字段 */
export interface FieldDef {
  key: string
  label: string
  type: 'text' | 'password'
  placeholder?: string
  required?: boolean
}

/** 平台模板（静态定义；用户按模板添加「账号」） */
export interface PlatformDef {
  id: string
  name: string
  glyph: string
  color: string
  fields: FieldDef[]
  /** 配置/登录前置条件说明，展示给用户 */
  hints: string[]
  /** 连接器协议：不填则按内置 id 匹配；'onebot' 表示复用 OneBot 连接器 */
  protocol?: 'onebot'
}

/** 用户添加的账号实例（一个平台模板可加多个账号） */
export interface Account {
  /** 实例 id（凭据、会话、消息都挂在它上面） */
  id: string
  /** 所属平台模板 id */
  platformId: string
  /** 侧边栏显示名（缺省用平台名） */
  label?: string
}

/** 会话 */
export interface Chat {
  id: string
  accountId: string
  type: 'private' | 'group'
  title: string
  peer: Record<string, unknown>
  unread?: number
  lastText?: string
  lastTs?: number
}

/** 消息 */
export interface Message {
  id: string
  accountId: string
  chatId: string
  text: string
  ts: number
  out: boolean
  senderName?: string
}

/** 需要用户交互的认证步骤（如 Telegram 验证码、WhatsApp 扫码） */
export interface AuthStep {
  type: 'code' | 'password' | 'text' | 'qrcode'
  prompt: string
  placeholder?: string
  /** type 为 qrcode 时的二维码图片（dataURL） */
  qrImage?: string
}

/** 连接器实现（每个账号一个实例） */
export interface Connector {
  start(creds: Record<string, string>, ctx: ConnectorContext): Promise<void>
  listChats(): Promise<Chat[]>
  history(chat: Chat, limit: number): Promise<Message[]>
  sendText(chat: Chat, text: string): Promise<void>
  stop(): Promise<void>
}

/** 连接器运行上下文（由中枢注入，platformId=账号所属模板 id，accountId=账号实例 id） */
export interface ConnectorContext {
  accountId: string
  setStatus(status: ConnStatus, detail?: string): void
  /** 弹窗要用户输入（验证码/密码等），Promise 在用户提交后 resolve */
  requestAuth(step: AuthStep): Promise<string>
  pushChats(chats: Chat[]): void
  upsertChat(chat: Chat): void
  pushMessage(msg: Message): void
  /** 增量保存凭据（如 Telegram session），与现有凭据合并 */
  saveCredentials(patch: Record<string, string>): void
}

/** 运行时状态（按账号） */
export interface PlatformRuntime {
  def: PlatformDef
  account: Account
  status: ConnStatus
  detail: string
  configured: boolean
}

export interface AppSettings {
  theme: 'dark' | 'light'
  notifications: boolean
  autoLaunch: boolean
  /** 平台级免打扰（不弹系统通知） */
  muted: Record<string, boolean>
  /** 已添加的账号列表 */
  accounts: Account[]
  /** 连接成功过的账号在下次启动时自动重连 */
  autoConnect?: Record<string, boolean>
}

/** 自动更新状态推送 */
export interface UpdateStatus {
  status: 'checking' | 'available' | 'downloading' | 'ready' | 'uptodate' | 'error' | ''
  version?: string
  percent?: number
  note?: string
}

/** 主进程 → 渲染进程推送事件表 */
export interface PushEvents {
  'conn:status': { accountId: string; status: ConnStatus; detail: string }
  'conn:auth': { accountId: string; step: AuthStep | null }
  'chats:update': { accountId: string; chats: Chat[] }
  'chats:upsert': { accountId: string; chat: Chat }
  'msg:new': { msg: Message }
  'ui:navigate': { accountId: string; chatId: string }
  'ui:switch-platform': { index: number }
  'ui:open-settings': Record<string, never>
  'update:status': UpdateStatus
}
