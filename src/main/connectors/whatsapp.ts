import { join } from 'node:path'
import { rmSync } from 'node:fs'
import * as baileysPkg from '@whiskeysockets/baileys'
import type { WAMessage, WASocket } from '@whiskeysockets/baileys'
import pino from 'pino'
import QRCode from 'qrcode'
import type { Chat, Connector, ConnectorContext, Message } from '../../shared/types'

// 命名空间导入 + 运行时取默认导出，兼容 CJS/ESM 两种打包形态
const { Browsers, DisconnectReason, useMultiFileAuthState } = baileysPkg
const makeWASocket: typeof baileysPkg.default =
  typeof baileysPkg.default === 'function'
    ? baileysPkg.default
    : (baileysPkg as unknown as { makeWASocket: typeof baileysPkg.default }).makeWASocket

/** WhatsApp 多设备协议连接器（个人号，Baileys，扫码登录） */

interface WaPeer {
  jid: string
}

function authDir(): string {
  const env = process.env['CHATHUB_WA_AUTH_DIR']
  if (env) return env
  try {
    // 正式运行在 Electron 主进程；独立测试环境回退到当前目录
    const { app } = require('electron') as typeof import('electron')
    return join(app.getPath('userData'), 'wa-session')
  } catch {
    return join(process.cwd(), '.wa-session')
  }
}

function extractText(m: WAMessage): string {
  const msg = m.message
  if (!msg) return ''
  if (msg.reactionMessage || msg.protocolMessage) return ''
  if (msg.conversation) return msg.conversation
  const ext = msg.extendedTextMessage?.text
  if (ext) return ext
  if (msg.imageMessage) return msg.imageMessage.caption || '[图片]'
  if (msg.videoMessage) return msg.videoMessage.caption || '[视频]'
  if (msg.audioMessage) return '[语音]'
  if (msg.stickerMessage) return '[贴纸]'
  if (msg.documentMessage) return '[文件]'
  return '[消息]'
}

export class WhatsAppConnector implements Connector {
  private sock: WASocket | null = null
  private ctx: ConnectorContext | null = null
  private stopped = false
  private chats = new Map<string, Chat>()
  private msgsByChat = new Map<string, Message[]>()
  private groupNames = new Map<string, string>()
  private contactNames = new Map<string, string>()
  private openWaiter: { resolve: () => void; reject: (e: Error) => void } | null = null

  async start(_creds: Record<string, string>, ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx
    this.stopped = false
    ctx.setStatus('connecting', '连接 WhatsApp…')
    this.setupSocket()
    await new Promise<void>((resolve, reject) => {
      this.openWaiter = { resolve, reject }
    })
  }

