<template>
  <div class="overlay" @click.self="close">
    <div class="modal add-modal">
      <template v-if="!def">
        <h3>添加账号 · 选择平台</h3>
        <div class="picker">
          <button v-for="p in PLATFORMS" :key="p.id" class="pick" @click="def = p">
            <span class="glyph" :style="{ background: p.color }">{{ p.glyph }}</span>
            <span class="name">{{ p.name }}</span>
          </button>
        </div>
      </template>
      <template v-else>
        <h3>
          添加 {{ def.name }}
          <button class="link" @click="def = undefined">← 换平台</button>
        </h3>
        <div class="hints">
          <p v-for="h in def.hints" :key="h">{{ h }}</p>
        </div>
        <div class="form">
          <label class="row">
            <span class="lab">显示名（可选，缺省用平台名）</span>
            <input v-model="label" type="text" :placeholder="def.name" />
          </label>
          <label v-for="f in def.fields" :key="f.key" class="row">
            <span class="lab">{{ f.label }}{{ f.required ? '' : '' }}</span>
            <input
              v-model="draft[f.key]"
              :type="f.type === 'password' ? 'password' : 'text'"
              :placeholder="f.placeholder"
              autocomplete="off"
            />
          </label>
          <p v-if="err" class="err">{{ err }}</p>
          <div class="actions">
            <button @click="close">取消</button>
            <button class="primary" :disabled="busy" @click="submit">{{ busy ? '连接中…' : '保存并连接' }}</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { PLATFORMS } from '../../../shared/platforms'
import type { FieldDef, PlatformDef } from '../../../shared/types'
import { s, refreshAccounts, selectAccount } from '../store'

const def = ref<PlatformDef | undefined>(undefined)
const label = ref('')
const draft = reactive<Record<string, string>>({})
const busy = ref(false)
const err = ref('')

function reset(): void {
  def.value = undefined
  label.value = ''
  for (const k of Object.keys(draft)) delete draft[k]
  err.value = ''
  busy.value = false
}

function close(): void {
  reset()
  s.addOpen = false
}

function missing(fields: FieldDef[]): string {
  for (const f of fields) {
    if (f.required && !(draft[f.key] ?? '').trim()) return `请填写${f.label}`
  }
  return ''
}

async function submit(): Promise<void> {
  const d = def.value
  if (!d || busy.value) return
  const m = missing(d.fields)
  if (m) {
    err.value = m
    return
  }
  busy.value = true
  err.value = ''
  try {
    const rt = await window.api.accounts.add(d.id, label.value, { ...draft })
    await refreshAccounts()
    selectAccount(rt.account.id)
    close()
  } catch (e) {
    err.value = `添加失败：${(e as Error)?.message ?? String(e)}`
    busy.value = false
  }
}
</script>

<style scoped>
.add-modal {
  width: min(560px, 92vw);
  max-height: 86vh;
  overflow: auto;
}
.picker {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin: 14px 0 4px;
}
.pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 6px;
  border-radius: 10px;
  background: var(--bg2);
}
.pick:hover {
  background: var(--bg3);
}
.pick .glyph {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 700;
}
.hints {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg2);
}
.hints p {
  font-size: 12px;
  color: var(--dim);
  margin: 2px 0;
}
.err {
  color: var(--danger);
  font-size: 12px;
}
</style>
