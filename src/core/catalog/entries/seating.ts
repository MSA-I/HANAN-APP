/**
 * The venue's six real chairs — one entry per physical chair type in the resort's
 * inventory, NOT a generic chair catalog (furniture-library-spec.md). Each is a
 * baked Tripo GLB, so the colour lives in the model, not in a material slot: two
 * finishes of the same frame (gold+white / gold+black) are two entries, not one
 * entry with a colour picker.
 *
 * Plus the bridal settee at the bottom, which is `category: 'bridalChair'` and
 * NOT part of `seatingEntries`: the inspector reads listByCategory('seating') to
 * fill the "chair model" dropdown for a table, and a two-metre settee must never
 * turn up there as something to ring a table with.
 *
 * Chair geometry convention: front faces -y (plan) / -z (three-local) at
 * rotation 0, so the backrest sits at +z. The GLBs were yawed to match at prep
 * time (tools/glb-prep/suggest-yaw.mjs) — Tripo's own yaw is arbitrary.
 *
 * `buildMesh` stays as the procedural fallback while a GLB loads / if it fails.
 */
import type { CatalogEntry, MeshPart } from '../types'

/** Real measured size of every chair in the inventory (spec §2). */
const CHAIR_SIZE = { width: 45, depth: 45, height: 92 }

function chairMesh(s: { width: number; depth: number; height: number }, legRadius: number): MeshPart[] {
  const seatH = 45
  const seatThickness = 5
  const backThickness = 4
  const legInsetX = s.width / 2 - 4
  const legInsetZ = s.depth / 2 - 4
  const legs: MeshPart[] = [
    { x: -legInsetX, z: -legInsetZ },
    { x: legInsetX, z: -legInsetZ },
    { x: -legInsetX, z: legInsetZ },
    { x: legInsetX, z: legInsetZ },
  ].map(({ x, z }) => ({
    shape: 'cylinder' as const,
    dims: [legRadius, legRadius, seatH - seatThickness],
    offset: [x, (seatH - seatThickness) / 2, z],
    slot: 'frame',
  }))
  return [
    { shape: 'box', dims: [s.width, seatThickness, s.depth], offset: [0, seatH - seatThickness / 2, 0], slot: 'upholstery' },
    {
      shape: 'box',
      dims: [s.width, s.height - seatH, backThickness],
      offset: [0, seatH + (s.height - seatH) / 2, s.depth / 2 - backThickness / 2],
      slot: 'upholstery',
    },
    ...legs,
  ]
}

function chairFootprint(s: { width: number; depth: number; height: number }) {
  return {
    parts: [
      { kind: 'rect' as const, w: s.width, h: s.depth, cornerRadius: 6, slot: 'upholstery' },
      // backrest indicator strip at the +y (back) edge
      { kind: 'rect' as const, w: s.width, h: 6, cy: s.depth / 2 - 3, slot: 'frame' },
    ],
    outline: { kind: 'rect' as const, w: s.width, h: s.depth },
  }
}

/**
 * One inventory chair. `upholstery`/`frame` colours only tint the 2D footprint and
 * the procedural fallback — the GLB's own baked materials win in 3D.
 */
function chair(
  id: string,
  labelKey: string,
  /** what the chair looks like, for the image prompt — see CatalogEntry.promptFragment */
  promptFragment: string,
  model: string,
  upholstery: string,
  frame: string,
): CatalogEntry {
  return {
    id,
    category: 'seating',
    labelKey,
    promptFragment,
    defaultSize: { ...CHAIR_SIZE },
    resizable: [],
    minSize: {},
    maxSize: {},
    materialSlots: [
      { name: 'upholstery', labelKey: 'upholstery', defaultColor: upholstery },
      { name: 'frame', labelKey: 'frame', defaultColor: frame },
    ],
    footprint: chairFootprint,
    buildMesh: (s) => chairMesh(s, 1.5),
    model,
    // product shot of the same physical chair (tools/thumbs-prep.mjs)
    thumbnail: `/thumbs/${id.replaceAll('.', '-')}.webp`,
  }
}

