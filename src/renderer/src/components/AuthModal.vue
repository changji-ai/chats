<template>
  <div class="overlay" @click.self="cancel">
    <div class="modal">
      <h3>{{ defName }} · 登录</h3>
      <p class="prompt">{{ step?.prompt }}</p>
      <template v-if="step?.type === 'qrcode'">
        <img v-if="step.qrImage" class="qr" :src="step.qrImage" alt="登录二维码" />
        <div class="actions">
          <button @click="cancel">取消</button>
        </div>
      </template>
      <template v-else>
        <input
          ref="inputEl"
          v-model="value"
          :type="step?.type === 'password' ? 'password' : 'text'"
          :placeholder="step?.placeholder"
          autocomplete="off"
          @keydown.enter="submit"
        />
        <div class="actions">
          <button @click="cancel">取消</button>
          <button class="primary" :disabled="!value.trim()" @click="submit">确定</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { s, accountLabel } from '../store'

const value = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const defName = computed(() => accountLabel(s.accounts.find((p) => p.account.id === s.authPrompt?.accountId)))
const step = computed(() => s.authPrompt?.step)

onMounted(() => {
  if (step.value?.type !== 'qrcode') {
    void nextTick(() => inputEl.value?.focus())
  }
})

async function submit(): Promise<void> {
  const pid = s.authPrompt?.accountId
  const v = value.value.trim()
  if (!pid || !v) return
  value.value = ''
  await window.api.auth.submit(pid, v)
}

async function cancel(): Promise<void> {
  const pid = s.authPrompt?.accountId
  if (pid) await window.api.auth.cancel(pid)
}
</script>

<style scoped>
.qr {
  display: block;
  margin: 0 auto 14px;
  padding: 8px;
  border-radius: 8px;
  background: #fff;
}
</style>
