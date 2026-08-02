/**
 * What laying a seat item REPLACES, and what it must leave standing.
 *
 * One rule, pulled two ways. Re-laying has to be idempotent — a table already set
 * must not end up double-set — but "the previous set" meant "the same catalog id",
 * and that answer stopped being right the moment a second KIND of cover existed:
 * switching from `decor.place-setting` to a fold left both on the table, one
 * inside the other, which is exactly the feature the user asked for failing in the
 * most confusing way available.
 *
 * The predicate is `requiresHost`, i.e. the item's ROLE:
 *   a COVER stands on the cloth and excludes every other cover;
 *   a NAPKIN stands on a cover and excludes only napkins of its own kind — it can
 *   never sweep away the cover it is about to be laid on (source doc §27).
 *
 * Both halves are asserted here because either one alone is easy to satisfy: an
 * id-scoped rule passes the napkin test and fails the cover test, and a
 * sweep-everything rule passes the cover test and fails the napkin test.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { useOverlayStore } from '../editor2d/overlayStore'
import { addObject, addSeatItemsToTable, newProject, seatItems } from './actions'
import { surfaceChildren } from './selectors'
import { useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene

const ORIGINAL = 'decor.place-setting'
const TIED = 'decor.place-setting-tied'
const DIAGONAL = 'decor.place-setting-diagonal'
const NAPKIN = 'decor.napkin-folded'
const OTHER_NAPKIN = 'decor.napkin-white'
const PLAIN_ROUND = 'table.round'

const ofKind = (tableId: string, catalogId: string) =>
  surfaceChildren(scene(), tableId).filter((c) => c.catalogId === catalogId)

beforeEach(() => {
  newProject({ name: 'seat items', venuePackId: 'resort' })
})

describe('laying a cover replaces the covers already laid', () => {
  it('leaves a table set with -tied only, after it was set with the plain cover', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    const first = addSeatItemsToTable(ORIGINAL, table)
    expect(first.length).toBeGreaterThan(0)

    const second = addSeatItemsToTable(TIED, table)

    // THE REGRESSION: scoped to the same catalog id, the plain covers survived and
    // the table carried two full sets standing one inside the other
    expect(ofKind(table, ORIGINAL)).toHaveLength(0)
    expect(ofKind(table, TIED)).toHaveLength(second.length)
    // exactly one set, no more and no fewer — same count the first lay produced,
    // because both are laid on the same seats
    expect(seatItems(scene(), table)).toHaveLength(first.length)
    expect(second).toHaveLength(first.length)
  })

  it('swaps between two of the new folds just as cleanly', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    const n = addSeatItemsToTable(DIAGONAL, table).length
    addSeatItemsToTable(TIED, table)
    expect(ofKind(table, DIAGONAL)).toHaveLength(0)
    expect(seatItems(scene(), table)).toHaveLength(n)
  })

  it('is still idempotent — re-laying the same cover re-syncs rather than doubles', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    const n = addSeatItemsToTable(TIED, table).length
    addSeatItemsToTable(TIED, table)
    expect(seatItems(scene(), table)).toHaveLength(n)
  })

  it('takes the napkins down with the cover they were standing on', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    addSeatItemsToTable(ORIGINAL, table)
    addSeatItemsToTable(NAPKIN, table)
    expect(ofKind(table, NAPKIN).length).toBeGreaterThan(0)

    addSeatItemsToTable(TIED, table)
    // `deleteWithStack` follows the `stackedOn` link: a napkin whose cover is gone
    // is the floating state §27 forbids, and the new fold brings its own napkin
    expect(ofKind(table, NAPKIN)).toHaveLength(0)
    expect(seatItems(scene(), table).every((o) => o.catalogId === TIED)).toBe(true)
  })
})

describe('laying a napkin leaves the cover under it standing (source doc §27)', () => {
  it('keeps every cover, and lays one napkin per cover', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    const covers = addSeatItemsToTable(ORIGINAL, table).length
    expect(covers).toBeGreaterThan(0)

    const napkins = addSeatItemsToTable(NAPKIN, table)

    // THE OTHER REGRESSION, the one a "sweep every seat item" rule would cause:
    // the napkin would delete the covers it is about to be laid on and then find
    // no host at all
    expect(ofKind(table, ORIGINAL)).toHaveLength(covers)
    expect(napkins).toHaveLength(covers)
    expect(ofKind(table, NAPKIN)).toHaveLength(covers)
  })

  it('replaces only napkins of its own kind, leaving the other napkin alone', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    const covers = addSeatItemsToTable(ORIGINAL, table).length
    addSeatItemsToTable(NAPKIN, table)
    addSeatItemsToTable(OTHER_NAPKIN, table)
    // both kinds can be laid at once — nothing in the model says one napkin per
    // cover across kinds, and the id-scoped rule is what the napkins still use
    expect(ofKind(table, NAPKIN)).toHaveLength(covers)
    expect(ofKind(table, OTHER_NAPKIN)).toHaveLength(covers)

    addSeatItemsToTable(NAPKIN, table)
    expect(ofKind(table, NAPKIN)).toHaveLength(covers)
    expect(ofKind(table, OTHER_NAPKIN)).toHaveLength(covers)
    expect(ofKind(table, ORIGINAL)).toHaveLength(covers)
  })

  it('refuses on a table set with a new fold, because the fold is not its host', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    addSeatItemsToTable(TIED, table)
    useOverlayStore.setState({ violation: null })

    const laid = addSeatItemsToTable(NAPKIN, table)

    // `requiresHost` names the EXACT id `decor.place-setting`, so this refusal is
    // free — it needs no code of its own, and it is why the three old napkins can
    // stay in the catalog beside the five new covers (PLAN-01 §3.6)
    expect(laid).toHaveLength(0)
    expect(useOverlayStore.getState().violation).toEqual({
      kind: 'missingHost',
      requires: ORIGINAL,
    })
    expect(getCatalogEntry(NAPKIN).requiresHost).toBe(ORIGINAL)
    // and the refusal costs the covers nothing
    expect(ofKind(table, TIED).length).toBeGreaterThan(0)
  })
})
