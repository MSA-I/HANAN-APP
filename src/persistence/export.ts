/**
 * Import/export at the file boundary: a `.json` snapshot of the whole project
 * (round-trippable through `importProjectJson`) and a `.png` of the 2D plan
 * captured from the live Konva stage via the capture bus.
 */
import { capture } from '../editor2d/captureBus'
import { migrateAndValidate } from '../core/migrations'
import type { Project } from '../core/model/types'
import type { ExportPackage } from '../core/prompts/compose'
import { migrateSavedLayout, venueSignature, type SavedLayout } from '../core/savedLayouts'
import { projectFromState, type EditorState } from '../state/store'
import { makeProjectFile } from './autosave'
import { dataUrlToBlob } from './imageBlob'
import { indexedDbRepository } from './indexedDbRepository'

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

/**
 * Download the current project as a pretty-printed ProjectFile JSON, with the
 * venue's saved layouts alongside it. They live in IndexedDB, i.e. in ONE
 * browser — without this, exporting a project and opening it elsewhere silently
 * loses every personal layout it refers to.
 *
 * `layouts` is an extra top-level key. `projectFileSchema` ignores unknown keys,
 * so an older build still reads the file, and a file without the key still
 * imports here.
 */
export async function downloadProjectJson(state: EditorState): Promise<void> {
  const project = projectFromState(state)
  const layouts = await indexedDbRepository
    .listLayouts(venueSignature(project.scene.venue))
    .catch(() => [] as SavedLayout[])
  const designs = await indexedDbRepository.listTableDesigns().catch(() => [] as SavedLayout[])
  const file = { ...makeProjectFile(project), layouts: [...layouts, ...designs] }
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  triggerDownload(blob, `${sanitizeFilename(state.projectName)}.json`)
}

/** The saved layouts an exported file carries, upgraded and filtered to the readable ones. */
export function readExportedLayouts(raw: unknown): SavedLayout[] {
  const list = (raw as { layouts?: unknown })?.layouts
  if (!Array.isArray(list)) return []
  return list.map(migrateSavedLayout).filter((layout): layout is SavedLayout => !!layout)
}

/**
 * Parse + validate an imported JSON file, returning the contained Project. Any
 * layouts the file carries are restored into the local store as a side effect —
 * they are project data from the user's point of view, and the alternative is a
 * second "import layouts" gesture nobody would think to run.
 */
export async function importProjectJson(file: File): Promise<Project> {
  const text = await file.text()
  const raw: unknown = JSON.parse(text)
  const project = migrateAndValidate(raw).project
  for (const layout of readExportedLayouts(raw)) {
    await indexedDbRepository.saveLayout(layout).catch((err: unknown) => {
      console.error('imported layout failed to save', err)
    })
  }
  return project
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

export type PromptExportStatus = 'saved' | 'downloaded' | 'failed'

/**
 * What became of one export — and, crucially, what it has to say about itself.
 *
 * The return value used to be a bare 'saved' | 'downloaded' and the caller threw
 * it away, so a package whose background reference was missing from disk looked
 * exactly like a clean save (AGENT-BRIEF §8). Warnings travel back with the
 * result now; only their PRESENTATION is the caller's problem.
 */
export interface PromptExportOutcome {
  status: PromptExportStatus
  /** the package's own warnings, plus whatever the server added while copying refs */
  warnings: string[]
  /** where the server said it landed, when there was a server */
  path?: string
}

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
 *
 * Never throws: the caller is a capture button, and both failure modes are worth
 * more as a message than as an exception.
 */
export async function exportPromptPackage(
  pkg: ExportPackage,
  dataUrl: string,
  projectName: string,
): Promise<PromptExportOutcome> {
  try {
    const res = await fetch('/__capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl, pkg, project: projectName }),
    })
    if (!res.ok) throw new Error(String(res.status))
    // The server COPIES the references, so it is the only place that learns a
    // path was rejected or is not on disk; it echoes pkg.warnings back with its
    // own appended. A body that will not parse is not worth failing an otherwise
    // successful write over — fall back to what we already knew.
    const body = (await res.json().catch(() => null)) as { path?: unknown; warnings?: unknown } | null
    return {
      status: 'saved',
      warnings: Array.isArray(body?.warnings) ? body.warnings.map(String) : pkg.warnings,
      path: typeof body?.path === 'string' ? body.path : undefined,
    }
  } catch {
    // no dev server (or it refused) — fall through to the browser download
  }

  try {
    const stem = `${sanitizeFilename(projectName)} — ${sanitizeFilename(pkg.angleLabel)}`
    triggerDownload(dataUrlToBlob(dataUrl), `${stem}.png`)
    triggerDownload(
      new Blob([promptFileText(pkg)], { type: 'text/plain;charset=utf-8' }),
      `${stem}.txt`,
    )
    return { status: 'downloaded', warnings: pkg.warnings }
  } catch (err) {
    return {
      status: 'failed',
      warnings: [...pkg.warnings, err instanceof Error ? err.message : String(err)],
    }
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
