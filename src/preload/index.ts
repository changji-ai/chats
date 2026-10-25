import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, AuthStep, Chat, Message, PlatformRuntime, UpdateStatus } from '../shared/types'

function listen<T>(channel: string, cb: (payload: T) => void): () => void {
  const l = (_e: Electron.IpcRendererEvent, p: T): void => cb(p)
  ipcRenderer.on(channel, l)
  return () => ipcRenderer.removeListener(channel, l)
}

const api = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
    save: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:save', patch) as Promise<AppSettings>
  },
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list') as Promise<PlatformRuntime[]>,
    add: (platformId: string, label: string, creds: Record<string, string>) =>
      ipcRenderer.invoke('accounts:add', platformId, label, creds) as Promise<PlatformRuntime>,
    remove: (accountId: string) => ipcRenderer.invoke('accounts:remove', accountId) as Promise<void>
  },
  conn: {
    connect: (accountId: string) => ipcRenderer.invoke('conn:connect', accountId) as Promise<void>,
    disconnect: (accountId: string) => ipcRenderer.invoke('conn:disconnect', accountId) as Promise<void>
  },
  creds: {
    get: (accountId: string) => ipcRenderer.invoke('creds:get', accountId) as Promise<Record<string, string>>,
    save: (accountId: string, values: Record<string, string>) =>
      ipcRenderer.invoke('creds:save', accountId, values) as Promise<void>
  },
  chats: {
    load: (accountId: string) => ipcRenderer.invoke('chats:load', accountId) as Promise<Chat[]>
  },
  msg: {
    history: (accountId: string, chat: Chat, limit = 50) =>
      ipcRenderer.invoke('msg:history', accountId, chat, limit) as Promise<Message[]>,
    send: (accountId: string, chat: Chat, text: string) =>
      ipcRenderer.invoke('msg:send', accountId, chat, text) as Promise<void>
  },
  auth: {
    submit: (accountId: string, value: string) => ipcRenderer.invoke('auth:submit', accountId, value) as Promise<void>,
    cancel: (accountId: string) => ipcRenderer.invoke('auth:cancel', accountId) as Promise<void>
  },
  ui: {
    setActive: (accountId: string, chatId: string) => ipcRenderer.invoke('ui:active', accountId, chatId) as Promise<void>,
    setBadge: (dataUrl: string | null): void => {
      ipcRenderer.send('ui:set-badge', dataUrl)
    }
  },
  app: {
    version: () => ipcRenderer.invoke('app:version') as Promise<string>
  },
  update: {
    check: () => ipcRenderer.invoke('update:check') as Promise<void>,
    install: () => ipcRenderer.invoke('update:install') as Promise<void>
  },
  on: {
    status: (cb: (p: { accountId: string; status: string; detail: string }) => void) =>
      listen('conn:status', cb),
    auth: (cb: (p: { accountId: string; step: AuthStep | null }) => void) => listen('conn:auth', cb),
    chatsUpdate: (cb: (p: { accountId: string; chats: Chat[] }) => void) => listen('chats:update', cb),
    chatsUpsert: (cb: (p: { accountId: string; chat: Chat }) => void) => listen('chats:upsert', cb),
    msgNew: (cb: (p: { msg: Message }) => void) => listen('msg:new', cb),
    switchPlatform: (cb: (p: { index: number }) => void) => listen('ui:switch-platform', cb),
    openSettings: (cb: () => void) => listen('ui:open-settings', cb),
    navigate: (cb: (p: { accountId: string; chatId: string }) => void) => listen('ui:navigate', cb),
    updateStatus: (cb: (p: UpdateStatus) => void) => listen('update:status', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
