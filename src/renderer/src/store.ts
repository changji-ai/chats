import { computed, reactive, watch } from 'vue'
import type { AppSettings, AuthStep, Chat, ConnStatus, Message, PlatformRuntime, UpdateStatus } from '../../shared/types'

export interface State {
  settings: AppSettings | null
  accounts: PlatformRuntime[]
  chatsByAccount: Record<string, Map<string, Chat>>
  unreadByChat: Record<string, number>
  messagesByChat: Record<string, Message[]>
  activeAccount: string
  activeChat: string
  settingsOpen: boolean
  addOpen: boolean
  authPrompt: { accountId: string; step: AuthStep } | null
  search: string
  error: string
  appVersion: string
  update: UpdateStatus
}

export const s: State = reactive({
  settings: null,
  accounts: [],
  chatsByAccount: {},
  unreadByChat: {},
  messagesByChat: {},
  activeAccount: '',
  activeChat: '',
  settingsOpen: false,
  addOpen: false,
  authPrompt: null,
  search: '',
  error: '',
  appVersion: '',
  update: { status: '' }
})

// ---------- 计算 ----------
export const totalUnread = computed(() => Object.values(s.unreadByChat).reduce((a, b) => a + (b || 0), 0))

export function accountUnread(accountId: string): number {
  let n = 0
  for (const [k, v] of Object.entries(s.unreadByChat)) if (k.startsWith(`${accountId}/`)) n += v || 0
  return n
}

export function chatUnread(accountId: string, chatId: string): number {
  return s.unreadByChat[`${accountId}/${chatId}`] ?? 0
}

export function runtimeOf(accountId: string): PlatformRuntime | undefined {
  return s.accounts.find((p) => p.account.id === accountId)
}

export async function refreshAccounts(): Promise<void> {
  s.accounts = await window.api.accounts.list()
}

export function accountLabel(rt: PlatformRuntime | undefined): string {
  if (!rt) return ''
  return rt.account.label ?? rt.def.name
}

// ---------- 动作 ----------
export function selectAccount(accountId: string): void {
  if (s.activeAccount !== accountId) {
    s.activeAccount = accountId
    s.activeChat = ''
  }
}

export async function selectChat(accountId: string, chatId: string): Promise<void> {
  s.activeAccount = accountId
  s.activeChat = chatId
  s.unreadByChat[`${accountId}/${chatId}`] = 0
  void window.api.ui.setActive(accountId, chatId)
  const chat = s.chatsByAccount[accountId]?.get(chatId)
  if (!chat) return
  const key = `${accountId}/${chatId}`
  try {
    s.messagesByChat[key] = await window.api.msg.history(accountId, chat, 50)
  } catch {
    s.messagesByChat[key] = []
  }
}

export async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim()
  const aid = s.activeAccount
  const chat = s.chatsByAccount[aid]?.get(s.activeChat)
  if (!chat || !trimmed) return
  const key = `${aid}/${chat.id}`
  const list = s.messagesByChat[key] ?? (s.messagesByChat[key] = [])
  const local: Message = {
    id: `local-${Date.now()}`,
    accountId: aid,
    chatId: chat.id,
    text: trimmed,
    ts: Date.now(),
    out: true
  }
  list.push(local)
  try {
    await window.api.msg.send(aid, chat, trimmed)
  } catch (e) {
    const i = list.indexOf(local)
    if (i >= 0) list.splice(i, 1)
    s.error = `发送失败：${(e as Error)?.message ?? String(e)}`
    window.setTimeout(() => {
      s.error = ''
    }, 4000)
  }
}

export async function removeAccount(accountId: string): Promise<void> {
  await window.api.accounts.remove(accountId)
  delete s.chatsByAccount[accountId]
  for (const k of Object.keys(s.unreadByChat)) if (k.startsWith(`${accountId}/`)) delete s.unreadByChat[k]
  for (const k of Object.keys(s.messagesByChat)) if (k.startsWith(`${accountId}/`)) delete s.messagesByChat[k]
  await refreshAccounts()
  if (s.activeAccount === accountId) {
    s.activeAccount = s.accounts[0]?.account.id ?? ''
    s.activeChat = ''
  }
}

