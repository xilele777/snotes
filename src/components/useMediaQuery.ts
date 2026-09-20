import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'

/**
 * 响应式的 window.matchMedia：断点变化时自动更新，组件作用域销毁时解绑。
 * 单测里 jsdom 的 matchMedia 由 tests/unit/setup-idb.ts 补齐，默认恒为 false；
 * 要测窄屏分支时在用例里覆写 window.matchMedia 即可。
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const media = window.matchMedia(query)
  const matches = ref(media.matches)
  const update = () => { matches.value = media.matches }
  media.addEventListener?.('change', update)
  if (getCurrentScope()) onScopeDispose(() => media.removeEventListener?.('change', update))
  return matches
}
