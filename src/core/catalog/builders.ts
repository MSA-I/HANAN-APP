import type { MeshPart } from './types'

/** Four legs at the corners of a w×d top, inset from the edges. */
export function fourLegs(
  w: number,
  d: number,
  height: number,
  inset: number,
  slot: string,
  thickness = 5,
): MeshPart[] {
  const x = w / 2 - inset
  const z = d / 2 - inset
  return [
    { x: -x, z: -z },
    { x, z: -z },
    { x: -x, z },
    { x, z },
  ].map(({ x, z }) => ({
    shape: 'box' as const,
    dims: [thickness, height, thickness],
    offset: [x, height / 2, z],
    slot,
  }))
}

/** Cylinder top + center pedestal + round base (round/cocktail tables). */
export function pedestalTable(diameter: number, height: number, clothSlot: string, legSlot: string): MeshPart[] {
  const r = diameter / 2
  const topThickness = 4
  return [
    { shape: 'cylinder', dims: [r, r, topThickness], offset: [0, height - topThickness / 2, 0], slot: clothSlot },
    { shape: 'cylinder', dims: [6, 6, height - topThickness], offset: [0, (height - topThickness) / 2, 0], slot: legSlot },
    { shape: 'cylinder', dims: [Math.min(r * 0.45, 30), Math.min(r * 0.45, 30), 3], offset: [0, 1.5, 0], slot: legSlot },
  ]
}

/** Box top + four legs (rectangular tables). */
export function leggedTable(w: number, d: number, height: number, clothSlot: string, legSlot: string): MeshPart[] {
  const topThickness = 4
  return [
    { shape: 'box', dims: [w, topThickness, d], offset: [0, height - topThickness / 2, 0], slot: clothSlot },
    ...fourLegs(w, d, height - topThickness, 10, legSlot),
  ]
}
