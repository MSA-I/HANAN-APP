import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import { shallow } from 'zustand/shallow'
import { temporal } from 'zundo'
import type { Id, Project, SceneState } from '../core/model/types'
import { createDefaultScene } from '../core/model/factory'

export type ViewMode = '2d' | 'split' | '3d'

/**
 * Which part of the venue is being worked on. The resort has a second, detached
 * work area — the raised reception deck — with its own camera angles and its own
 * placement whitelist. Like `mode` this is a view preference, NOT scene data, so
 * it lives outside the undoable region.
 */
export type ActiveZone = 'hall' | 'kabalatPanim'

export interface EditorState {
  /** the ONLY undoable region (zundo partialize) */
  scene: SceneState
  /** ids of selected top-level objects, or a drilled-in attached chair */
  selection: Id[]
  mode: ViewMode
  activeZone: ActiveZone
  /**
   * The table whose decor is being edited, or null. A VIEW preference like `mode`
   * and `activeZone` — it lives OUTSIDE the undoable region on purpose: undoing a
   * decor move must put the decor back without also closing the editor around it.
   */
  designEditTableId: Id | null
  projectId: Id | null
  projectName: string
  eventName?: string
  eventDate?: string
  createdAt: string
  dirty: boolean
}

function initialState(): EditorState {
  return {
    scene: createDefaultScene(),
    selection: [],
    mode: '2d',
    activeZone: 'hall',
    designEditTableId: null,
    projectId: null,
    projectName: '',
    createdAt: new Date().toISOString(),
    dirty: false,
  }
}

export const useEditorStore = create<EditorState>()(
  temporal(
    subscribeWithSelector(immer(initialState)),
    {
      partialize: (s) => ({ scene: s.scene }) as EditorState,
      limit: 100,
      equality: (a, b) => shallow(a.scene, b.scene) || a.scene === b.scene,
    },
  ),
)

export const temporalStore = useEditorStore.temporal

/**
 * Open (`id`) or close (`null`) the design-edit session — the single writer of
 * `designEditTableId`.
 *
 * It lives here and not in `actions.ts` because it touches no scene data: like
 * `setMode` it is a view preference, and routing it through `mutateScene` would
 * dirty the project and spend an undo entry on opening an editor.
 *
 * ⚠ It does NOT validate the id. Nothing clears it when the project is swapped
 * or the table deleted — both live in `actions.ts` — so every READER goes
 * through `designEditTable(scene, id)` in `selectors.ts`, which returns null for
 * an id that no longer names a live table. Writing is cheap; being right on read
 * is what makes a stale id unobservable.
 */
export function setDesignEditTable(id: Id | null): void {
  useEditorStore.setState({ designEditTableId: id })
}

export function projectFromState(s: EditorState): Project {
  return {
    id: s.projectId ?? '',
    schemaVersion: 1,
    name: s.projectName,
    eventName: s.eventName,
    eventDate: s.eventDate,
    createdAt: s.createdAt,
    updatedAt: new Date().toISOString(),
    scene: s.scene,
  }
}
