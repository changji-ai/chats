import { app, ipcMain, nativeImage, Notification, type BrowserWindow } from 'electron'
import { PLATFORMS } from '../shared/platforms'
import type { Account, AppSettings, Chat, ConnStatus, Connector, ConnectorContext, Message, PlatformDef, PlatformRuntime } from '../shared/types'
import { getCreds, loadSettings, putCreds, saveSettings } from './store'
import { createConnector } from './connectors'

interface Instance {
  status: ConnStatus
  detail: string
  connector: Connector
}

/**
 * 连接器中枢：以「账号」为单位管理连接器实例（用户添加账号时选平台模板），
 * 一个平台模板可挂多个账号（如多个 OneBot 实例）。
 */
export function registerHub(getWin: () => BrowserWindow | null): void {
  const instances = new Map<string, Instance>()
  const authWaiters = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }>()
  const titles = new Map<string, string>() // `${accountId}/${chatId}` -> 会话标题
  let settings: AppSettings = loadSettings()

  const send = (channel: string, payload: unknown): void => {
    getWin()?.webContents.send(channel, payload)
  }
  const templateOf = (platformId: string): PlatformDef | undefined => PLATFORMS.find((p) => p.id === platformId)
  const accountOf = (id: string): Account | undefined => settings.accounts.find((a) => a.id === id)

  // 旧版把凭据直接挂在平台 id 上：有凭据/自动连/静音记录的平台自动升级为账号
  const migrateLegacy = (): void => {
    let changed = false
    const known = new Set(settings.accounts.map((a) => a.id))
    for (const p of PLATFORMS) {
      if (known.has(p.id)) continue
      const has =
        Object.keys(getCreds(p.id)).length > 0 || !!settings.autoConnect?.[p.id] || !!settings.muted?.[p.id]
      if (has) {
        settings.accounts.push({ id: p.id, platformId: p.id })
        changed = true
      }
    }
    if (changed) saveSettings(settings)
  }

  const isConfigured = (accountId: string): boolean => {
    const account = accountOf(accountId)
    if (!account) return false
    const def = templateOf(account.platformId)
    if (!def) return false
    const creds = getCreds(accountId)
    return def.fields.filter((f) => f.required).every((f) => (creds[f.key] ?? '').trim() !== '')
  }

  const runtimeOf = (account: Account): PlatformRuntime | null => {
    const def = templateOf(account.platformId)
    if (!def) return null
    const inst = instances.get(account.id)
    return {
      def,
      account,
      status: inst?.status ?? 'idle',
      detail: inst?.detail ?? '',
      configured: isConfigured(account.id)
    }
  }

  const pushStatus = (accountId: string): void => {
    const account = accountOf(accountId)
    if (!account) return
    const rt = runtimeOf(account)
    if (rt) send('conn:status', { accountId, status: rt.status, detail: rt.detail })
  }

  const accountName = (accountId: string): string => {
    const account = accountOf(accountId)
    if (!account) return accountId
    return account.label ?? templateOf(account.platformId)?.name ?? accountId
  }

  const onMessage = (accountId: string, msg: Message): void => {
    send('msg:new', { msg })
    const win = getWin()
    if (!win) return
    const isActive = active.accountId === accountId && active.chatId === msg.chatId
    if (!settings.notifications || settings.muted[accountId] || isActive || win.isFocused()) return
    if (!Notification.isSupported()) return
    const chatTitle = titles.get(`${accountId}/${msg.chatId}`) ?? ''
    const n = new Notification({
      title: `${accountName(accountId)}${chatTitle ? ` · ${chatTitle}` : ''}`,
      body: msg.text.slice(0, 80)
    })
    n.on('click', () => {
      win.show()
      win.focus()
      send('ui:navigate', { accountId, chatId: msg.chatId })
    })
    n.show()
  }

  const active = { accountId: '', chatId: '' }

  const makeCtx = (account: Account): ConnectorContext => {
    const id = account.id
    const inst = instances.get(id)
    if (!inst) throw new Error(`account ${id} not instantiated`)
    const rememberTitle = (chat: Chat): void => {
      if (chat.title) titles.set(`${id}/${chat.id}`, chat.title)
    }
    return {
      accountId: id,
      setStatus: (status, detail = '') => {
        inst.status = status
        inst.detail = detail
        if (status === 'online' && !settings.autoConnect?.[id]) {
          settings.autoConnect = { ...(settings.autoConnect ?? {}), [id]: true }
          saveSettings(settings)
        }
        pushStatus(id)
      },
      requestAuth: (step) =>
        new Promise<string>((resolve, reject) => {
          const old = authWaiters.get(id)
          if (old) {
            authWaiters.delete(id)
            old.reject(new Error('superseded'))
          }
          inst.status = 'waiting-auth'
          inst.detail = step.prompt
          pushStatus(id)
          authWaiters.set(id, { resolve, reject })
          send('conn:auth', { accountId: id, step })
        }),
      pushChats: (chats) => {
        chats.forEach(rememberTitle)
        send('chats:update', { accountId: id, chats })
      },
      upsertChat: (chat) => {
        rememberTitle(chat)
        send('chats:upsert', { accountId: id, chat })
      },
      pushMessage: (msg) => onMessage(id, msg),
      saveCredentials: (patch) => putCreds(id, patch)
    }
  }

  const disconnect = (accountId: string): void => {
    const inst = instances.get(accountId)
    if (!inst) return
    instances.delete(accountId)
    const waiter = authWaiters.get(accountId)
    if (waiter) {
      authWaiters.delete(accountId)
      waiter.reject(new Error('已取消'))
      send('conn:auth', { accountId, step: null })
    }
    void inst.connector.stop().catch(() => {})
    if (settings.autoConnect?.[accountId]) {
      // 手动断开 = 下次启动不再自动连
      settings.autoConnect = { ...(settings.autoConnect ?? {}), [accountId]: false }
      saveSettings(settings)
    }
    pushStatus(accountId)
  }

  const connect = (accountId: string): void => {
    const account = accountOf(accountId)
    if (!account) return
    const def = templateOf(account.platformId)
    if (!def) {
      send('conn:status', { accountId, status: 'idle', detail: '平台模板缺失' })
      return
    }
    disconnect(accountId)
    if (!isConfigured(accountId)) {
      send('conn:status', { accountId, status: 'idle', detail: '请先填写账号信息' })
      return
    }
    const connector = createConnector(def)
    if (!connector) {
      send('conn:status', { accountId, status: 'idle', detail: '该平台连接器尚未实现' })
      return
    }
    instances.set(accountId, { status: 'connecting', detail: '', connector })
    pushStatus(accountId)
    const ctx = makeCtx(account)
    void connector
      .start(getCreds(accountId), ctx)
      .then(async () => {
        try {
          ctx.pushChats(await connector.listChats())
        } catch {
          /* 连接器自行推送过了 */
        }
      })
      .catch((err: unknown) => {
        if (instances.get(accountId)?.connector === connector) {
          instances.set(accountId, { status: 'error', detail: (err as Error)?.message ?? String(err), connector })
          pushStatus(accountId)
        }
      })
  }

  // ---------- IPC ----------
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:save', (_e, patch: Partial<AppSettings>) => {
    // accounts 只能通过 accounts:add/remove 管理，settings:save 不动它
    const { accounts: _drop, ...rest } = patch
    settings = { ...settings, ...rest, muted: { ...settings.muted, ...(patch.muted ?? {}) } }
    saveSettings(settings)
    if (patch.autoLaunch !== undefined) app.setLoginItemSettings({ openAtLogin: settings.autoLaunch })
    return settings
  })
  ipcMain.handle('accounts:list', () =>
    settings.accounts.map((a) => runtimeOf(a)).filter((r): r is PlatformRuntime => r !== null)
  )
  ipcMain.handle('accounts:add', (_e, platformId: string, label: string, creds: Record<string, string>) => {
    const def = templateOf(platformId)
    if (!def) throw new Error('未知平台')
    const id = `${platformId}~${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    const account: Account = { id, platformId, label: label.trim() || undefined }
    putCreds(id, creds)
    settings.accounts.push(account)
    saveSettings(settings)
    connect(id)
    const rt = runtimeOf(account)
    if (!rt) throw new Error('账号创建失败')
    return rt
  })
  ipcMain.handle('accounts:remove', (_e, accountId: string) => {
    const account = accountOf(accountId)
    if (!account) return
    disconnect(accountId)
    const def = templateOf(account.platformId)
    const empty: Record<string, string> = {}
    for (const f of def?.fields ?? []) empty[f.key] = ''
    putCreds(accountId, empty)
    settings.accounts = settings.accounts.filter((a) => a.id !== accountId)
    delete settings.autoConnect?.[accountId]
    delete settings.muted[accountId]
    saveSettings(settings)
    return null
  })
  ipcMain.handle('creds:get', (_e, accountId: string) => getCreds(accountId))
  ipcMain.handle('creds:save', (_e, accountId: string, values: Record<string, string>) => {
    putCreds(accountId, values)
  })
  ipcMain.handle('conn:connect', (_e, accountId: string) => {
    connect(accountId)
  })
  ipcMain.handle('conn:disconnect', (_e, accountId: string) => {
    disconnect(accountId)
  })
  ipcMain.handle('chats:load', (_e, accountId: string) => instances.get(accountId)?.connector.listChats() ?? [])
  ipcMain.handle('msg:history', (_e, accountId: string, chat: Chat, limit?: number) =>
    instances.get(accountId)?.connector.history(chat, limit ?? 50) ?? []
  )
  ipcMain.handle('msg:send', (_e, accountId: string, chat: Chat, text: string) =>
    instances.get(accountId)?.connector.sendText(chat, text)
  )
  ipcMain.handle('auth:submit', (_e, accountId: string, value: string) => {
    authWaiters.get(accountId)?.resolve(value)
    authWaiters.delete(accountId)
  })
  ipcMain.handle('auth:cancel', (_e, accountId: string) => {
    const waiter = authWaiters.get(accountId)
    authWaiters.delete(accountId)
    send('conn:auth', { accountId, step: null })
    waiter?.reject(new Error('已取消'))
  })
  ipcMain.handle('ui:active', (_e, accountId: string, chatId: string) => {
    active.accountId = accountId
    active.chatId = chatId
  })
  ipcMain.on('ui:set-badge', (_e, dataUrl: string | null) => {
    const win = getWin()
    if (!win) return
    if (dataUrl) win.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), '有未读消息')
    else win.setOverlayIcon(null, '')
  })

  // 启动：旧数据迁移 + 自动重连（连接成功过的账号；Telegram 有 session 免交互）
  migrateLegacy()
  for (const account of settings.accounts) {
    if (isConfigured(account.id) && (account.platformId === 'telegram' || settings.autoConnect?.[account.id])) {
      connect(account.id)
    }
  }
}
