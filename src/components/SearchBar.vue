<template><input class="search" v-model="ui.query" placeholder="搜索标题与正文"></template><script setup lang="ts">import {useUiStore} from '../stores/ui';const ui=useUiStore()</script>
