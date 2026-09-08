<script setup lang="ts">
import { ref } from 'vue'
import { authNotice, setToken } from '../api/token'

const input = ref('')

function submit() {
  const value = input.value.trim()
  if (value) setToken(value)
}
</script>

<template>
  <div class="token-gate">
    <div class="token-card">
      <h1 class="token-title">snotes</h1>
      <p v-if="authNotice" class="token-error">{{ authNotice }}</p>
      <p class="token-hint">请输入访问令牌</p>
      <input v-model="input" type="password" autocomplete="off" @keyup.enter="submit" />
      <button :disabled="!input.trim()" @click="submit">进入</button>
    </div>
  </div>
</template>
