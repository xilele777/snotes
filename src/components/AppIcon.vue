<script setup lang="ts">
withDefaults(defineProps<{ name: keyof typeof paths; size?: number }>(), { size: 18 })

const paths = {
  note: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z', 'M14 3v6h6M8 13h8M8 17h5'],
  notes: ['M8 3H5a2 2 0 0 0-2 2v11', 'M10 7h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z', 'M12 12h5M12 16h5'],
  search: ['M21 21l-4.5-4.5', 'M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0'],
  plus: ['M12 5v14M5 12h14'],
  close: ['M6 6l12 12M6 18 18 6'],
  star: ['m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z'],
  trash: ['M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6'],
  chart: ['M4 3v17h17M8 15v-4M13 15V6M18 15v-7'],
  folder: ['M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
  chevron: ['m9 5 7 7-7 7'],
  back: ['m14 6-6 6 6 6'],
  cloud: ['M17.5 19a4.5 4.5 0 1 0 0-9 6 6 0 0 0-11.7 1.5A4 4 0 0 0 6 19h11.5Z'],
  check: ['m5 12 4 4L19 6'],
  undo: ['M3 7h11a6 6 0 0 1 0 12h-2M7 3 3 7l4 4'],
  redo: ['M21 7H10a6 6 0 0 0 0 12h2M17 3l4 4-4 4'],
  image: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M3 16l5-5 4 4 3-3 6 6', 'M15.5 9.5h.01'],
  pin: ['m16 3 5 5-4 2-3 5-2 1-4-4 1-2 5-3Z', 'm8 16-5 5'],
  focus: ['M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5'],
  collapse: ['M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5'],
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 11v5M12 7h.01'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  keyboard: ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8'],
  sort: ['M4 6h16M4 12h11M4 18h6'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 7v5l3 2'],
  lock: ['M6 10h12v11H6Z', 'M8 10V6a4 4 0 0 1 8 0v4M12 14v3'],
  edit: ['M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z', 'm13.5 6.5 3 3'],
  arrowUp: ['M12 19V5', 'm5 12 7-7 7 7'],
  arrowDown: ['M12 5v14', 'm19 12-7 7-7-7'],
  download: ['M12 3v12', 'm7 11 5 5 5-5', 'M4 20h16'],
  upload: ['M12 16V4', 'm7 9 5-5 5 5', 'M4 20h16'],
  share: ['M12 15V4', 'm7 8 5-5 5 5', 'M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5'],
  copy: ['M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
} as const
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="app-icon">
    <path v-for="(path, i) in paths[name]" :key="i" :d="path" />
  </svg>
</template>
