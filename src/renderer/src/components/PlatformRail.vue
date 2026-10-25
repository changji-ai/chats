<template>
  <nav class="rail">
    <button
      v-for="(p, index) in s.accounts"
      :key="p.account.id"
      class="rail-item"
      :class="{ active: p.account.id === s.activeAccount }"
      :title="`${accountLabel(p)} · ${p.def.name}（Ctrl+${index + 1}）`"
      @click="selectAccount(p.account.id)"
    >
      <span class="glyph" :style="{ background: p.def.color }">{{ p.def.glyph }}</span>
      <i class="status" :class="p.status" :title="statusText(p)"></i>
      <span v-if="accountUnread(p.account.id) > 0" class="dot">{{ fmtUnread(accountUnread(p.account.id)) }}</span>
    </button>
    <span class="rail-spacer"></span>
    <button class="rail-item add" title="添加账号" @click="s.addOpen = true">＋</button>
    <button class="rail-item settings" title="设置（Ctrl+,）" @click="s.settingsOpen = true">⚙</button>
  </nav>
</template>

<script setup lang="ts">
import { s, selectAccount, accountUnread, fmtUnread, accountLabel } from '../store'
import type { PlatformRuntime } from '../../../shared/types'

function statusText(p: PlatformRuntime): string {
  const map: Record<string, string> = {
    idle: '未连接',
    connecting: '连接中',
    'waiting-auth': '等待登录',
    online: '在线',
    offline: '已断开',
    error: '出错'
  }
  return p.status === 'error' || p.status === 'connecting' ? `${map[p.status]}：${p.detail}` : map[p.status] ?? ''
}
</script>
