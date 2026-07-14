import type { CatalogEntry } from '../types'
import { leggedTable } from '../builders'

export const barCounter: CatalogEntry = {
  id: 'bar.straight',
  category: 'bars',
  labelKey: 'bar',
  defaultSize: { width: 200, depth: 60, height: 110 },
  resizable: ['width'],
  minSize: { width: 100 },
  maxSize: { width: 600 },
  materialSlots: [
    { name: 'body', labelKey: 'body', defaultColor: '#5c5148' },
    { name: 'counter', labelKey: 'counter', defaultColor: '#d9d2c7' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 4, slot: 'counter' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => [
    { shape: 'box', dims: [s.width, s.height - 4, s.depth], offset: [0, (s.height - 4) / 2, 0], slot: 'body' },
    { shape: 'box', dims: [s.width + 10, 4, s.depth + 10], offset: [0, s.height - 2, 0], slot: 'counter' },
  ],
  labelByDefault: true,
}

export const buffetTable: CatalogEntry = {
  id: 'buffet.table',
  category: 'bars',
  labelKey: 'buffet',
  defaultSize: { width: 240, depth: 76, height: 90 },
  resizable: ['width'],
  minSize: { width: 120 },
  maxSize: { width: 600 },
  materialSlots: [
    { name: 'cloth', labelKey: 'cloth', defaultColor: '#efe9df' },
    { name: 'legs', labelKey: 'legs', defaultColor: '#a67b5b' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 2, slot: 'cloth' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => leggedTable(s.width, s.depth, s.height, 'cloth', 'legs'),
  labelByDefault: true,
}

export const barEntries = [barCounter, buffetTable]
