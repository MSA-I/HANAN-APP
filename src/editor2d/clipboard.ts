import type { Vec2 } from '../core/model/types'
import { pasteSubtrees, removeObjects, type Subtree } from '../state/actions'
import { childrenOf } from '../state/selectors'
import { useEditorStore } from '../state/store'

let clip: Subtree[] = []

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

export function copySelection(): number {
  const { selection, scene } = useEditorStore.getState()
  clip = selection
    .map((id) => scene.objects[id])
    .filter((o) => o && !o.parentId)
    .map((o) => ({ root: clone(o), children: childrenOf(scene, o.id).map(clone) }))
  return clip.length
}

export function cutSelection(): void {
  if (copySelection() > 0) {
    removeObjects(useEditorStore.getState().selection)
  }
}

export function pasteClipboard(target?: Vec2): void {
  if (clip.length) pasteSubtrees(clone(clip), target)
}

export function clipboardHasContent(): boolean {
  return clip.length > 0
}
