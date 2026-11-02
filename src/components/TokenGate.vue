<script setup lang="ts">
import { ref } from 'vue'
import { authNotice, setToken } from '../api/token'
import AppIcon from './AppIcon.vue'
import BrandWordmark from './BrandWordmark.vue'

const input = ref('')
const brandIconUrl = `${import.meta.env.BASE_URL}snotes.svg`

function submit() {
  const value = input.value.trim()
  if (value) setToken(value)
}
</script>

<template>
  <div class="token-gate">
    <form class="token-card" @submit.prevent="submit">
      <img class="brand-mark" :src="brandIconUrl" alt="" width="40" height="40" />
      <h1 class="token-title"><BrandWordmark /></h1>
      <p class="token-intro">随手记下，此刻的想法。</p>
      <p v-if="authNotice" class="token-error" role="alert">{{ authNotice }}</p>
      <label for="access-token" class="token-hint">访问令牌</label>
      <input id="access-token" v-model="input" type="password" autocomplete="current-password" placeholder="请输入访问令牌" required autofocus />
      <button class="token-submit" type="submit" :disabled="!input.trim()">进入我的便签</button>
      <p class="token-footnote"><AppIcon name="lock" :size="12" />使用部署时设置的访问令牌</p>
      <details class="token-help">
        <summary>访问令牌在哪里？</summary>
        <p>自己部署的实例，请使用服务端配置的 ACCESS_TOKEN。由他人部署时，请向部署者获取令牌，无需注册账号。</p>
        <p>此浏览器会记住令牌；清除网站数据或更换浏览器后，需要重新输入。</p>
      </details>
    </form>
  </div>
</template>
