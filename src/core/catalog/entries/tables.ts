import type { CatalogEntry } from '../types'
import { leggedTable, pedestalTable } from '../builders'

const CLOTH = { name: 'cloth', labelKey: 'cloth', defaultColor: '#f5f0e8' }
const LEGS = { name: 'legs', labelKey: 'legs', defaultColor: '#a67b5b' }

export const roundTable: CatalogEntry = {
  id: 'table.round',
  category: 'tables',
  labelKey: 'tableRound',
  defaultSize: { width: 180, depth: 180, height: 75 },
  resizable: ['width'],
  minSize: { width: 60 },
  maxSize: { width: 300 },
  linkWidthDepth: true,
  materialSlots: [CLOTH, LEGS],
  footprint: (s) => ({
    parts: [{ kind: 'circle', r: s.width / 2, slot: 'cloth' }],
    outline: { kind: 'circle', r: s.width / 2 },
  }),
  buildMesh: (s) => pedestalTable(s.width, s.height, 'cloth', 'legs'),
  seating: { min: 0, max: 20, defaultCount: 10, defaultChair: 'chair.banquet', defaultGap: 10, defaultOffset: 6 },
  labelByDefault: true,
}

export const rectTable: CatalogEntry = {
  id: 'table.rect',
  category: 'tables',
  labelKey: 'tableRect',
  defaultSize: { width: 180, depth: 90, height: 75 },
  resizable: ['width', 'depth'],
  minSize: { width: 60, depth: 50 },
  maxSize: { width: 400, depth: 200 },
  materialSlots: [CLOTH, LEGS],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 3, slot: 'cloth' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => leggedTable(s.width, s.depth, s.height, 'cloth', 'legs'),
  seating: { min: 0, max: 24, defaultCount: 6, defaultChair: 'chair.banquet', defaultGap: 10, defaultOffset: 6 },
  labelByDefault: true,
}

export const squareTable: CatalogEntry = {
  id: 'table.square',
  category: 'tables',
  labelKey: 'tableSquare',
  defaultSize: { width: 90, depth: 90, height: 75 },
  resizable: ['width'],
  minSize: { width: 60 },
  maxSize: { width: 200 },
  linkWidthDepth: true,
  materialSlots: [CLOTH, LEGS],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 3, slot: 'cloth' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => leggedTable(s.width, s.depth, s.height, 'cloth', 'legs'),
  seating: { min: 0, max: 12, defaultCount: 4, defaultChair: 'chair.banquet', defaultGap: 10, defaultOffset: 6 },
  labelByDefault: true,
}

export const banquetTable: CatalogEntry = {
  id: 'table.banquet',
  category: 'tables',
  labelKey: 'tableBanquet',
  defaultSize: { width: 240, depth: 76, height: 75 },
  resizable: ['width', 'depth'],
  minSize: { width: 120, depth: 60 },
  maxSize: { width: 600, depth: 120 },
  materialSlots: [CLOTH, LEGS],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 2, slot: 'cloth' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => leggedTable(s.width, s.depth, s.height, 'cloth', 'legs'),
  seating: { min: 0, max: 40, defaultCount: 10, defaultChair: 'chair.banquet', defaultGap: 8, defaultOffset: 6 },
  labelByDefault: true,
}

export const cocktailTable: CatalogEntry = {
  id: 'table.cocktail',
  category: 'tables',
  labelKey: 'tableCocktail',
  defaultSize: { width: 70, depth: 70, height: 110 },
  resizable: ['width'],
  minSize: { width: 50 },
  maxSize: { width: 100 },
  linkWidthDepth: true,
  materialSlots: [CLOTH, LEGS],
  footprint: (s) => ({
    parts: [{ kind: 'circle', r: s.width / 2, slot: 'cloth' }],
    outline: { kind: 'circle', r: s.width / 2 },
  }),
  buildMesh: (s) => pedestalTable(s.width, s.height, 'cloth', 'legs'),
}

export const tableEntries = [roundTable, rectTable, squareTable, banquetTable, cocktailTable]
