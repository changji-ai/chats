<template>
  <aside class="drawer">
    <header class="drawer-head">
      <span>设置</span>
      <button class="close" title="关闭" @click="s.settingsOpen = false">✕</button>
    </header>

    <div class="drawer-body">
      <section class="group">
        <h3>账号（{{ s.accounts.length }}）</h3>
        <div class="custom-tools">
          <button class="primary" @click="s.addOpen = true">＋ 添加账号</button>
        </div>
        <p v-if="!s.accounts.length" class="group-hint">还没有账号。点「添加账号」，选择平台（QQ / 微信 / Telegram / WhatsApp / Discord / 飞书 / 钉钉 / Slack / Matrix / IRC / OneBot 自定义），同一平台可加多个。</p>

        <details v-for="p in s.accounts" :key="p.account.id" class="account">
          <summary>
            <span class="status" :class="p.status"></span>
            <span class="acc-name">{{ accountLabel(p) }}</span>
            <span class="acc-platform">{{ p.def.name }}</span>
            <span class="acc-status">{{ statusText(p) }}</span>
          </summary>
          <div class="hints">
            <p v-for="h in p.def.hints" :key="h">{{ h }}</p>
          </div>
          <div class="form">
            <label v-for="f in p.def.fields" :key="f.key" class="row">
              <span class="lab">{{ f.label }}</span>
              <input
                v-model="drafts[p.account.id][f.key]"
                :type="f.type === 'password' ? 'password' : 'text'"
                :placeholder="f.placeholder"
                autocomplete="off"
              />
            </label>
            <p v-if="p.status === 'error'" class="err">{{ p.detail }}</p>
            <div class="actions">
              <button class="primary" @click="save(p)">保存并{{ isOn(p) ? '重连' : '连接' }}</button>
              <button v-if="isOn(p) || p.status === 'connecting' || p.status === 'error'" @click="disconnect(p)">断开</button>
              <label class="mute">
                <input type="checkbox" :checked="!isMuted(p.account.id)" @change="toggleMute(p.account.id)" />
                系统通知
              </label>
            </div>
            <div class="actions">
              <button class="danger-btn" @click="removeAccountClick(p.account.id)">删除此账号</button>
            </div>
          </div>
        </details>
      </section>

      <section class="group">
        <h3>通用</h3>
        <div class="form">
          <label class="row">
            <span class="lab">主题</span>
            <select :value="s.settings?.theme" @change="setTheme">
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </label>
          <label class="row">
            <span class="lab">系统通知</span>
            <input
              type="checkbox"
              :checked="s.settings?.notifications ?? true"
              @change="saveSettings({ notifications: ($event.target as HTMLInputElement).checked })"
            />
          </label>
          <label class="row">
            <span class="lab">开机自启</span>
            <input
              type="checkbox"
              :checked="s.settings?.autoLaunch ?? false"
              @change="saveSettings({ autoLaunch: ($event.target as HTMLInputElement).checked })"
            />
          </label>
          <div class="row">
            <span class="lab">版本与更新</span>
            <div class="update-row">
              <span class="update-state" :title="s.update.note">{{ updateText }}</span>
              <span v-if="s.update.status === 'downloading'" class="progress"><i :style="{ width: (s.update.percent ?? 0) + '%' }"></i></span>
              <button v-if="s.update.status !== 'downloading' && s.update.status !== 'checking'" @click="checkUpdate">检查更新</button>
              <button v-if="s.update.status === 'ready'" class="primary" @click="installUpdate">重启并更新</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import type { AppSettings, PlatformRuntime } from '../../../shared/types'
import { s, refreshAccounts, accountLabel, removeAccount } from '../store'

const drafts = reactive<Record<string, Record<string, string>>>({})

onMounted(async () => {
  for (const p of s.accounts) {
    if (!(p.account.id in drafts)) drafts[p.account.id] = await window.api.creds.get(p.account.id)
  }
})

const isOn = (p: PlatformRuntime): boolean => p.status === 'online' || p.status === 'waiting-auth'

function statusText(p: PlatformRuntime): string {
  const map: Record<string, string> = {
    idle: '未连接',
    connecting: '连接中',
    'waiting-auth': '等待登录',
    online: '在线',
    offline: '已断开',
    error: '出错'
  }
  return map[p.status] ?? ''
}

const updateText = computed<string>(() => {
  const u = s.update
  switch (u.status) {
    case 'checking':
      return '正在检查更新…'
    case 'available':
      return `发现新版本 v${u.version ?? ''}，开始下载…`
    case 'downloading':
      return `下载中 ${u.percent ?? 0}%`
    case 'ready':
      return `新版本 v${u.version ?? ''} 已就绪`
    case 'uptodate':
      return `已是最新（v${s.appVersion || '?'}）`
    case 'error':
      return `更新失败：${(u.note ?? '').slice(0, 60)}`
    default:
      return `v${s.appVersion || '?'}（启动后自动检查更新）`
  }
})

function checkUpdate(): void {
  void window.api.update.check()
}

function installUpdate(): void {
  void window.api.update.install()
}

async function save(p: PlatformRuntime): Promise<void> {
  const id = p.account.id
  await window.api.creds.save(id, { ...(drafts[id] ?? {}) })
  await window.api.conn.connect(id)
}

async function disconnect(p: PlatformRuntime): Promise<void> {
  await window.api.conn.disconnect(p.account.id)
}

function isMuted(id: string): boolean {
  return !!s.settings?.muted?.[id]
}

async function toggleMute(id: string): Promise<void> {
  if (!s.settings) return
  await saveSettings({ muted: { ...s.settings.muted, [id]: isMuted(id) ? false : true } })
}

async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  s.settings = await window.api.settings.save(patch)
}

const setTheme = (e: Event): void => {
  const v = (e.target as HTMLSelectElement).value as 'dark' | 'light'
  document.body.dataset.theme = v
  void saveSettings({ theme: v })
}

async function removeAccountClick(id: string): Promise<void> {
  if (!window.confirm('删除该账号？已保存的凭据会一并清除。')) return
  delete drafts[id]
  await removeAccount(id)
  await refreshAccounts()
}
</script>
