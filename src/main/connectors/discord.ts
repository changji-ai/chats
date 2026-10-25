import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message as DMessage,
  type TextBasedChannel
} from 'discord.js'
import type { Chat, Connector, ConnectorContext, Message } from '../../shared/types'

/** Discord 官方 Bot 协议连接器（discord.js） */

interface DcPeer {
  channelId: string
  guildId?: string
}

export class DiscordConnector implements Connector {
  private client: Client | null = null
  private ctx: ConnectorContext | null = null

  async start(creds: Record<string, string>, ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx
    const token = (creds.token ?? '').trim()
    if (!token) throw new Error('缺少 Bot Token')
    ctx.setStatus('connecting', '连接 Discord…')
    await new Promise<void>((resolve, reject) => {
      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages
        ],
        partials: [Partials.Channel]
      })
      this.client = client
      client.once(Events.ClientReady, () => {
        ctx.setStatus('online', `已登录 ${client.user?.tag ?? ''}`)
        resolve()
      })
      client.on(Events.MessageCreate, (m) => this.onMessage(m))
      client.login(token).catch((e) => reject(new Error(`Discord 登录失败：${String((e as Error)?.message ?? e)}`)))
    })
  }

  private chatOf(m: DMessage): Chat | null {
    const ch = m.channel
    const isDm = m.guildId == null
    let title: string
    if (isDm) {
      const recipient = ch.type === ChannelType.DM ? (ch as { recipient?: { username: string } }).recipient : undefined
      title = recipient?.username ?? m.author.username
    } else {
      const name = (ch as { name?: string }).name ?? '频道'
      title = `${m.guild?.name ?? '服务器'} · #${name}`
    }
    return {
      id: m.channelId,
      accountId: this.ctx?.accountId ?? 'discord',
      type: isDm ? 'private' : 'group',
      title,
      peer: { channelId: m.channelId, guildId: m.guildId ?? undefined },
      lastText: (m.content || '[附件]').slice(0, 60),
      lastTs: m.createdTimestamp
    }
  }

  private onMessage(m: DMessage): void {
    const self = this.client?.user?.id
    if (!self || m.author.id === self) return
    const chat = this.chatOf(m)
    if (!chat) return
    const text = m.content?.trim() || '[附件]'
    const msg: Message = {
      id: `dc-${m.id}`,
      accountId: this.ctx?.accountId ?? 'discord',
      chatId: chat.id,
      text,
      ts: m.createdTimestamp,
      out: false,
      senderName: m.guildId ? m.author.username : undefined
    }
    this.ctx?.upsertChat(chat)
    this.ctx?.pushMessage(msg)
  }

  async listChats(): Promise<Chat[]> {
    const client = this.client
    if (!client) return []
    const chats: Chat[] = []
    for (const ch of client.channels.cache.values()) {
      if (ch.type === ChannelType.DM) {
        const recipient = (ch as { recipient?: { username: string } }).recipient
        chats.push({
          id: ch.id,
          accountId: this.ctx?.accountId ?? 'discord',
          type: 'private',
          title: recipient?.username ?? '私信',
          peer: { channelId: ch.id }
        })
      } else if (
        ch.isTextBased() &&
        (ch.type === ChannelType.GuildText ||
          ch.type === ChannelType.GuildAnnouncement ||
          ch.type === ChannelType.PublicThread ||
          ch.type === ChannelType.PrivateThread)
      ) {
        const anyCh = ch as unknown as { name?: string; guild?: { name?: string }; guildId?: string }
        chats.push({
          id: ch.id,
          accountId: this.ctx?.accountId ?? 'discord',
          type: 'group',
          title: `${anyCh.guild?.name ?? '服务器'} · #${anyCh.name ?? ''}`,
          peer: { channelId: ch.id, guildId: anyCh.guildId }
        })
      }
    }
    return chats.slice(0, 200)
  }

  private async fetchChannel(chat: Chat): Promise<TextBasedChannel | null> {
    const client = this.client
    if (!client) return null
    const peer = chat.peer as unknown as DcPeer
    try {
      const ch = await client.channels.fetch(peer.channelId)
      if (ch?.isTextBased()) return ch
    } catch {
      /* 频道不存在 */
    }
    return null
  }

  async history(chat: Chat, limit: number): Promise<Message[]> {
    const ch = await this.fetchChannel(chat)
    if (!ch) return []
    const msgs = await ch.messages.fetch({ limit })
    const self = this.client?.user?.id
    return [...msgs.values()]
      .filter((m) => m.content)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .slice(-limit)
      .map((m) => ({
        id: `dc-${m.id}`,
        accountId: this.ctx?.accountId ?? 'discord',
        chatId: chat.id,
        text: m.content,
        ts: m.createdTimestamp,
        out: !!self && m.author.id === self,
        senderName: m.guildId ? m.author.username : undefined
      }))
  }

  async sendText(chat: Chat, text: string): Promise<void> {
    const ch = await this.fetchChannel(chat)
    if (!ch) throw new Error('找不到该频道（bot 可能已被移出）')
    await (ch as unknown as { send: (content: string) => Promise<unknown> }).send(text)
  }

  async stop(): Promise<void> {
    await this.client?.destroy()
    this.client = null
  }
}
