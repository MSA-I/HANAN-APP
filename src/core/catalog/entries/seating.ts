/**
 * The venue's six real chairs — one entry per physical chair type in the resort's
 * inventory, NOT a generic chair catalog (furniture-library-spec.md). Each is a
 * baked Tripo GLB, so the colour lives in the model, not in a material slot: two
 * finishes of the same frame (gold+white / gold+black) are two entries, not one
 * entry with a colour picker.
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
  model: string,
  upholstery: string,
  frame: string,
): CatalogEntry {
  return {
    id,
    category: 'seating',
    labelKey,
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

export const chairXWhite = chair('chair.x-white', 'chairXWhite', '/props/chair-x-white.glb', '#f2f0ec', '#e8e6e1')
export const chairXWood = chair('chair.x-wood', 'chairXWood', '/props/chair-x-wood.glb', '#c9a877', '#3a3632')
export const chairGoldWhite = chair('chair.gold-white', 'chairGoldWhite', '/props/chair-gold-white.glb', '#f4f1ea', '#c9a86a')
export const chairGoldBlack = chair('chair.gold-black', 'chairGoldBlack', '/props/chair-gold-black.glb', '#2b2825', '#c9a86a')
export const chairBrown = chair('chair.brown', 'chairBrown', '/props/chair-brown.glb', '#8a6b4f', '#b49a78')
export const chairBlack = chair('chair.black', 'chairBlack', '/props/chair-black.glb', '#26241f', '#1a1917')

export const seatingEntries = [chairXWhite, chairXWood, chairGoldWhite, chairGoldBlack, chairBrown, chairBlack]
