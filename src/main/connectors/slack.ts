import { SocketModeClient } from '@slack/socket-mode'
import { WebClient } from '@slack/web-api'
import type { Chat, Connector, ConnectorContext, Message } from '../../shared/types'

/**
 * Slack 连接器（官方 Socket Mode + Web API，Bot）：
 * 无需公网，WebSocket 收事件，REST 发消息/拉频道与历史。
 */

interface SlackEventMessage {
  channel?: string
  user?: string
  text?: string
  ts?: string
  subtype?: string
  bot_id?: string
}

export class SlackConnector implements Connector {
  private ctx: ConnectorContext | null = null
  private sm: SocketModeClient | null = null
  private web: WebClient | null = null
  private chats = new Map<string, Chat>()
  private msgsByChat = new Map<string, Message[]>()
  private botUserId = ''

  async start(creds: Record<string, string>, ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx
    if (!creds['botToken'] || !creds['appToken']) throw new Error('缺少 Bot Token / App Token')
    ctx.setStatus('connecting', '连接 Slack…')
    this.web = new WebClient(creds['botToken'])
    this.sm = new SocketModeClient({ appToken: creds['appToken'] })

    this.sm.on('message', async ({ event, ack }) => {
      await ack?.()
      this.onMessage(event as SlackEventMessage)
    })
    this.sm.on('error', (err) => {
      ctx.setStatus('error', `Slack 连接错误：${(err as Error).message}`)
    })

    let team = ''
    try {
      const auth = await this.web.auth.test()
      this.botUserId = auth.user_id ?? ''
      team = auth.team ?? ''
    } catch (e) {
      throw new Error(`Bot Token 校验失败：${(e as Error).message}`)
    }

    await this.sm.start()
    ctx.setStatus('online', `已连接 ${team || 'Slack'}`)
    await this.loadChannels()
  }

  private onMessage(ev: SlackEventMessage): void {
    try {
      if (!ev.channel || !ev.ts || !ev.text) return
      if (ev.subtype && ev.subtype !== 'bot_message') return
      const isBot = ev.subtype === 'bot_message'
      const out = !!(isBot && this.botUserId && (ev.user === this.botUserId || !ev.user))
      if (isBot && !out) return // 其他 bot 的消息忽略，避免刷屏
      const chatId = ev.channel
      const ts = Math.floor(Number(ev.ts) * 1000)
      const old = this.chats.get(chatId)
      const sender = !out && ev.user ? `@${ev.user.slice(0, 9)}` : undefined
      const chat: Chat = {
        id: chatId,
        accountId: this.ctx?.accountId ?? 'slack',
        type: old?.type ?? (chatId.startsWith('D') ? 'private' : 'group'),
        title: old?.title ?? chatId,
        peer: { channelId: chatId },
        lastText: ev.text.slice(0, 60),
        lastTs: ts
      }
      const msg: Message = {
        id: `sl-${ev.ts}`,
        accountId: this.ctx?.accountId ?? 'slack',
        chatId,
        text: ev.text,
        ts,
        out,
        senderName: sender
      }
      this.chats.set(chatId, chat)
      this.pushLocal(msg)
      this.ctx?.upsertChat(chat)
      this.ctx?.pushMessage(msg)
    } catch {
      /* 单条失败不致命 */
    }
  }

  private pushLocal(msg: Message): void {
    const list = this.msgsByChat.get(msg.chatId) ?? (this.msgsByChat.set(msg.chatId, []).get(msg.chatId) as Message[])
    if (!list.some((m) => m.id === msg.id)) {
      list.push(msg)
      if (list.length > 200) list.splice(0, list.length - 200)
    }
  }

  private async loadChannels(): Promise<void> {
    if (!this.web) return
    try {
      const res = await this.web.conversations.list({
        types: 'im,mpim,public_channel,private_channel',
        limit: 200,
        exclude_archived: true
      })
      for (const ch of res.channels ?? []) {
        if (!ch.id) continue
        const isPrivate = !!(ch.is_im || ch.is_mpim)
        let title = ch.name || ch.id
        if (isPrivate && ch.user) {
          try {
            const ui = await this.web.users.info({ user: ch.user })
            title = ui.user?.real_name || ui.user?.profile?.display_name || ui.user?.name || title
          } catch {
            /* users:read 权限不足时用频道名 */
          }
        }
        this.chats.set(ch.id, {
          id: ch.id,
          accountId: this.ctx?.accountId ?? 'slack',
          type: isPrivate ? 'private' : 'group',
          title,
          peer: { channelId: ch.id },
          lastTs: 0
        })
      }
      this.ctx?.pushChats([...this.chats.values()])
    } catch {
      /* scope 不足时从事件里逐步补全 */
    }
  }

  async listChats(): Promise<Chat[]> {
    await this.loadChannels()
    return [...this.chats.values()]
  }

  async history(chat: Chat, limit: number): Promise<Message[]> {
    if (!this.web) return []
    const peer = chat.peer as { channelId?: string }
    if (!peer.channelId) return []
    try {
      const res = await this.web.conversations.history({ channel: peer.channelId, limit })
      const out: Message[] = []
      for (const m of (res.messages ?? []).slice().reverse()) {
        if (!m.ts || !m.text) continue
        const isBot = m.subtype === 'bot_message' || !!m.bot_id
        const outMsg = !!(isBot && this.botUserId && (m.bot_id === this.botUserId || m.user === this.botUserId))
        out.push({
          id: `sl-${m.ts}`,
          accountId: this.ctx?.accountId ?? 'slack',
          chatId: peer.channelId,
          text: m.text,
          ts: Math.floor(Number(m.ts) * 1000),
          out: outMsg,
          senderName: !outMsg && m.user ? `@${m.user.slice(0, 9)}` : undefined
        })
      }
      for (const m of out) this.pushLocal(m)
      return out
    } catch {
      return (this.msgsByChat.get(peer.channelId) ?? []).slice(-limit)
    }
  }

  async sendText(chat: Chat, text: string): Promise<void> {
    if (!this.web) throw new Error('Slack 未连接')
    const peer = chat.peer as { channelId?: string }
    if (!peer.channelId) throw new Error('会话信息缺失')
    await this.web.chat.postMessage({ channel: peer.channelId, text })
    const msg: Message = {
      id: `sl-out-${Date.now()}`,
      accountId: this.ctx?.accountId ?? 'slack',
      chatId: peer.channelId,
      text,
      ts: Date.now(),
      out: true
    }
    this.pushLocal(msg)
    this.ctx?.pushMessage(msg)
  }

  async stop(): Promise<void> {
    try {
      this.sm?.disconnect()
    } catch {
      /* 忽略关闭异常 */
    }
    this.ctx?.setStatus('offline', '已断开')
  }
}
