/**
 * Assembles one export package: the prompt text plus the reference list that
 * goes with a single captured angle (PLAN-08 §45–47).
 *
 * There is no external API here and there never was meant to be one (§69–70) —
 * the templates are written by hand and this file only joins them to whatever is
 * standing in the room.
 */
import type { Category } from '../catalog/types'
import type { SceneState } from '../model/types'
import { getVenuePack, type SealedCamera } from '../venuePacks'
import { pluralize } from './fragments'
import { selectRefs, type DesignGroup, type ExportRef } from './refs'
import { SHARED_DIRECTION, SHARED_NEGATIVE, templateFor } from './templates'

export interface ExportPackage {
  angleId: string
  /** the human-readable angle name, for the output folder */
  angleLabel: string
  prompt: string
  refs: ExportRef[]
  warnings: string[]
}

/**
 * Heading each category is listed under. Categories that share a heading are
 * merged into one line, which is why this is a map and not the category name.
 */
const SECTIONS: Record<Category, string> = {
  tables: 'TABLES',
  seating: 'CHAIRS',
  bridalChair: 'BRIDAL SEAT',
  bars: 'STATIONS',
  tableware: 'PLACE SETTINGS',
  tableDecor: 'CENTREPIECES',
  lighting: 'LIGHTING',
  decor: 'DECOR',
  chuppah: 'CHUPPAH',
}

/** Heading order in the prompt — the order the eye reads a dressed room in. */
const SECTION_ORDER = [
  'CHUPPAH',
  'TABLES',
  'CHAIRS',
  'BRIDAL SEAT',
  'PLACE SETTINGS',
  'CENTREPIECES',
  'LIGHTING',
  'STATIONS',
  'DECOR',
] as const

function sectionLines(groups: DesignGroup[]): string[] {
  const bySection = new Map<string, string[]>()
  for (const group of groups) {
    const heading = SECTIONS[group.entry.category]
    const phrase = pluralize(group.caption, group.count)
    const list = bySection.get(heading)
    if (list) list.push(phrase)
    else bySection.set(heading, [phrase])
  }
  return SECTION_ORDER.filter((h) => bySection.has(h)).map(
    (h) => `${h}: ${bySection.get(h)!.join('; ')}`,
  )
}

/**
 * The package for one angle. Never throws: an angle with no template, a scene
 * with no venue pack and an empty room all produce a usable prompt, because the
 * caller is a capture button and a thrown error there loses the frame.
 */
export function composeExport(scene: SceneState, angleId: string): ExportPackage {
  const warnings: string[] = []
  const pack = getVenuePack(scene.venue.venuePackId)
  const camera = pack?.cameras?.find((c) => c.id === angleId)
  const template = templateFor(angleId)

  if (!template) {
    warnings.push(
      `No prompt template for angle "${angleId}" — the description of the viewpoint is missing ` +
        'and the prompt covers only the contents of the room.',
    )
  }

  // Gate 3's documented fallback: with no sealed camera there is nothing to
  // build a frustum from, so include the whole room and let the cap cut it.
  if (!camera) {
    warnings.push(
      `Angle "${angleId}" is not a sealed camera of this venue — every item in the scene was ` +
        'considered, not only the ones in frame.',
    )
  }
  const selection = selectRefs(scene, camera ?? null)

  const lines = sectionLines(selection.groups)
  if (!lines.length) {
    warnings.push('The room is empty — the prompt describes the venue only.')
  }

  const designCount = selection.refs.filter((r) => r.role === 'design').length
  const refInstructions = [
    'MATERIALS: match reference image 1 — floors, ceilings, metalwork, wall finishes.',
    designCount === 0
      ? null
      : designCount === 1
        ? 'DESIGN ELEMENTS: match reference image 2.'
        : `DESIGN ELEMENTS: match reference images 2-${designCount + 1}.`,
  ].filter((s): s is string => s !== null)

  const prompt = [
    template?.base,
    template?.emphasis.map((e) => `- ${e}`).join('\n'),
    lines.length ? lines.join('\n') : null,
    refInstructions.join('\n'),
    SHARED_DIRECTION,
    [SHARED_NEGATIVE, template?.negative].filter(Boolean).join(' '),
  ]
    .filter((part): part is string => !!part)
    .join('\n\n')

  return {
    angleId,
    angleLabel: camera?.label ?? angleId,
    prompt,
    refs: selection.refs,
    warnings: [...warnings, ...selection.warnings],
  }
}

/** Sealed angles this scene can export, in pack order. */
export function exportableAngles(scene: SceneState): SealedCamera[] {
  return getVenuePack(scene.venue.venuePackId)?.cameras ?? []
}

/**
 * `manifest.json` — what was exported, so a folder found later explains itself.
 * The timestamp is passed in rather than read here: the same value names the
 * folder, and two calls to `now()` can straddle a second boundary.
 */
export function manifestOf(pkg: ExportPackage, capturedAt: string) {
  return {
    angleId: pkg.angleId,
    angleLabel: pkg.angleLabel,
    capturedAt,
    capture: 'capture.png',
    prompt: 'prompt.txt',
    refs: pkg.refs.map((ref, i) => ({
      file: refFileName(ref, i),
      role: ref.role,
      caption: ref.caption,
      source: ref.path,
    })),
    warnings: pkg.warnings,
  }
}

/** `01-materials-hall.png`, `02-chuppah-draped-white.webp` — ordered and readable. */
export function refFileName(ref: ExportRef, index: number): string {
  const ext = /\.[a-z0-9]+$/i.exec(ref.path)?.[0] ?? '.png'
  const n = String(index + 1).padStart(2, '0')
  if (ref.role === 'materials') return `${n}-materials-hall${ext}`
  const stem = ref.path.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') ?? 'ref'
  return `${n}-${stem}${ext}`
}
