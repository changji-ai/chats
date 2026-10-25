<template>
  <section class="chatlist">
    <div class="chatlist-head">
      <input v-model="s.search" type="text" placeholder="搜索会话" />
    </div>
    <div class="chatlist-body">
      <div v-if="!activeDef" class="empty">还没有账号<br /><button class="link" @click="s.addOpen = true">＋ 添加账号 →</button></div>
      <template v-else-if="currentChats.length">
        <button
          v-for="c in currentChats"
          :key="c.id"
          class="chat"
          :class="{ active: c.id === s.activeChat }"
          @click="selectChat(c.accountId, c.id)"
        >
          <span class="avatar" :style="{ background: activeDef.color }">{{ c.title.slice(0, 1) }}</span>
          <span class="meta">
            <span class="row1">
              <span class="title">{{ c.title }}</span>
              <span class="time">{{ fmtTime(c.lastTs) }}</span>
            </span>
            <span class="row2">
              <span class="last">{{ c.lastText || typeLabel(c.type) }}</span>
              <span v-if="chatUnread(c.accountId, c.id) > 0" class="badge">{{ fmtUnread(chatUnread(c.accountId, c.id)) }}</span>
            </span>
          </span>
        </button>
      </template>
      <div v-else class="empty">
        <template v-if="activeRuntime && activeRuntime.status === 'online'">暂无会话</template>
        <template v-else-if="activeRuntime && activeRuntime.status !== 'idle'">{{ activeRuntime.detail || '未连接' }}</template>
        <template v-else>
          尚未连接<br />
          <button class="link" @click="s.settingsOpen = true">去设置里填写账号信息 →</button>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Chat } from '../../../shared/types'
import { s, selectChat, chatUnread, fmtUnread, fmtTime, typeLabel, runtimeOf } from '../store'

const activeRuntime = computed(() => runtimeOf(s.activeAccount))
const activeDef = computed(() => activeRuntime.value?.def)

const currentChats = computed<Chat[]>(() => {
  const map = s.chatsByAccount[s.activeAccount]
  if (!map) return []
  const q = s.search.trim().toLowerCase()
  const list = [...map.values()].filter((c) => !q || c.title.toLowerCase().includes(q))
  list.sort((a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0) || a.title.localeCompare(b.title))
  return list
})
</script>
