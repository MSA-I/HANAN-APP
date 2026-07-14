/**
 * Autosave: mirrors the live editor scene into the repository. Subscribes to
 * the undoable `scene` slice, debounces writes by 1s, and flushes immediately
 * when the tab is being closed or backgrounded so nothing is lost. Save state
 * is published through a tiny zustand store the status bar can render.
 */
import { create } from 'zustand'
import { SCHEMA_VERSION } from '../core/migrations'
import { capture } from '../editor2d/captureBus'
import type { Project } from '../core/model/types'
import { projectFromState, useEditorStore } from '../state/store'
import { dataUrlToBlob } from './imageBlob'
import type { ProjectFile, ProjectRepository } from './types'

export type SaveStatusValue = 'idle' | 'saving' | 'saved' | 'error'

interface SaveStatusState {
  status: SaveStatusValue
  savedAt: string | null
}

export const useSaveStatus = create<SaveStatusState>(() => ({
  status: 'idle',
  savedAt: null,
}))

/** Wrap a Project in the persistence envelope. */
export function makeProjectFile(project: Project): ProjectFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: 'hanan-app',
    savedAt: new Date().toISOString(),
    project,
  }
}

/** Snapshot the live store into a ProjectFile (only meaningful once a project is open). */
export function projectFileFromState(): ProjectFile {
  return makeProjectFile(projectFromState(useEditorStore.getState()))
}

/**
 * Grab a small clean PNG of the current plan and store it as this project's
 * preview. Best-effort: silently no-ops when no capture source is registered
 * (e.g. the editor stage isn't mounted) or on any capture failure.
 */
async function capturePreview(repo: ProjectRepository, id: string): Promise<void> {
  try {
    const dataUrl = capture({ pixelRatio: 1, clean: true })
    if (dataUrl) await repo.savePreview(id, dataUrlToBlob(dataUrl))
  } catch (err) {
    console.warn('preview capture failed', err)
  }
}

/** Persist the current project immediately, updating the published save status. */
export async function saveNow(repo: ProjectRepository): Promise<void> {
  const id = useEditorStore.getState().projectId
  if (!id) return
  useSaveStatus.setState({ status: 'saving' })
  try {
    await repo.save(projectFileFromState())
    await capturePreview(repo, id)
    useSaveStatus.setState({ status: 'saved', savedAt: new Date().toISOString() })
  } catch (err) {
    console.error('autosave failed', err)
    useSaveStatus.setState({ status: 'error' })
  }
}

/**
 * Start autosaving the open project. Returns a disposer that unsubscribes and
 * removes the lifecycle listeners.
 */
export function startAutosave(repo: ProjectRepository): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = () => {
    clear()
    timer = setTimeout(() => {
      timer = null
      void saveNow(repo)
    }, 1000)
  }

  const flush = () => {
    clear()
    void saveNow(repo)
  }

  const unsubscribe = useEditorStore.subscribe(
    (s) => s.scene,
    () => {
      if (useEditorStore.getState().projectId) schedule()
    },
  )

  const onBeforeUnload = () => flush()
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush()
  }

  window.addEventListener('beforeunload', onBeforeUnload)
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    clear()
    unsubscribe()
    window.removeEventListener('beforeunload', onBeforeUnload)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
