import * as dingtalkStream from 'dingtalk-stream'
import type { Chat, Connector, ConnectorContext, Message } from '../../shared/types'

/**
 * 钉钉连接器（官方 Stream 模式，企业内部应用机器人）：
 * 无需公网，WebSocket 长连接收消息，sessionWebhook 回复。
 */

type DWClientCtor = new (cfg: { clientId: string; clientSecret: string }) => {
  registerCallbackListener: (topic: string, cb: (data: unknown) => Promise<void> | void) => unknown
  connect: () => Promise<unknown>
  close?: () => void
  disconnect?: () => void
}

// CJS 互操作防御
const pkg = dingtalkStream as unknown as Record<string, unknown> & { default?: unknown }
const DWClientCtor =
  (pkg.DWClient as DWClientCtor | undefined) ??
  ((typeof pkg.default === 'function' ? pkg.default : (pkg.default as { DWClient?: DWClientCtor } | undefined)?.DWClient) as DWClientCtor)

const TOPIC_BOT = (pkg.TOPIC_ROBOT_MESSAGE as string | undefined) ?? '/v1.0/im/bot/messages/get'

interface DingData {
  headers?: { sessionId?: string }
  data?: {
    conversationId?: string
    conversationType?: string // '1' 单聊 '2' 群聊
    senderStaffId?: string
    senderNick?: string
    senderId?: string
    sessionWebhook?: string
    text?: { content?: string }
    chatTitle?: string
    conversationTitle?: string
    msgId?: string
    createAt?: number
    senderCorpId?: string
  }
}

export class DingTalkConnector implements Connector {
  private ctx: ConnectorContext | null = null
  private client: { close?: () => void; disconnect?: () => void } | null = null
  private chats = new Map<string, Chat>()
  private msgsByChat = new Map<string, Message[]>()
  private stopped = false

  async start(creds: Record<string, string>, ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx
    this.stopped = false
    if (!creds['clientId'] || !creds['clientSecret']) throw new Error('缺少 Client ID / Client Secret')
    if (!DWClientCtor) throw new Error('钉钉 SDK 加载失败')
    ctx.setStatus('connecting', '连接钉钉 Stream…')
    const client = new DWClientCtor({ clientId: creds['clientId'], clientSecret: creds['clientSecret'] })
    this.client = client
    client.registerCallbackListener(TOPIC_BOT, async (raw: unknown) => {
      await this.onBotMessage(raw)
    })
    await client.connect()
    if (this.stopped) return
    ctx.setStatus('online', '机器人已上线（单聊直达，群内 @机器人）')
  }

  private async onBotMessage(raw: unknown): Promise<void> {
    try {
      const d = (raw as DingData).data
      if (!d?.conversationId) return
      const text = (d.text?.content ?? '').trim()
      if (!text) return
      const chatId = d.conversationId
      const isGroup = d.conversationType === '2'
      const title = isGroup ? (d.chatTitle || d.conversationTitle || '钉钉群') : (d.senderNick || '钉钉会话')
      const chat: Chat = {
        id: chatId,
        accountId: this.ctx?.accountId ?? 'dingtalk',
        type: isGroup ? 'group' : 'private',
        title,
        peer: { conversationId: chatId, sessionWebhook: d.sessionWebhook ?? '', senderStaffId: d.senderStaffId ?? '' },
        lastText: text.slice(0, 60),
        lastTs: d.createAt ?? Date.now()
      }
      const msg: Message = {
        id: d.msgId ?? `dt-${Date.now()}`,
        accountId: this.ctx?.accountId ?? 'dingtalk',
        chatId,
        text,
        ts: d.createAt ?? Date.now(),
        out: false,
        senderName: isGroup ? (d.senderNick || d.senderStaffId) : undefined
      }
      this.chats.set(chatId, chat)
      const list = this.msgsByChat.get(chatId) ?? (this.msgsByChat.set(chatId, []).get(chatId) as Message[])
      if (!list.some((m) => m.id === msg.id)) {
        list.push(msg)
        if (list.length > 200) list.splice(0, list.length - 200)
      }
      this.ctx?.upsertChat(chat)
      this.ctx?.pushMessage(msg)
    } catch {
      /* 单条失败不致命 */
    }
  }

  async listChats(): Promise<Chat[]> {
    return [...this.chats.values()]
  }

  async history(chat: Chat, limit: number): Promise<Message[]> {
    return (this.msgsByChat.get(chat.id) ?? []).slice(-limit)
  }

  async sendText(chat: Chat, text: string): Promise<void> {
    const peer = chat.peer as { sessionWebhook?: string }
    if (!peer.sessionWebhook) {
      // 会话的 webhook 会过期：等下一条消息进来刷新；提示用户先和机器人说句话
      throw new Error('回复通道已过期，请让对方再发一条消息后重试')
    }
    const res = await fetch(peer.sessionWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: text } })
    })
    if (!res.ok) throw new Error(`钉钉回复失败（HTTP ${res.status}）`)
    const msg: Message = {
      id: `dt-out-${Date.now()}`,
      accountId: this.ctx?.accountId ?? 'dingtalk',
      chatId: chat.id,
      text,
      ts: Date.now(),
      out: true
    }
    const list = this.msgsByChat.get(chat.id) ?? (this.msgsByChat.set(chat.id, []).get(chat.id) as Message[])
    list.push(msg)
    this.ctx?.pushMessage(msg)
  }

  async stop(): Promise<void> {
    this.stopped = true
    try {
      this.client?.disconnect?.()
      this.client?.close?.()
    } catch {
      /* 忽略关闭异常 */
    }
    this.ctx?.setStatus('offline', '已断开')
  }
}
