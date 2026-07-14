/**
 * Import/export at the file boundary: a `.json` snapshot of the whole project
 * (round-trippable through `importProjectJson`) and a `.png` of the 2D plan
 * captured from the live Konva stage via the capture bus.
 */
import { capture } from '../editor2d/captureBus'
import { migrateAndValidate } from '../core/migrations'
import type { Project } from '../core/model/types'
import { projectFromState, type EditorState } from '../state/store'
import { makeProjectFile } from './autosave'
import { dataUrlToBlob } from './imageBlob'

function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'event'
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // give the browser a beat to start the download before reclaiming the URL
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Download the current project as a pretty-printed ProjectFile JSON. */
export function downloadProjectJson(state: EditorState): void {
  const file = makeProjectFile(projectFromState(state))
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  triggerDownload(blob, `${sanitizeFilename(state.projectName)}.json`)
}

/** Parse + validate an imported JSON file, returning the contained Project. */
export async function importProjectJson(file: File): Promise<Project> {
  const text = await file.text()
  const raw: unknown = JSON.parse(text)
  return migrateAndValidate(raw).project
}

/**
 * Capture the 2D floor plan and download it as a PNG. Returns false if no
 * capture source is registered (e.g. the stage is not mounted).
 */
export function exportFloorPlanPng(projectName: string): boolean {
  const dataUrl = capture({ pixelRatio: 2, clean: true })
  if (!dataUrl) return false
  triggerDownload(dataUrlToBlob(dataUrl), `${sanitizeFilename(projectName)}.png`)
  return true
}
