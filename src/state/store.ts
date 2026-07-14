import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import { shallow } from 'zustand/shallow'
import { temporal } from 'zundo'
import type { Id, Project, SceneState } from '../core/model/types'
import { createDefaultScene } from '../core/model/factory'

export type ViewMode = '2d' | 'split' | '3d'

export interface EditorState {
  /** the ONLY undoable region (zundo partialize) */
  scene: SceneState
  /** ids of selected top-level objects, or a drilled-in attached chair */
  selection: Id[]
  mode: ViewMode
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
