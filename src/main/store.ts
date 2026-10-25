import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Account, AppSettings, PlatformDef } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/platforms'

function asAccount(v: unknown): Account | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Partial<Account>
  if (typeof a.id !== 'string' || typeof a.platformId !== 'string' || !a.id || !a.platformId) return null
  return { id: a.id, platformId: a.platformId, label: typeof a.label === 'string' && a.label ? a.label : undefined }
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<AppSettings> & { customPlatforms?: unknown[] }
    const accounts: Account[] = Array.isArray(raw.accounts)
      ? (raw.accounts.map(asAccount).filter((a): a is Account => a !== null) as Account[])
      : []
    // 兼容旧版 customPlatforms：每个自定义 OneBot 平台迁移为一个账号
    if (Array.isArray(raw.customPlatforms)) {
      for (const v of raw.customPlatforms) {
        const d = v as Partial<PlatformDef>
        if (typeof d.id !== 'string' || !accounts.some((a) => a.id === d.id)) continue
        // 已被 accounts 覆盖的不重复迁移
      }
      for (const v of raw.customPlatforms) {
        const d = v as Partial<PlatformDef>
        if (typeof d.id !== 'string' || accounts.some((a) => a.id === d.id)) continue
        accounts.push({ id: d.id, platformId: 'onebot-custom', label: typeof d.name === 'string' ? d.name : undefined })
      }
    }
    return {
      theme: raw.theme === 'light' ? 'light' : 'dark',
      notifications: raw.notifications ?? DEFAULT_SETTINGS.notifications,
      autoLaunch: raw.autoLaunch ?? DEFAULT_SETTINGS.autoLaunch,
      muted: { ...(raw.muted ?? {}) },
      accounts,
      autoConnect: { ...(raw.autoConnect ?? {}) }
    }
  } catch {
    return { ...DEFAULT_SETTINGS, muted: {}, accounts: [], autoConnect: {} }
  }
}

export function saveSettings(s: AppSettings): void {
  writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf8')
}

// ---------- 凭据保险库（DPAPI 加密，按账号 id 存） ----------
function vaultFile(): string {
  return join(app.getPath('userData'), 'vault.json')
}

function enc(plain: string): string {
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(plain).toString('base64')
    : `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
}

function dec(blob: string): string {
  if (blob.startsWith('plain:')) return Buffer.from(blob.slice(6), 'base64').toString('utf8')
  try {
    return safeStorage.decryptString(Buffer.from(blob, 'base64'))
  } catch {
    return ''
  }
}

function loadVault(): Record<string, Record<string, string>> {
  try {
    return JSON.parse(readFileSync(vaultFile(), 'utf8')) as Record<string, Record<string, string>>
  } catch {
    return {}
  }
}

export function getCreds(accountId: string): Record<string, string> {
  const encMap = loadVault()[accountId]
  if (!encMap) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(encMap)) {
    const plain = dec(v)
    if (plain) out[k] = plain
  }
  return out
}

export function putCreds(accountId: string, values: Record<string, string>): void {
  const vault = loadVault()
  const cur = vault[accountId] ?? {}
  for (const [k, v] of Object.entries(values)) {
    // 空字符串 = 删除该字段
    if (v === '') delete cur[k]
    else cur[k] = enc(v)
  }
  if (Object.keys(cur).length === 0) delete vault[accountId]
  else vault[accountId] = cur
  writeFileSync(vaultFile(), JSON.stringify(vault, null, 2), 'utf8')
}
