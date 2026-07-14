import type { CatalogEntry } from '../types'

export const pottedPlant: CatalogEntry = {
  id: 'plant.potted',
  category: 'decor',
  labelKey: 'plant',
  defaultSize: { width: 50, depth: 50, height: 160 },
  resizable: ['width', 'height'],
  minSize: { width: 30, height: 80 },
  maxSize: { width: 100, height: 300 },
  linkWidthDepth: true,
  materialSlots: [
    { name: 'pot', labelKey: 'pot', defaultColor: '#b8afa3' },
    { name: 'foliage', labelKey: 'foliage', defaultColor: '#5f7f4f' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'circle', r: s.width / 2, slot: 'foliage' }],
    outline: { kind: 'circle', r: s.width / 2 },
  }),
  buildMesh: (s) => {
    const potH = s.height * 0.25
    const foliageR = s.width * 0.65
    return [
      { shape: 'cylinder', dims: [s.width * 0.35, s.width * 0.28, potH], offset: [0, potH / 2, 0], slot: 'pot' },
      { shape: 'sphere', dims: [foliageR], offset: [0, potH + (s.height - potH) * 0.55, 0], slot: 'foliage' },
    ]
  },
}

export const dividerScreen: CatalogEntry = {
  id: 'divider.screen',
  category: 'decor',
  labelKey: 'divider',
  defaultSize: { width: 180, depth: 6, height: 180 },
  resizable: ['width', 'height'],
  minSize: { width: 60, height: 100 },
  maxSize: { width: 600, height: 300 },
  materialSlots: [{ name: 'panel', labelKey: 'panel', defaultColor: '#d8d2c8' }],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, slot: 'panel' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => [
    { shape: 'box', dims: [s.width, s.height, s.depth], offset: [0, s.height / 2, 0], slot: 'panel' },
  ],
}

export const decorEntries = [pottedPlant, dividerScreen]