export const chairXWhite = chair('chair.x-white', 'chairXWhite', 'a white cross-back dining chair', '/props/chair-x-white.glb', '#f2f0ec', '#e8e6e1')
export const chairXWood = chair('chair.x-wood', 'chairXWood', 'a natural oak cross-back dining chair', '/props/chair-x-wood.glb', '#c9a877', '#3a3632')
export const chairGoldWhite = chair('chair.gold-white', 'chairGoldWhite', 'a gold-framed dining chair with white upholstery', '/props/chair-gold-white.glb', '#f4f1ea', '#c9a86a')
export const chairGoldBlack = chair('chair.gold-black', 'chairGoldBlack', 'a gold-framed dining chair with black upholstery', '/props/chair-gold-black.glb', '#2b2825', '#c9a86a')
export const chairBrown = chair('chair.brown', 'chairBrown', 'a brown upholstered dining chair on a pale wood frame', '/props/chair-brown.glb', '#8a6b4f', '#b49a78')
export const chairBlack = chair('chair.black', 'chairBlack', 'a black dining chair', '/props/chair-black.glb', '#26241f', '#1a1917')

export const seatingEntries = [chairXWhite, chairXWood, chairGoldWhite, chairGoldBlack, chairBrown, chairBlack]

/**
 * כסא כלה — the couple's seat. Not a chair at all: the source model
 * (HANAN-APP-DOCS\מודלים GLB\כסא כלה.glb, rendered to identify it) is a CURVED
 * seven-channel button-back settee on eight tapered legs, wide enough for two.
 * Its own category so it never mixes with the guest chairs.
 *
 * Sizing. Tripo normalises to a unit box, so the model carries proportions and
 * no scale; the bbox is 0.980 × 0.360 × 0.451 (W × H × D). The anchor that turns
 * that into centimetres is the seat: the body's full width holds up to y=0.208
 * and collapses to the backrest above it, so 0.208 IS the cushion top, and the
 * venue seats at 45 cm (the `seatH` every chair fallback below uses). 45/0.208 =
 * 216.3 cm per model unit gives the size below — a 212 cm settee, 78 cm to the
 * top of the back. ⚠ The seat height is the only assumed number here; a tape
 * measure on the real piece would replace it and everything else follows.
 * Handoff: Plans\handoff\01-bridal-chair-dims.md.
 *
 * The product shot took finding: it sat unmapped among the chandelier photos
 * because everyone was looking for a chair. Matched to the model by rendering
 * both — seven channel-tufted cushions inset from the ends, kidney seat with a
 * double welt, splayed tapered legs (Plans\handoff\BLOCKED-01-A1.md, gate 3).
 */
export const chairBridal: CatalogEntry = {
  id: 'chair.bridal',
  category: 'bridalChair',
  labelKey: 'chairBridal',
  promptFragment:
    'a curved seven-panel button-tufted bridal settee for two, on splayed tapered legs',
  defaultSize: { width: 212, depth: 97.6, height: 77.9 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [
    // one baked Tripo material for the whole piece, so both slots start from its
    // measured mean base colour (#d5c9b9) — they exist to let the plan view tell
    // the upholstery from the legs, not to describe two real finishes.
    { name: 'upholstery', labelKey: 'upholstery', defaultColor: '#d5c9b9' },
    { name: 'frame', labelKey: 'frame', defaultColor: '#d5c9b9' },
  ],
  footprint: chairFootprint,
  // thicker legs than a guest chair carries, at the settee's scale
  buildMesh: (s) => chairMesh(s, 3),
  model: '/props/chair-bridal.glb',
  thumbnail: '/thumbs/chair-bridal.webp',
}

export const bridalChairEntries = [chairBridal]
