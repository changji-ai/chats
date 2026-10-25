import { AppType, Client, Domain, EventDispatcher, WSClient } from '@larksuiteoapi/node-sdk'
import type { Chat, Connector, ConnectorContext, Message } from '../../shared/types'

/**
 * 飞书 / Lark 连接器（官方开放 API，企业自建应用 + 机器人）：
 * 长连接（WebSocket）收事件 im.message.receive_v1，REST 收发与历史。
 */

type FeishuClient = InstanceType<typeof Client>
type FeishuSendPayload = Parameters<FeishuClient['im']['v1']['message']['create']>[0]

interface FeishuCreds {
  appId: string
  appSecret: string
  domain?: string
}

export class FeishuConnector implements Connector {
  private ctx: ConnectorContext | null = null
  private stopped = false
  private client: FeishuClient | null = null
  private chats = new Map<string, Chat>()
  private msgsByChat = new Map<string, Message[]>()

  async start(creds: Record<string, string>, ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx
    this.stopped = false
    const c = creds as unknown as FeishuCreds
    if (!c.appId || !c.appSecret) throw new Error('缺少 App ID / App Secret')
    const domain = c.domain === 'larksuite' ? Domain.Lark : Domain.Feishu
    ctx.setStatus('connecting', '连接飞书…')
    this.client = new Client({ appId: c.appId, appSecret: c.appSecret, domain, appType: AppType.SelfBuild })

    const dispatcher = new EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => this.onReceive(data)
    })
    const ws = new WSClient({
      domain,
      appId: c.appId,
      appSecret: c.appSecret,
      loggerLevel: 'warn'
    } as unknown as ConstructorParameters<typeof WSClient>[0])
    await ws.start({ eventDispatcher: dispatcher })
    if (this.stopped) return
    ctx.setStatus('online', '机器人已上线')
    ctx.pushChats(await this.listChats())
  }

  private async onReceive(data: unknown): Promise<void> {
    try {
      const d = data as {
        message?: { chat_id?: string; message_type?: string; content?: string; create_time?: string; message_id?: string }
        sender?: { sender_id?: { open_id?: string } }
      }
      const m = d?.message
      const chatId = m?.chat_id
      if (!chatId || !m?.content) return
      let text = ''
      try {
        const parsed = JSON.parse(m.content) as { text?: string; title?: string }
        text = parsed.text || parsed.title || `[${m.message_type ?? '消息'}]`
      } catch {
        text = `[${m.message_type ?? '消息'}]`
      }
      const ts = Number(m.create_time ?? Date.now() / 1000) * 1000
      const old = this.chats.get(chatId)
      const senderId = d?.sender?.sender_id?.open_id
      const chat: Chat = {
        id: chatId,
        accountId: this.ctx?.accountId ?? 'feishu',
        type: 'group',
        title: old?.title ?? chatId,
        peer: { chatId },
        lastText: text.slice(0, 60),
        lastTs: ts
      }
      const msg: Message = {
        id: m.message_id ?? `fs-${Date.now()}`,
        accountId: this.ctx?.accountId ?? 'feishu',
        chatId,
        text,
        ts,
        out: false,
        senderName: senderId ? senderId.slice(0, 8) : undefined
      }
      this.chats.set(chatId, chat)
      this.pushLocal(msg)
      this.ctx?.upsertChat(chat)
      this.ctx?.pushMessage(msg)
    } catch {
      /* 单条消息解析失败不致命 */
    }
  }

  private pushLocal(msg: Message): void {
    const list = this.msgsByChat.get(msg.chatId) ?? (this.msgsByChat.set(msg.chatId, []).get(msg.chatId) as Message[])
    if (!list.some((m) => m.id === msg.id)) {
      list.push(msg)
      if (list.length > 200) list.splice(0, list.length - 200)
    }
  }

  async listChats(): Promise<Chat[]> {
    if (!this.client) return []
    try {
      const res = (await this.client.im.v1.chat.list({ params: { page_size: 100 } })) as unknown as {
        data?: { items?: { chat_id: string; name?: string; chat_mode?: string }[] }
      }
      for (const it of res.data?.items ?? []) {
        const old = this.chats.get(it.chat_id)
        this.chats.set(it.chat_id, {
          id: it.chat_id,
          accountId: this.ctx?.accountId ?? 'feishu',
          type: it.chat_mode === 'p2p' ? 'private' : 'group',
          title: it.name || old?.title || it.chat_id,
          peer: { chatId: it.chat_id },
          lastText: old?.lastText,
          lastTs: old?.lastTs
        })
      }
    } catch {
      /* 权限不足或网络失败：会话从事件里逐步补全 */
    }
    return [...this.chats.values()]
  }

  async history(chat: Chat, limit: number): Promise<Message[]> {
    if (!this.client) return []
    const peer = chat.peer as { chatId?: string }
    if (!peer.chatId) return []
    try {
      const res = (await this.client.im.v1.message.list({
        params: { container_id_type: 'chat', container_id: peer.chatId, page_size: limit }
      })) as unknown as {
        data?: {
          items?: {
            message_id: string
            msg_type?: string
            body?: { content?: string }
            create_time?: string
            sender?: { sender_type?: string; sender_id?: { open_id?: string } }
          }[]
        }
      }
      const out: Message[] = []
      for (const it of res.data?.items ?? []) {
        let text = `[${it.msg_type ?? '消息'}]`
        try {
          const parsed = JSON.parse(it.body?.content ?? '{}') as { text?: string; title?: string }
          text = parsed.text || parsed.title || text
        } catch {
          /* 保底占位 */
        }
        out.push({
          id: it.message_id,
          accountId: this.ctx?.accountId ?? 'feishu',
          chatId: peer.chatId,
          text,
          ts: Number(it.create_time ?? 0) * 1000,
          out: it.sender?.sender_type === 'app',
          senderName: it.sender?.sender_id?.open_id?.slice(0, 8)
        })
      }
      out.reverse()
      for (const m of out) this.pushLocal(m)
      return out.slice(-limit)
    } catch {
      return (this.msgsByChat.get(peer.chatId) ?? []).slice(-limit)
    }
  }

  async sendText(chat: Chat, text: string): Promise<void> {
    if (!this.client) throw new Error('飞书未连接')
    const peer = chat.peer as { chatId?: string }
    if (!peer.chatId) throw new Error('会话信息缺失')
    await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: peer.chatId,
        msg_type: 'text',
        content: JSON.stringify({ text })
      }
    } as unknown as FeishuSendPayload)
    const msg: Message = {
      id: `fs-out-${Date.now()}`,
      accountId: this.ctx?.accountId ?? 'feishu',
      chatId: peer.chatId,
      text,
      ts: Date.now(),
      out: true
    }
    this.pushLocal(msg)
    this.ctx?.pushMessage(msg)
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.ctx?.setStatus('offline', '已断开')
  }
}
