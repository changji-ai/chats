import * as matrixSdk from 'matrix-js-sdk'
import type { Chat, Connector, ConnectorContext, Message } from '../../shared/types'

/**
 * Matrix 连接器（开放协议，个人账号）：
 * 密码登录后保存 access_token，之后免密；同步拉房间与时间线，实时收发。
 */

type MatrixClient = ReturnType<typeof matrixSdk.createClient>
type Room = ReturnType<MatrixClient['getRooms']>[number]
type MatrixEvent = ReturnType<Room['getLiveTimeline']>['events'][number]

const sdk = matrixSdk as unknown as typeof matrixSdk & Record<string, unknown>
const createClient: typeof matrixSdk.createClient =
  sdk.createClient ?? (sdk.default as unknown as typeof matrixSdk.createClient)

export class MatrixConnector implements Connector {
  private client: MatrixClient | null = null
  private ctx: ConnectorContext | null = null
  private chats = new Map<string, Chat>()
  private msgsByChat = new Map<string, Message[]>()
  private userId = ''
  private stopped = false

  async start(creds: Record<string, string>, ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx
    this.stopped = false
    const homeserver = creds['homeserver'] || 'https://matrix.org'
    const user = creds['user'] || ''
    if (!user) throw new Error('缺少用户名')
    ctx.setStatus('connecting', '连接 Matrix…')
    let accessToken = creds['accessToken'] ?? ''

    if (!accessToken) {
      // 密码登录（一次性），成功后保存令牌
      if (!creds['password']) throw new Error('缺少密码或访问令牌')
      const temp = createClient({ baseUrl: homeserver })
      const login = (await (temp.login('m.login.password', {
        user,
        password: creds['password']
      }) as unknown as Promise<{ access_token?: string; user_id?: string }>)) as {
        access_token?: string
        user_id?: string
      }
      if (!login.access_token) throw new Error('登录失败：账号或密码错误')
      accessToken = login.access_token
      this.userId = login.user_id ?? user
      ctx.saveCredentials({ homeserver, user: this.userId, accessToken, password: '' })
    } else {
      this.userId = user
    }

    const client = createClient({ baseUrl: homeserver, accessToken, userId: this.userId })
    this.client = client

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('同步超时（检查服务器地址）')), 45000)
      client.once('sync' as Parameters<MatrixClient['on']>[0], (state: string) => {
        if (state === 'PREPARED') {
          clearTimeout(timer)
          resolve()
        }
      })
      client.on('sync' as Parameters<MatrixClient['on']>[0], (state: string, _prev: string, data?: { error?: Error }) => {
        if (state === 'ERROR' && data?.error) {
          clearTimeout(timer)
          reject(new Error(`同步失败：${data.error.message}（令牌可能已失效，清空密码重连可重新登录）`))
        }
      })
      client.startClient({ initialSyncLimit: 20 })
    })
    if (this.stopped) return
    ctx.setStatus('online', `已登录 ${this.userId}`)

    client.on('Room.timeline' as Parameters<MatrixClient['on']>[0], (ev: MatrixEvent, room: Room | undefined) => {
      if (!room) return
      const msg = this.toMessage(ev, room)
      if (!msg) return
      const chat = this.toChat(room, msg)
      this.chats.set(chat.id, chat)
      const list = this.msgsByChat.get(room.roomId) ?? (this.msgsByChat.set(room.roomId, []).get(room.roomId) as Message[])
      if (!list.some((m) => m.id === msg.id)) {
        list.push(msg)
        if (list.length > 200) list.splice(0, list.length - 200)
      }
      this.ctx?.upsertChat(chat)
      this.ctx?.pushMessage(msg)
    })

    for (const room of client.getRooms()) {
      const chat = this.toChat(room)
      this.chats.set(chat.id, chat)
      for (const ev of room.getLiveTimeline().getEvents()) {
        const m = this.toMessage(ev, room)
        if (!m) continue
        const list = this.msgsByChat.get(room.roomId) ?? (this.msgsByChat.set(room.roomId, []).get(room.roomId) as Message[])
        if (!list.some((x) => x.id === m.id)) list.push(m)
      }
    }
    ctx.pushChats([...this.chats.values()])
  }

  private toChat(room: Room, latest?: Message): Chat {
    return {
      id: room.roomId,
      accountId: this.ctx?.accountId ?? 'matrix',
      type: room.getJoinedMemberCount() > 2 ? 'group' : 'private',
      title: room.name || room.roomId,
      peer: { roomId: room.roomId },
      lastText: latest?.text.slice(0, 60),
      lastTs: latest?.ts
    }
  }

  private toMessage(ev: MatrixEvent, room: Room): Message | null {
    try {
      if (ev.getType() !== 'm.room.message') return null
      const content = ev.getContent() as { msgtype?: string; body?: string }
      if (!content.body) return null
      if (content.msgtype && !['m.text', 'm.emote'].includes(content.msgtype)) {
        if (content.msgtype === 'm.image') return this.wrap(ev, room, '[图片]', '')
        return null
      }
      return this.wrap(ev, room, content.body, content.msgtype === 'm.emote' ? '* ' : '')
    } catch {
      return null
    }
  }

  private wrap(ev: MatrixEvent, room: Room, text: string, prefix: string): Message {
    const sender = ev.getSender() ?? ''
    const out = sender === this.userId
    const ts = ev.getTs?.() ?? Date.now()
    let senderName: string | undefined
    if (!out && room.getMember) {
      const member = room.getMember(sender)
      senderName = member?.name ?? sender
    }
    return {
      id: `mx-${ev.getId?.() ?? ts}`,
      accountId: this.ctx?.accountId ?? 'matrix',
      chatId: room.roomId,
      text: prefix + text,
      ts,
      out,
      senderName
    }
  }

  async listChats(): Promise<Chat[]> {
    return [...this.chats.values()]
  }

  async history(chat: Chat, limit: number): Promise<Message[]> {
    const list = this.msgsByChat.get(chat.id) ?? []
    return list.slice(-limit)
  }

  async sendText(chat: Chat, text: string): Promise<void> {
    if (!this.client) throw new Error('Matrix 未连接')
    const peer = chat.peer as { roomId?: string }
    if (!peer.roomId) throw new Error('会话信息缺失')
    await this.client.sendTextMessage(peer.roomId, text)
    const msg: Message = {
      id: `mx-out-${Date.now()}`,
      accountId: this.ctx?.accountId ?? 'matrix',
      chatId: peer.roomId,
      text,
      ts: Date.now(),
      out: true
    }
    const list = this.msgsByChat.get(peer.roomId) ?? (this.msgsByChat.set(peer.roomId, []).get(peer.roomId) as Message[])
    list.push(msg)
    this.ctx?.pushMessage(msg)
  }

  async stop(): Promise<void> {
    this.stopped = true
    try {
      await this.client?.stopClient()
    } catch {
      /* 忽略关闭异常 */
    }
    this.ctx?.setStatus('offline', '已断开')
  }
}
