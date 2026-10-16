<script setup lang="ts">
import { notice, noticeAction, runNoticeAction } from '../notify'
</script>

<template>
  <!-- 容器常驻才能让读屏软件把新插入的文字当作状态更新念出来 -->
  <div class="toast-host" role="status" aria-live="polite">
    <Transition name="toast"><div v-if="notice" class="toast"><span>{{ notice }}</span><button v-if="noticeAction" type="button" @click="runNoticeAction">{{ noticeAction.label }}</button></div></Transition>
  </div>
</template>