// ---------- 事件 ----------
function onMsgNew({ msg }: { msg: Message }): void {
  const key = `${msg.accountId}/${msg.chatId}`
  const list = s.messagesByChat[key]
  if (list) {
    if (msg.out) {
      // 协议回显：移除同文本的本地占位消息
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].id.startsWith('local-') && list[i].text === msg.text) {
          list.splice(i, 1)
          break
        }
      }
    }
    if (!list.some((m) => m.id === msg.id)) {
      list.push(msg)
      if (list.length > 300) list.splice(0, list.length - 300)
    }
  }
  const isActive = s.activeAccount === msg.accountId && s.activeChat === msg.chatId
  if (!isActive) s.unreadByChat[key] = (s.unreadByChat[key] ?? 0) + 1
  const map = s.chatsByAccount[msg.accountId] ?? (s.chatsByAccount[msg.accountId] = new Map())
  const chat = map.get(msg.chatId)
  if (chat) {
    chat.lastText = msg.text.slice(0, 60)
    chat.lastTs = msg.ts
  } else {
    map.set(msg.chatId, {
      id: msg.chatId,
      accountId: msg.accountId,
      type: 'private',
      title: msg.chatId,
      peer: {},
      lastText: msg.text.slice(0, 60),
      lastTs: msg.ts
    })
  }
}

function drawBadge(n: number): string {
  const c = document.createElement('canvas')
  c.width = 36
  c.height = 36
  const g = c.getContext('2d')
  if (!g) return ''
  g.beginPath()
  g.arc(18, 18, 17, 0, Math.PI * 2)
  g.fillStyle = '#e5484d'
  g.fill()
  g.fillStyle = '#fff'
  g.font = 'bold 19px "Segoe UI", system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(n > 99 ? '99+' : String(n), 18, 20)
  return c.toDataURL('image/png')
}

// ---------- 初始化 ----------
export async function init(): Promise<void> {
  s.appVersion = await window.api.app.version()
  s.settings = await window.api.settings.get()
  document.body.dataset.theme = s.settings.theme
  await refreshAccounts()
  if (s.accounts.length && !s.activeAccount) s.activeAccount = s.accounts[0].account.id

  window.api.on.status(({ accountId, status, detail }) => {
    const p = runtimeOf(accountId)
    if (p) {
      p.status = status as ConnStatus
      p.detail = detail
    }
    // 登录完成/失败后关闭该账号的登录弹窗（如 WhatsApp 扫码完成）
    if (s.authPrompt?.accountId === accountId && ['online', 'error', 'idle'].includes(status)) {
      s.authPrompt = null
    }
  })
  window.api.on.auth(({ accountId, step }) => {
    if (!step) {
      if (s.authPrompt?.accountId === accountId) s.authPrompt = null
    } else {
      s.authPrompt = { accountId, step }
    }
  })
  window.api.on.chatsUpdate(({ accountId, chats }) => {
    const map = new Map(chats.map((c) => [c.id, c]))
    const old = s.chatsByAccount[accountId]
    if (old) {
      for (const [k, v] of old) {
        if (!map.has(k) && (v.lastTs || chatUnread(accountId, k) > 0)) map.set(k, v)
      }
    }
    s.chatsByAccount[accountId] = map
  })
  window.api.on.chatsUpsert(({ accountId, chat }) => {
    const map = s.chatsByAccount[accountId] ?? (s.chatsByAccount[accountId] = new Map())
    const old = map.get(chat.id)
    map.set(chat.id, old ? { ...chat, lastText: chat.lastText ?? old.lastText, lastTs: chat.lastTs ?? old.lastTs } : chat)
  })
  window.api.on.msgNew(onMsgNew)
  window.api.on.switchPlatform(({ index }) => {
    const p = s.accounts[index]
    if (p) selectAccount(p.account.id)
  })
  window.api.on.openSettings(() => {
    s.settingsOpen = true
  })
  window.api.on.navigate(({ accountId, chatId }) => {
    void selectChat(accountId, chatId)
  })

  window.api.on.updateStatus((st) => {
    s.update = st
  })

  watch(
    totalUnread,
    (n) => {
      window.api.ui.setBadge(n > 0 ? drawBadge(n) : null)
    },
    { immediate: true }
  )
}

// ---------- 格式化 ----------
export function fmtUnread(n: number): string {
  return n > 99 ? '99+' : String(n)
}

export function fmtTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function typeLabel(t: string): string {
  return t === 'private' ? '私聊' : t === 'group' ? '群组' : '频道'
}