  private setupSocket(): void {
    void useMultiFileAuthState(authDir()).then(({ state, saveCreds }) => {
      if (this.stopped) return
      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        browser: Browsers.ubuntu('Chrome'),
        logger: pino({ level: 'silent' })
      })
      this.sock = sock
      sock.ev.on('creds.update', saveCreds)
      sock.ev.on('connection.update', (u) => {
        void this.onConnUpdate(u.qr, u.connection, u.lastDisconnect?.error)
      })
      sock.ev.on('messages.upsert', (ev) => {
        if (ev.type !== 'notify') return
        for (const m of ev.messages) this.onMessage(m)
      })
    }).catch((e: unknown) => {
      this.ctx?.setStatus('error', `WhatsApp 初始化失败：${(e as Error)?.message ?? String(e)}`)
    })
  }

  private async onConnUpdate(
    qr: string | undefined,
    connection: string | undefined,
    err: unknown
  ): Promise<void> {
    if (qr) await this.showQr(qr)
    if (connection === 'open') {
      const me = this.sock?.user?.id ?? ''
      this.ctx?.setStatus('online', `已登录 ${me ? '+' + me.split(':')[0].slice(0, 8) + '…' : ''}`)
      const w = this.openWaiter
      this.openWaiter = null
      w?.resolve()
      await this.loadGroups()
    } else if (connection === 'close') {
      const statusCode = (err as { output?: { statusCode?: number } } | undefined | null)?.output?.statusCode
      if (statusCode === DisconnectReason.loggedOut) {
        rmSync(authDir(), { recursive: true, force: true })
        const w = this.openWaiter
        this.openWaiter = null
        w?.reject(new Error('已在手机上登出该设备，会话已清除；请重新连接并扫码'))
        this.ctx?.setStatus('error', '已登出，请重新连接扫码')
        return
      }
      if (this.stopped) {
        this.ctx?.setStatus('offline', '已断开')
        return
      }
      // 未 open 就断开（如网络问题）：继续等待重连
      this.ctx?.setStatus('connecting', '连接断开，5 秒后重连…')
      setTimeout(() => {
        if (!this.stopped) this.setupSocket()
      }, 5000)
    }
  }

  private async showQr(qr: string): Promise<void> {
    if (!this.ctx) return
    try {
      const qrImage = await QRCode.toDataURL(qr, { margin: 1, width: 264 })
      const pending = this.ctx.requestAuth({
        type: 'qrcode',
        prompt: '用手机 WhatsApp 扫码登录：设置 → 已关联的设备 → 关联设备',
        qrImage
      })
      pending.catch((e: Error) => {
        if (e?.message === '已取消') {
          this.stopped = true
          this.sock?.end(undefined)
          const w = this.openWaiter
          this.openWaiter = null
          w?.reject(new Error('已取消扫码'))
        }
        // superseded（二维码刷新覆盖）忽略
      })
    } catch {
      /* 二维码生成失败，等待下次刷新 */
    }
  }

  private async loadGroups(): Promise<void> {
    try {
      const groups = await this.sock?.groupFetchAllParticipating()
      for (const [jid, g] of Object.entries(groups ?? {})) {
        this.groupNames.set(jid, g.subject)
        const old = this.chats.get(jid)
        this.chats.set(jid, {
          id: jid,
          accountId: this.ctx?.accountId ?? 'whatsapp',
          type: 'group',
          title: g.subject,
          peer: { jid },
          lastText: old?.lastText,
          lastTs: old?.lastTs
        })
      }
      this.ctx?.pushChats([...this.chats.values()])
    } catch {
      /* 拉取群列表失败不致命 */
    }
  }

  private cacheMsg(msg: Message): void {
    const list = this.msgsByChat.get(msg.chatId) ?? (this.msgsByChat.set(msg.chatId, []).get(msg.chatId) as Message[])
    if (!list.some((m) => m.id === msg.id)) {
      list.push(msg)
      if (list.length > 200) list.splice(0, list.length - 200)
    }
  }

  private onMessage(m: WAMessage): void {
    const jid = m.key.remoteJid
    if (!jid || jid === 'status@broadcast') return
    const text = extractText(m)
    if (!text.trim()) return
    const isGroup = jid.endsWith('@g.us')
    const ts = Number(m.messageTimestamp ?? Date.now() / 1000) * 1000
    if (!isGroup && m.pushName) this.contactNames.set(jid, m.pushName)
    const title =
      (isGroup ? this.groupNames.get(jid) : this.contactNames.get(jid)) ||
      m.pushName ||
      jid.split('@')[0].split(':')[0]
    const chat: Chat = {
      id: jid,
      accountId: this.ctx?.accountId ?? 'whatsapp',
      type: isGroup ? 'group' : 'private',
      title,
      peer: { jid },
      lastText: text.slice(0, 60),
      lastTs: ts
    }
    const msg: Message = {
      id: `wa-${m.key.id ?? Date.now()}`,
      accountId: this.ctx?.accountId ?? 'whatsapp',
      chatId: jid,
      text,
      ts,
      out: !!m.key.fromMe,
      senderName:
        isGroup && !m.key.fromMe
          ? m.pushName || (m.key.participant ? m.key.participant.split('@')[0] : undefined)
          : undefined
    }
    this.chats.set(jid, chat)
    this.cacheMsg(msg)
    this.ctx?.upsertChat(chat)
    this.ctx?.pushMessage(msg)
  }

  async listChats(): Promise<Chat[]> {
    return [...this.chats.values()]
  }

  async history(chat: Chat, limit: number): Promise<Message[]> {
    // Baileys 不提供服务端历史查询，返回本次运行内的本地缓存
    return (this.msgsByChat.get(chat.id) ?? []).slice(-limit)
  }

  async sendText(chat: Chat, text: string): Promise<void> {
    const peer = chat.peer as unknown as WaPeer
    if (!this.sock) throw new Error('WhatsApp 未连接')
    await this.sock.sendMessage(peer.jid, { text })
  }

  async stop(): Promise<void> {
    this.stopped = true
    const w = this.openWaiter
    this.openWaiter = null
    w?.reject(new Error('已断开'))
    this.sock?.end(undefined)
    this.sock = null
  }
}
