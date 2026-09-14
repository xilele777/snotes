import { watch, type Ref } from 'vue'
import { useNotesStore } from '../stores/notes'
import { useUiStore, type WorkspacePosition } from '../stores/ui'

/** 等列表或编辑器真正渲染后恢复一次，避免加载占位把滚动位置夹回 0。 */
export function useWorkspaceScroll(
  element: Ref<HTMLElement | null>,
  pane: keyof WorkspacePosition['scroll'],
  ready: () => boolean = () => true,
) {
  const ui = useUiStore()
  const notes = useNotesStore()
  let restored: WorkspacePosition | null = null

  watch(
    [element, () => ui.restorePosition, () => ui.view, () => ui.activeGroupId, () => ui.query, () => notes.currentId, ready],
    () => {
      const position = ui.restorePosition
      if (!element.value || !ready() || !position || position === restored) return
      if (position.view !== ui.view || position.activeGroupId !== ui.activeGroupId || position.query !== ui.query) return
      if (pane === 'editor' && position.currentId !== notes.currentId) return
      element.value.scrollTop = position.scroll[pane]
      restored = position
    },
    { flush: 'post' },
  )
}
