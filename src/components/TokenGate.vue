<script setup lang="ts">
import { ref } from 'vue'
import { authNotice, setToken } from '../api/token'
import AppIcon from './AppIcon.vue'

const input = ref('')

function submit() {
  const value = input.value.trim()
  if (value) setToken(value)
}
</script>

<template>
  <div class="token-gate">
    <form class="token-card" @submit.prevent="submit">
      <span class="brand-mark"><AppIcon name="note" :size="27" /></span>
      <h1 class="token-title">snotes<span class="brand-period">.</span></h1>
      <p class="token-intro">随手记下，此刻的想法。</p>
      <p v-if="authNotice" class="token-error" role="alert">{{ authNotice }}</p>
      <label for="access-token" class="token-hint">访问令牌</label>
      <input id="access-token" v-model="input" type="password" autocomplete="current-password" placeholder="请输入访问令牌" required autofocus />
      <button class="token-submit" type="submit" :disabled="!input.trim()">进入我的便签</button>
      <p class="token-footnote"><AppIcon name="lock" :size="12" />令牌只需输入一次，记录随时开始</p>
    </form>
  </div>
</template>
