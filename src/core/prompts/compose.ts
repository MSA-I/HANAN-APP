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
import { selectRefs, type Coverage, type DesignGroup, type ExportRef, type RefRole } from './refs'
import {
  CAPTURE_SHADOWS_OFF,
  SHARED_BACKGROUND,
  SHARED_DIRECTION,
  SHARED_NEGATIVE,
  templateFor,
} from './templates'

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
  // v9 categories (PLAN-02). Merged onto existing headings, not given new ones: a
  // heading absent from SECTION_ORDER is silently dropped by sectionLines.
  tableDesigns: 'CENTREPIECES',
  lighting: 'LIGHTING',
  decor: 'DECOR',
  chuppah: 'CHUPPAH',
  chuppahDecor: 'CHUPPAH', // v9
}

/**
 * ⚠ A TABLE-TOP PIECE IS A CENTREPIECE, WHATEVER CATEGORY IT FILES UNDER.
 *
 * v9 gave the ⌀380's two centre pieces their own `ringCenter` category and this
 * map a `ringCenter: 'CENTREPIECES'` row. v13 folded that category into 'tables',
 * and a plain `SECTIONS[category]` lookup would then have printed "TABLES: a
 * fluted urn filled with white rose buds" — the render prompt telling the image
 * model there is an extra guest table in the room for every centrepiece on one.
 *
 * Asking `placement` instead of the category is the fix that cannot rot: it is
 * the property that actually says "this stands ON something", and any future
 * table-top entry filed anywhere gets the right heading for free.
 */
function sectionFor(entry: { category: Category; placement?: string }): string {
  return entry.placement === 'surface' ? 'CENTREPIECES' : SECTIONS[entry.category]
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
    const heading = sectionFor(group.entry)
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
 * `reference image 4` / `reference images 4-9` — the numbers the model will see,
 * counted off the list that is actually being sent.
 *
 * Derived, never written down: the fixed references sit between the materials
 * shot and the design shots, and how many of them there are depends on what is
 * standing in the frame. A literal "2" here would silently point the model at
 * the wrong picture the first time a bar came into shot.
 *
 * Roles are contiguous in the list by construction (selectRefs), so first-to-last
 * is the whole range.
 */
function refPhrase(refs: ExportRef[], role: RefRole): string | null {
  const numbers = refs.flatMap((ref, i) => (ref.role === role ? [i + 1] : []))
  if (!numbers.length) return null
  const first = numbers[0]
  const last = numbers[numbers.length - 1]
  return first === last ? `reference image ${first}` : `reference images ${first}-${last}`
}

/**
 * The package for one angle. Never throws: an angle with no template, a scene
 * with no venue pack and an empty room all produce a usable prompt, because the
 * caller is a capture button and a thrown error there loses the frame.
 */
export function composeExport(
  scene: SceneState,
  angleId: string,
  coverage?: Coverage,
): ExportPackage {
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
  /**
   * PLAN-05 C3. `coverage` reaches the prose and the picture list through this
   * one call, which is the point: `sectionLines` below reads the SAME `groups`,
   * so an item the camera cannot see loses its reference slot and its sentence
   * together. Culling one without the other would leave the prompt describing a
   * table the model was never shown, or showing one it was told nothing about.
   */
  const selection = selectRefs(scene, camera ?? null, coverage)

  const lines = sectionLines(selection.groups)
  if (!lines.length) {
    warnings.push('The room is empty — the prompt describes the venue only.')
  }

  const materials = refPhrase(selection.refs, 'materials')
  const background = refPhrase(selection.refs, 'background')
  const floor = refPhrase(selection.refs, 'floor')
  const fixed = refPhrase(selection.refs, 'fixed')
  const design = refPhrase(selection.refs, 'design')
  const refInstructions = [
    materials && `MATERIALS: match ${materials} — floors, ceilings, metalwork, wall finishes.`,
    background && `BACKGROUND: ${background} is the real landscape this venue stands in.`,
    /**
     * PLAN-05 C1. The last sentence is the actual repair.
     *
     * The capture is a viewport shot of a SketchUp-derived model whose floor
     * carries a chevron working texture that the real hall does not have, while
     * SHARED_DIRECTION tells the model the capture defines everything. Handing
     * it the right photograph without also naming the one place it may depart
     * from the capture leaves it copying the zigzag with the swatch in hand —
     * which is exactly the state the user reported as "הריצוף לא יוצא טוב".
     */
    floor &&
      `FLOOR: ${floor} is a close-up of the stone this hall's floor is actually made of. Match ` +
        'its stone, colour, veining, tile size, joint lines and orthogonal layout exactly, at the ' +
        'same tile scale, throughout the frame. The floor in the supplied capture is a ' +
        'placeholder texture — take the layout and the perspective from the capture, and the ' +
        'floor material from this reference instead.',
    fixed &&
      `VENUE FIXTURES: ${fixed} are this building's OWN bar, DJ booth and planting — fittings of ` +
        'the hall, not props brought in for the event. Render them as shown and leave them where ' +
        'the capture puts them.',
    design && `DESIGN ELEMENTS: match ${design}.`,
  ].filter((s): s is string => !!s)

  /**
   * PLAN-05 C2. Read straight off the scene rather than through
   * `state/selectors.lightingOf`: core/prompts is renderer- and state-free by
   * design (refs.ts:180-182), and `composeExport` must stay a pure function of
   * the scene it is handed.
   *
   * `=== false` and not `!(… ?? true)` — absent and `true` are the same state,
   * and neither may put a sentence about missing shadows into the prompt of a
   * project that never touched the toggle.
   */
  const shadowsOff = scene.settings.lighting?.shadowsEnabled === false

  const prompt = [
    template?.base,
    template?.emphasis.map((e) => `- ${e}`).join('\n'),
    lines.length ? lines.join('\n') : null,
    refInstructions.join('\n'),
    background ? SHARED_BACKGROUND : null,
    SHARED_DIRECTION,
    shadowsOff ? CAPTURE_SHADOWS_OFF : null,
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

/**
 * `01-materials-hall.png`, `02-background-landscape.png`, `03-floor-detail.png`,
 * `04-fixed-bar-resort-left.webp`, `05-chuppah-draped-white.webp` — ordered and
 * readable, and the three always-on references are named for their ROLE because
 * their own file names ("1.png", "ריצוף.png") say nothing in an output folder.
 *
 * ⚠ Mirrored by `refFileName` in tools/capture-plugin.ts, which is what actually
 * writes the folder. The two must agree or manifest.json names files that are
 * not there — compose.test.ts calls both and compares them role by role.
 */
export function refFileName(ref: ExportRef, index: number): string {
  const ext = /\.[a-z0-9]+$/i.exec(ref.path)?.[0] ?? '.png'
  const n = String(index + 1).padStart(2, '0')
  if (ref.role === 'materials') return `${n}-materials-hall${ext}`
  if (ref.role === 'background') return `${n}-background-landscape${ext}`
  if (ref.role === 'floor') return `${n}-floor-detail${ext}`
  const stem = ref.path.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') ?? 'ref'
  return `${n}-${ref.role === 'fixed' ? 'fixed-' : ''}${stem}${ext}`
}
