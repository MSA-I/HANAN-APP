import type { CatalogEntry } from '../types'
import { leggedTable } from '../builders'

export const barCounter: CatalogEntry = {
  id: 'bar.straight',
  category: 'bars',
  labelKey: 'bar',
  // THE resort bar station, sized from the user's real-bar photo (2026-07-19):
  // two joined counter units (~290 each → 580 total) PLUS the display wall
  // behind them — the wall is part of the bar (user-confirmed), so `height` is
  // the WALL top (237); the counter top lands at ~112 (fp-height was computed
  // counter-first: 112 / (counterRaw 0.204 / totalRaw 0.431) ≈ 237). Fits the
  // 800×300 bar zone. Photo-derived — tape measurements welcome.
  defaultSize: { width: 580, depth: 80, height: 237 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [
    { name: 'body', labelKey: 'body', defaultColor: '#5c5148' },
    { name: 'counter', labelKey: 'counter', defaultColor: '#d9d2c7' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 4, slot: 'counter' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => [
    // loading fallback mirrors the GLB: counter at the front, display wall behind
    { shape: 'box', dims: [s.width, 108, 62], offset: [0, 54, s.depth / 2 - 31], slot: 'body' },
    { shape: 'box', dims: [s.width + 10, 4, 68], offset: [0, 110, s.depth / 2 - 31], slot: 'counter' },
    { shape: 'box', dims: [s.width, s.height, 8], offset: [0, s.height / 2, -s.depth / 2 + 4], slot: 'body' },
  ],
  // real resort bar: "בר+ריזורט" (Tripo), re-prepped to the station size above.
  model: '/props/bar-straight.glb',
  thumbnail: '/thumbs/bar-straight.webp',
  // fixed station — lives only inside the venue's bar zone
  zoneKind: 'bar',
  labelByDefault: true,
}

export const djBooth: CatalogEntry = {
  id: 'dj.booth',
  category: 'bars',
  labelKey: 'djBooth',
  defaultSize: { width: 160, depth: 70, height: 110 },
  defaultRotation: -180,
  resizable: [],
  minSize: {},
  maxSize: {},
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
  // the venue's real DJ booth (Tripo), normalised to exactly 160×70×110
  model: '/props/dj-booth.glb',
  thumbnail: '/thumbs/dj-booth.webp',
  // fixed station — lives only inside the venue's DJ zone
  zoneKind: 'dj',
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

export const barEntries = [barCounter, djBooth, buffetTable]
