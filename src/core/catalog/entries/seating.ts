import type { CatalogEntry, MeshPart } from '../types'

/**
 * Chair geometry convention: front faces -y (plan) / -z (three-local) at
 * rotation 0, so the backrest sits at +z.
 */
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

export const banquetChair: CatalogEntry = {
  id: 'chair.banquet',
  category: 'seating',
  labelKey: 'chairBanquet',
  defaultSize: { width: 45, depth: 45, height: 90 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [
    { name: 'upholstery', labelKey: 'upholstery', defaultColor: '#c8b89a' },
    { name: 'frame', labelKey: 'frame', defaultColor: '#6b6257' },
  ],
  footprint: chairFootprint,
  buildMesh: (s) => chairMesh(s, 2),
}

export const chiavariChair: CatalogEntry = {
  id: 'chair.chiavari',
  category: 'seating',
  labelKey: 'chairChiavari',
  defaultSize: { width: 42, depth: 42, height: 92 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [
    { name: 'upholstery', labelKey: 'upholstery', defaultColor: '#e9e2d4' },
    { name: 'frame', labelKey: 'frame', defaultColor: '#c9a86a' },
  ],
  footprint: chairFootprint,
  buildMesh: (s) => chairMesh(s, 1.5),
}

export const seatingEntries = [banquetChair, chiavariChair]
