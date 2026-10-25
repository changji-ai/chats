<template>
  <section class="chatview">
    <template v-if="chat">
      <header class="chatview-head">
        <div>
          <div class="title">{{ chat.title }}</div>
          <div class="sub">
            {{ accountLabel(activeRuntime) }} · {{ typeLabel(chat.type) }}
            <template v-if="activeRuntime && activeRuntime.status !== 'online'">
              · <span class="warn">{{ activeRuntime.detail || '未连接，暂不能发送' }}</span>
            </template>
          </div>
        </div>
      </header>
      <div ref="msgsEl" class="msgs">
        <div v-for="m in messages" :key="m.id" class="msg" :class="{ out: m.out }">
          <div v-if="!m.out && m.senderName" class="sender">{{ m.senderName }}</div>
          <div class="bubble">{{ m.text }}</div>
          <div class="time">{{ fmtTime(m.ts) }}</div>
        </div>
        <div v-if="!messages.length" class="msgs-empty">（最近 50 条消息会显示在这里）</div>
      </div>
      <footer class="composer">
        <textarea
          v-model="draft"
          rows="3"
          :placeholder="canSend ? '输入消息，Enter 发送，Shift+Enter 换行' : '平台未连接'"
          :disabled="!canSend"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <button :disabled="!canSend || !draft.trim()" @click="send">发送</button>
      </footer>
    </template>
    <div v-else class="chatview-empty">
      <div>选择一个会话开始聊天</div>
      <div class="dim">未连接的账号请到 ⚙ 设置里填写信息，或点「＋」添加账号</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { s, sendMessage, fmtTime, typeLabel, runtimeOf, accountLabel } from '../store'

const draft = ref('')
const msgsEl = ref<HTMLElement | null>(null)

const activeRuntime = computed(() => runtimeOf(s.activeAccount))
const chat = computed(() => s.chatsByAccount[s.activeAccount]?.get(s.activeChat))
const messages = computed(() => s.messagesByChat[`${s.activeAccount}/${s.activeChat}`] ?? [])
const canSend = computed(() => activeRuntime.value?.status === 'online')

async function send(): Promise<void> {
  if (!draft.value.trim()) return
  const text = draft.value
  draft.value = ''
  await sendMessage(text)
}

watch(
  () => [s.activeAccount, s.activeChat, messages.value.length],
  () => {
    void nextTick(() => {
      const el = msgsEl.value
      if (el) el.scrollTop = el.scrollHeight
    })
  }
)
</script>
