<template>
  <ul class="list-skeleton" aria-label="正在加载笔记">
    <li v-for="i in 4" :key="i" class="list-skeleton-row">
      <span class="skeleton-line skeleton-title"></span>
      <span class="skeleton-line skeleton-summary"></span>
      <span class="skeleton-line skeleton-summary short"></span>
    </li>
  </ul>
</template>
