import WebSocket from 'ws'
import type { Chat, Connector, ConnectorContext, Message } from '../../shared/types'

/** OneBot v11 协议连接器（QQ，推荐配合 NapCat 使用） */
interface ObPeer {
  kind: 'private' | 'group'
  id: number
}

interface ObPacket {
  post_type?: string
  message_type?: string
  message_id?: number
  user_id?: number
  group_id?: number
  message?: unknown
  raw_message?: string
  time?: number
  echo?: string | number
  status?: string
  retcode?: number
  data?: unknown
  sender?: { nickname?: string; card?: string }
}

function segText(message: unknown): string {
  if (typeof message === 'string') return message
  if (Array.isArray(message)) {
    return (message as Array<{ type: string; data: Record<string, unknown> }>)
      .map((s) => {
        if (s.type === 'text') return String(s.data?.text ?? '')
        if (s.type === 'image') return '[图片]'
        if (s.type === 'face') return '[表情]'
        if (s.type === 'record') return '[语音]'
        if (s.type === 'file') return '[文件]'
        if (s.type === 'reply') return '[回复]'
        if (s.type === 'at') return `@${String(s.data?.qq ?? '')}`
        return `[${s.type}]`
      })
      .join('')
  }
  return ''
}

export class OneBotConnector implements Connector {
  private ws: WebSocket | null = null
  private ctx: ConnectorContext | null = null
  private stopped = false
  private echo = 0
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private chats = new Map<string, Chat>()

