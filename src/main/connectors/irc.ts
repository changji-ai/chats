import * as ircfw from 'irc-framework'
import type { Chat, Connector, ConnectorContext, Message } from '../../shared/types'

/**
 * IRC 连接器（开放协议）：
 * 原生 TLS 连接任意 IRC 服务器，自动加入频道，收发私聊与频道消息。
 */

const pkg = ircfw as unknown as typeof ircfw & Record<string, unknown>
const IrcClientCtor: typeof ircfw.Client =
  pkg.Client ?? (pkg.default as unknown as typeof ircfw.Client)

type IrcClient = InstanceType<typeof IrcClientCtor>
interface IrcMessageEvent {
  nick?: string
  target?: string
  message?: string
  tags?: Record<string, string>
}

export class IrcConnector implements Connector {
  private client: IrcClient | null = null
  private ctx: ConnectorContext | null = null
  private nick = ''
  private chats = new Map<string, Chat>()
  private msgsByChat = new Map<string, Message[]>()
  private stopped = false

  async start(creds: Record<string, string>, ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx
    this.stopped = false
    const host = creds['host']
    this.nick = creds['nick'] || 'chathub'
    if (!host) throw new Error('缺少服务器地址')
    const tls = (creds['tls'] ?? 'yes').toLowerCase() !== 'no'
    const port = Number(creds['port'] || (tls ? 6697 : 6667))
    ctx.setStatus('connecting', `连接 ${host}:${port}…`)

    const client = new IrcClientCtor({
      host,
      port,
      nick: this.nick,
      tls,
      password: creds['password'] || undefined,
      auto_reconnect: false,
      enable_chghost: true
    })
    this.client = client

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接超时')), 30000)
      client.on('registered', () => {
        clearTimeout(timer)
        resolve()
      })
      client.on('close', () => {
        clearTimeout(timer)
        if (!this.stopped) reject(new Error('连接被服务器关闭（检查端口/TLS/密码）'))
      })
      client.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(new Error(`IRC 错误：${err.message}`))
      })
      client.connect()
    })
    if (this.stopped) return
    ctx.setStatus('online', `已连接 ${host}（${this.nick}）`)

    client.on('message', (ev: IrcMessageEvent) => {
      try {
        const from = ev.nick
        const text = ev.message
        if (!from || !text) return
        const isPrivate = (ev.target ?? '').toLowerCase() === this.nick.toLowerCase()
        const chatId = isPrivate ? from : (ev.target ?? from)
        const chat: Chat = {
          id: chatId,
          accountId: this.ctx?.accountId ?? 'irc',
          type: isPrivate ? 'private' : 'group',
          title: chatId,
          peer: { target: chatId },
          lastText: text.slice(0, 60),
          lastTs: Date.now()
        }
        const msg: Message = {
          id: `irc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          accountId: this.ctx?.accountId ?? 'irc',
          chatId,
          text,
          ts: Date.now(),
          out: false,
          senderName: from
        }
        this.chats.set(chatId, chat)
        const list = this.msgsByChat.get(chatId) ?? (this.msgsByChat.set(chatId, []).get(chatId) as Message[])
        list.push(msg)
        if (list.length > 200) list.splice(0, list.length - 200)
        this.ctx?.upsertChat(chat)
        this.ctx?.pushMessage(msg)
      } catch {
        /* 单条失败不致命 */
      }
    })

    for (const raw of (creds['channels'] ?? '').split(/[,，]/)) {
      const ch = raw.trim()
      if (!ch) continue
      const name = ch.startsWith('#') ? ch : `#${ch}`
      client.join(name)
      this.chats.set(name, {
        id: name,
        accountId: this.ctx?.accountId ?? 'irc',
        type: 'group',
        title: name,
        peer: { target: name },
        lastTs: 0
      })
    }
    ctx.pushChats([...this.chats.values()])
  }

  async listChats(): Promise<Chat[]> {
    return [...this.chats.values()]
  }

  async history(chat: Chat, limit: number): Promise<Message[]> {
    return (this.msgsByChat.get(chat.id) ?? []).slice(-limit)
  }

  async sendText(chat: Chat, text: string): Promise<void> {
    if (!this.client) throw new Error('IRC 未连接')
    const peer = chat.peer as { target?: string }
    if (!peer.target) throw new Error('会话信息缺失')
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      this.client.say(peer.target, line)
      const msg: Message = {
        id: `irc-out-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        accountId: this.ctx?.accountId ?? 'irc',
        chatId: chat.id,
        text: line,
        ts: Date.now(),
        out: true,
        senderName: this.nick
      }
      const list = this.msgsByChat.get(chat.id) ?? (this.msgsByChat.set(chat.id, []).get(chat.id) as Message[])
      list.push(msg)
      this.ctx?.pushMessage(msg)
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    try {
      this.client?.quit('bye')
      this.client?.end()
    } catch {
      /* 忽略关闭异常 */
    }
    this.ctx?.setStatus('offline', '已断开')
  }
}
