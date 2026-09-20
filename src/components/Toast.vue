<script setup lang="ts">
import { notice } from '../notify'
</script>

<template>
  <!-- 容器常驻才能让读屏软件把新插入的文字当作状态更新念出来 -->
  <div class="toast-host" role="status" aria-live="polite">
    <div v-if="notice" class="toast">{{ notice }}</div>
  </div>
</template>
