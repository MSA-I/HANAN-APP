/**
 * Import/export at the file boundary: a `.json` snapshot of the whole project
 * (round-trippable through `importProjectJson`) and a `.png` of the 2D plan
 * captured from the live Konva stage via the capture bus.
 */
import { capture } from '../editor2d/captureBus'
import { migrateAndValidate } from '../core/migrations'
import type { Project } from '../core/model/types'
import type { ExportPackage } from '../core/prompts/compose'
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

export type PromptExportResult = 'saved' | 'downloaded'

/**
 * Send one composed angle to the dev server, which writes the whole package —
 * capture, prompt, references, manifest — into HANAN-APP-DOCS\צילומים
 * (tools/capture-plugin.ts).
 *
 * ponytail: with no dev server there is nowhere to write, so this falls back to
 * downloading the two files a browser CAN produce — the capture and the prompt,
 * whose text names every reference by its path. Bundling the references into a
 * zip is the obvious alternative and was rejected: `jszip` is a new dependency
 * for a path that only exists in a production build the user does not currently
 * use, and PLAN-08 A3 says not to add it.
 */
export async function exportPromptPackage(
  pkg: ExportPackage,
  dataUrl: string,
  projectName: string,
): Promise<PromptExportResult> {
  try {
    const res = await fetch('/__capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl, pkg, project: projectName }),
    })
    if (!res.ok) throw new Error(String(res.status))
    return 'saved'
  } catch {
    const stem = `${sanitizeFilename(projectName)} — ${sanitizeFilename(pkg.angleLabel)}`
    triggerDownload(dataUrlToBlob(dataUrl), `${stem}.png`)
    triggerDownload(
      new Blob([promptFileText(pkg)], { type: 'text/plain;charset=utf-8' }),
      `${stem}.txt`,
    )
    return 'downloaded'
  }
}

/** The prompt plus the reference list, so a downloaded .txt is self-contained. */
function promptFileText(pkg: ExportPackage): string {
  const refs = pkg.refs.map((r, i) => `${i + 1}. [${r.role}] ${r.path} — ${r.caption}`)
  return [
    pkg.prompt,
    '',
    '--- REFERENCE IMAGES ---',
    ...refs,
    ...(pkg.warnings.length ? ['', '--- WARNINGS ---', ...pkg.warnings] : []),
  ].join('\n')
}
