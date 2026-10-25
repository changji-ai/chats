import { Api, TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { NewMessage } from 'telegram/events'
import type { NewMessageEvent } from 'telegram/events'
import type { Chat, Connector, ConnectorContext, Message } from '../../shared/types'

/** Telegram MTProto 协议连接器（个人账号，gramjs） */

interface TgPeer {
  kind: 'user' | 'chat' | 'channel'
  id: number
}

type TgEntity = Api.User | Api.Chat | Api.Channel

function peerKey(p: TgPeer): string {
  return p.kind === 'user' ? `u${p.id}` : p.kind === 'chat' ? `c${p.id}` : `ch${p.id}`
}

/** 转成 gramjs 认识的 marked id（频道/超级群需要 -100 前缀） */
function entityInput(p: TgPeer): number {
  return p.kind === 'channel' ? Number(`-100${p.id}`) : p.id
}

function peerOfEntity(e: TgEntity): TgPeer {
  if (e instanceof Api.User) return { kind: 'user', id: Number(e.id) }
  if (e instanceof Api.Channel) return { kind: 'channel', id: Number(e.id) }
  return { kind: 'chat', id: Number(e.id) }
}

function entityTitle(e: TgEntity): string {
  if (e instanceof Api.User) {
    return [e.firstName, e.lastName].filter(Boolean).join(' ') || e.username || String(e.id)
  }
  return e.title || String(e.id)
}

function chatTypeOf(e: TgEntity): 'private' | 'group' {
  if (e instanceof Api.User) return 'private'
  return 'group'
}

function mediaLabel(m: Api.Message): string {
  if (!m.media) return ''
  if (m.media instanceof Api.MessageMediaPhoto) return '[图片]'
  if (m.media instanceof Api.MessageMediaDocument) return '[文件]'
  return '[消息]'
}

export class TelegramConnector implements Connector {
  private client: TelegramClient | null = null
  private ctx: ConnectorContext | null = null
  private names = new Map<string, string>()

  async start(creds: Record<string, string>, ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx
    const apiId = Number.parseInt(creds.apiId ?? '', 10)
    const apiHash = (creds.apiHash ?? '').trim()
    if (!Number.isFinite(apiId) || !apiHash) throw new Error('缺少 api_id 或 api_hash（申请方法见设置里的说明）')
    ctx.setStatus('connecting', '连接 Telegram…')
    const client = new TelegramClient(new StringSession(creds.session ?? ''), apiId, apiHash, {
      connectionRetries: 5
    })
    this.client = client
    client.addEventHandler((evt) => {
      void this.onNewMessage(evt)
    }, new NewMessage({}))
    await client.connect()
    if (!(await client.checkAuthorization())) {
      ctx.setStatus('waiting-auth', '等待登录')
      const phone =
        (
          (creds.phone ?? '').trim() ||
          (await ctx.requestAuth({ type: 'text', prompt: '手机号（含国家码，如 +86…）', placeholder: '+8613800138000' }))
        ).replace(/\s+/g, '')
      if (!/^\+?\d+$/.test(phone)) throw new Error(`手机号格式不对：${phone}`)
      const sent = await client.sendCode({ apiId, apiHash }, phone)
      for (let attempt = 0; ; attempt++) {
        if (attempt >= 5) throw new Error('验证码错误次数过多，请稍后断开重连')
        const code = (await ctx.requestAuth({ type: 'code', prompt: `输入发送到 ${phone} 的验证码` })).replace(/\D+/g, '')
        try {
          await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash: sent.phoneCodeHash, phoneCode: code }))
          break
        } catch (err) {
          const msg = String((err as Error)?.message ?? err)
          if (msg.includes('SESSION_PASSWORD_NEEDED')) {
            const pw = await ctx.requestAuth({ type: 'password', prompt: '两步验证密码' })
            await client.signInWithPassword(
              { apiId, apiHash },
              {
                password: async () => pw,
                onError: async (err: Error) => {
                  throw err
                }
              }
            )
            break
          }
          if (msg.includes('PHONE_CODE_INVALID') || msg.includes('PHONE_CODE_EXPIRED')) continue
          throw err
        }
      }
      const saved = client.session.save() as unknown as string
      ctx.saveCredentials({ session: saved, phone })
    }
    ctx.setStatus('online', '已登录')
  }

  private peerFromMessage(m: Api.Message): TgPeer | null {
    const p = m.peerId
    if (p instanceof Api.PeerUser) return { kind: 'user', id: Number(p.userId) }
    if (p instanceof Api.PeerChat) return { kind: 'chat', id: Number(p.chatId) }
    if (p instanceof Api.PeerChannel) return { kind: 'channel', id: Number(p.channelId) }
    return null
  }

  private async titleFor(peer: TgPeer): Promise<string | undefined> {
    const key = peerKey(peer)
    const cached = this.names.get(key)
    if (cached) return cached
    try {
      const e = await this.client!.getEntity(entityInput(peer))
      const t = entityTitle(e as TgEntity)
      this.names.set(key, t)
      return t
    } catch {
      return undefined
    }
  }

  private async senderName(m: Api.Message): Promise<string | undefined> {
    const from = m.fromId
    if (!from || !(from instanceof Api.PeerUser)) return undefined
    const uid = Number(from.userId)
    const key = `u${uid}`
    const cached = this.names.get(key)
    if (cached) return cached
    try {
      const e = await this.client!.getEntity(uid)
      const t = entityTitle(e as TgEntity)
      this.names.set(key, t)
      return t
    } catch {
      return undefined
    }
  }

  private async onNewMessage(evt: NewMessageEvent): Promise<void> {
    const m = evt.message
    const ctx = this.ctx
    if (!(m instanceof Api.Message) || !ctx) return
    const peer = this.peerFromMessage(m)
    if (!peer) return
    const id = peerKey(peer)
    const known = this.names.get(id)
    const title = known ?? (await this.titleFor(peer)) ?? `会话 ${peer.id}`
    const text = m.message?.trim() || mediaLabel(m) || '[消息]'
    const chat: Chat = {
      id,
      accountId: this.ctx?.accountId ?? 'telegram',
      type: peer.kind === 'user' ? 'private' : 'group',
      title,
      peer: { ...peer },
      lastText: text.slice(0, 60),
      lastTs: m.date * 1000
    }
    const msg: Message = {
      id: `tg-${id}-${m.id}`,
      accountId: this.ctx?.accountId ?? 'telegram',
      chatId: id,
      text,
      ts: m.date * 1000,
      out: !!m.out,
      senderName: !m.out && peer.kind !== 'user' ? await this.senderName(m) : undefined
    }
    ctx.upsertChat(chat)
    ctx.pushMessage(msg)
  }

  async listChats(): Promise<Chat[]> {
    if (!this.client) return []
    const dialogs = await this.client.getDialogs({ limit: 100 })
    const chats: Chat[] = []
    for (const d of dialogs) {
      const e = d.entity
      if (!(e instanceof Api.User || e instanceof Api.Chat || e instanceof Api.Channel)) continue
      const peer = peerOfEntity(e)
      const title = entityTitle(e)
      this.names.set(peerKey(peer), title)
      chats.push({
        id: peerKey(peer),
        accountId: this.ctx?.accountId ?? 'telegram',
        type: chatTypeOf(e),
        title,
        peer: { ...peer },
        lastText: d.message?.message?.slice(0, 60) || undefined,
        lastTs: (d.message?.date ?? 0) * 1000 || undefined
      })
    }
    return chats
  }

  async history(chat: Chat, limit: number): Promise<Message[]> {
    if (!this.client) return []
    const peer = chat.peer as unknown as TgPeer
    const msgs = await this.client.getMessages(entityInput(peer), { limit })
    const out: Message[] = []
    for (const m of msgs) {
      if (!(m instanceof Api.Message) || !m.message) continue
      out.push({
        id: `tg-${chat.id}-${m.id}`,
        accountId: this.ctx?.accountId ?? 'telegram',
        chatId: chat.id,
        text: m.message,
        ts: m.date * 1000,
        out: !!m.out,
        senderName: !m.out && peer.kind !== 'user' ? await this.senderName(m) : undefined
      })
    }
    return out.reverse()
  }

  async sendText(chat: Chat, text: string): Promise<void> {
    const peer = chat.peer as unknown as TgPeer
    await this.client!.sendMessage(entityInput(peer), { message: text })
  }

  async stop(): Promise<void> {
    await this.client?.destroy()
    this.client = null
  }
}
