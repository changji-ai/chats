<template>
  <div class="app">
    <PlatformRail />
    <ChatList />
    <ChatView />
    <SettingsDrawer v-if="s.settingsOpen" />
    <AuthModal v-if="s.authPrompt" />
    <AccountModal v-if="s.addOpen" />
    <div v-if="s.error" class="toast">{{ s.error }}</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import PlatformRail from './components/PlatformRail.vue'
import ChatList from './components/ChatList.vue'
import ChatView from './components/ChatView.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import AuthModal from './components/AuthModal.vue'
import AccountModal from './components/AccountModal.vue'
import { s, init } from './store'

onMounted(() => {
  void init().then(() => console.log('[ui-ready]'))
})
</script>