  async start(creds: Record<string, string>, ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx
    this.stopped = false
    const url = (creds.wsUrl ?? '').trim()
    if (!/^wss?:\/\//i.test(url)) throw new Error('WebSocket 地址无效，应形如 ws://127.0.0.1:3001')
    ctx.setStatus('connecting', `连接 ${url}`)
    await this.open(url, (creds.accessToken ?? '').trim())
  }

  private open(url: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      this.ws = ws
      const onOpen = () => {
        cleanup()
        void this.afterConnect().then(resolve, reject)
      }
      const onFail = (err: Error): void => {
        cleanup()
        reject(err)
      }
      const cleanup = () => {
        ws.off('open', onOpen)
        ws.off('error', onFail)
      }
      ws.on('open', onOpen)
      ws.on('error', (e) => onFail(new Error(`无法连接 ${url}：${String((e as Error).message ?? e)}`)))
      ws.on('message', (data) => this.onPacket(data.toString()))
      ws.on('close', () => this.onClose(url, token))
    })
  }

  private async afterConnect(): Promise<void> {
    await this.refreshChats()
    this.ctx?.setStatus('online', '已连接')
  }

  private onClose(url: string, token: string): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('连接已断开'))
    }
    this.pending.clear()
    if (this.stopped) {
      this.ctx?.setStatus('offline', '已断开')
      return
    }
    this.ctx?.setStatus('connecting', '连接断开，5 秒后重连…')
    setTimeout(() => {
      if (!this.stopped) void this.open(url, token).catch(() => {})
    }, 5000)
  }

  private onPacket(raw: string): void {
    let pkt: ObPacket
    try {
      pkt = JSON.parse(raw) as ObPacket
    } catch {
      return
    }
    if (pkt.echo !== undefined && this.pending.has(String(pkt.echo))) {
      const p = this.pending.get(String(pkt.echo))
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(String(pkt.echo))
      if (pkt.status === 'ok' || pkt.retcode === 0) p.resolve(pkt.data)
      else p.reject(new Error(`OneBot 动作失败（retcode=${String(pkt.retcode ?? '?')}）`))
      return
    }
    if (pkt.post_type === 'message') this.onMessage(pkt)
  }

  private onMessage(pkt: ObPacket): void {
    const text = segText(pkt.message) || pkt.raw_message || ''
    if (!text.trim()) return
    const isGroup = pkt.message_type === 'group'
    const gid = Number(pkt.group_id ?? 0)
    const uid = Number(pkt.user_id ?? 0)
    if (isGroup ? !gid : !uid) return
    const peer: ObPeer = isGroup ? { kind: 'group', id: gid } : { kind: 'private', id: uid }
    const id = isGroup ? `g${gid}` : `p${uid}`
    const title =
      this.chats.get(id)?.title ?? (isGroup ? `群 ${gid}` : (pkt.sender?.nickname ?? `QQ ${uid}`))
    const ts = (pkt.time ?? Math.floor(Date.now() / 1000)) * 1000
    const chat: Chat = {
      id,
      accountId: this.ctx?.accountId ?? 'onebot',
      type: isGroup ? 'group' : 'private',
      title,
      peer: { ...peer },
      lastText: text.slice(0, 60),
      lastTs: ts
    }
    const msg: Message = {
      id: `ob-${id}-${pkt.message_id ?? pkt.time ?? 0}`,
      accountId: this.ctx?.accountId ?? 'onebot',
      chatId: id,
      text,
      ts,
      out: false,
      senderName: isGroup ? (pkt.sender?.card || pkt.sender?.nickname || String(uid)) : undefined
    }
    this.chats.set(id, chat)
    this.ctx?.upsertChat(chat)
    this.ctx?.pushMessage(msg)
  }

  private call<T = unknown>(action: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('OneBot 未连接'))
        return
      }
      const echo = `e${++this.echo}`
      const timer = setTimeout(() => {
        this.pending.delete(echo)
        reject(new Error(`动作超时：${action}`))
      }, timeoutMs)
      this.pending.set(echo, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.ws.send(JSON.stringify({ action, params, echo }))
    })
  }

  private async refreshChats(): Promise<void> {
    const friends = await this.call<Array<{ user_id: number; nickname?: string; remark?: string }>>('get_friend_list').catch(() => [])
    const groups = await this.call<Array<{ group_id: number; group_name?: string }>>('get_group_list').catch(() => [])
    const chats: Chat[] = []
    for (const f of friends ?? []) {
      chats.push({
        id: `p${f.user_id}`,
        accountId: this.ctx?.accountId ?? 'onebot',
        type: 'private',
        title: f.remark || f.nickname || `QQ ${f.user_id}`,
        peer: { kind: 'private', id: f.user_id }
      })
    }
    for (const g of groups ?? []) {
      chats.push({
        id: `g${g.group_id}`,
        accountId: this.ctx?.accountId ?? 'onebot',
        type: 'group',
        title: g.group_name || `群 ${g.group_id}`,
        peer: { kind: 'group', id: g.group_id }
      })
    }
    // 保留已有 lastText（刷新列表不冲掉会话摘要）
    for (const c of chats) {
      const old = this.chats.get(c.id)
      this.chats.set(c.id, old ? { ...c, lastText: old.lastText, lastTs: old.lastTs } : c)
    }
    this.ctx?.pushChats([...this.chats.values()])
  }

  async listChats(): Promise<Chat[]> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        await this.refreshChats()
      } catch {
        /* 保持缓存 */
      }
    }
    return [...this.chats.values()]
  }

  async history(chat: Chat, limit: number): Promise<Message[]> {
    const peer = chat.peer as unknown as ObPeer
    try {
      const action = peer.kind === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history'
      const params = peer.kind === 'group' ? { group_id: peer.id, count: limit } : { user_id: peer.id, count: limit }
      const data = await this.call<{
        messages?: Array<{ message_id: number; message: unknown; raw_message?: string; time: number; sender?: { nickname?: string; card?: string; user_id?: number } }>
      }>(action, params)
      const list = data?.messages ?? []
      return list
        .map((h) => ({
          id: `ob-${chat.id}-${h.message_id}`,
          accountId: this.ctx?.accountId ?? 'onebot',
          chatId: chat.id,
          text: segText(h.message) || h.raw_message || '',
          ts: h.time * 1000,
          out: false,
          senderName:
            chat.type === 'group' ? (h.sender?.card || h.sender?.nickname || String(h.sender?.user_id ?? '')) : undefined
        }))
        .reverse()
    } catch {
      // 该 OneBot 实现不支持历史消息扩展
      return []
    }
  }

  async sendText(chat: Chat, text: string): Promise<void> {
    const peer = chat.peer as unknown as ObPeer
    if (peer.kind === 'group') await this.call('send_group_msg', { group_id: peer.id, message: text })
    else await this.call('send_private_msg', { user_id: peer.id, message: text })
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.ws?.close()
    this.ws = null
  }
}
