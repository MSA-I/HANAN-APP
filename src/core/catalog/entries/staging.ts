import type { CatalogEntry } from '../types'

export const stagePlatform: CatalogEntry = {
  id: 'stage.platform',
  category: 'staging',
  labelKey: 'stage',
  defaultSize: { width: 400, depth: 300, height: 60 },
  resizable: ['width', 'depth', 'height'],
  minSize: { width: 100, depth: 100, height: 20 },
  maxSize: { width: 1200, depth: 800, height: 150 },
  materialSlots: [
    { name: 'deck', labelKey: 'deck', defaultColor: '#4a4441' },
    { name: 'skirt', labelKey: 'skirt', defaultColor: '#2e2a28' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, slot: 'deck' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => [
    { shape: 'box', dims: [s.width, s.height - 3, s.depth], offset: [0, (s.height - 3) / 2, 0], slot: 'skirt' },
    { shape: 'box', dims: [s.width, 3, s.depth], offset: [0, s.height - 1.5, 0], slot: 'deck' },
  ],
  labelByDefault: true,
}

export const danceFloor: CatalogEntry = {
  id: 'dancefloor.rect',
  category: 'staging',
  labelKey: 'danceFloor',
  defaultSize: { width: 400, depth: 400, height: 3 },
  resizable: ['width', 'depth'],
  minSize: { width: 200, depth: 200 },
  maxSize: { width: 1200, depth: 1200 },
  materialSlots: [{ name: 'floor', labelKey: 'floor', defaultColor: '#c9a87c' }],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, slot: 'floor' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => [{ shape: 'box', dims: [s.width, s.height, s.depth], offset: [0, s.height / 2, 0], slot: 'floor' }],
  labelByDefault: true,
}

export const djBooth: CatalogEntry = {
  id: 'dj.booth',
  category: 'staging',
  labelKey: 'djBooth',
  defaultSize: { width: 160, depth: 70, height: 110 },
  resizable: ['width'],
  minSize: { width: 100 },
  maxSize: { width: 300 },
  materialSlots: [
    { name: 'body', labelKey: 'body', defaultColor: '#35312e' },
    { name: 'counter', labelKey: 'counter', defaultColor: '#57534e' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 4, slot: 'body' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => [
    { shape: 'box', dims: [s.width, s.height - 4, s.depth], offset: [0, (s.height - 4) / 2, 0], slot: 'body' },
    { shape: 'box', dims: [s.width + 8, 4, s.depth + 8], offset: [0, s.height - 2, 0], slot: 'counter' },
  ],
}

export const stagingEntries = [stagePlatform, danceFloor, djBooth]
