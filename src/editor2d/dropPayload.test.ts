/**
 * The drag payload.
 *
 * This is where a dead drag-and-drop hides: `getData` on a MIME nobody set
 * returns `''`, not an error, so a drop that reads the wrong key looks exactly
 * like a drop of nothing and the feature ships silently broken. The tests below
 * are mostly about what must be REFUSED, and the fake `DataTransfer` is a plain
 * `Map` because there is no such DOM type under `environment: 'node'`.
 *
 * The one id that must be accepted is read from the catalog, never typed out:
 * entries have been renamed between rounds, and a hardcoded id would pass here
 * while the real library dragged something this function rejects.
 */
import { describe, expect, it } from 'vitest'
import { listCatalog } from '../core/catalog/registry'
import { CATALOG_MIME, catalogIdFromDrop } from './dropPayload'

/** Exactly what a browser gives back: '' for a key that was never set. */
const dropOf = (entries: Record<string, string>) => (mime: string) => entries[mime] ?? ''

const A_REAL_ID = listCatalog()[0].id

describe('a drag we set', () => {
  it('comes back as the catalog id', () => {
    expect(catalogIdFromDrop(dropOf({ [CATALOG_MIME]: A_REAL_ID }))).toBe(A_REAL_ID)
  })

  it('works for every entry in the catalog, not just the first', () => {
    for (const entry of listCatalog()) {
      expect(catalogIdFromDrop(dropOf({ [CATALOG_MIME]: entry.id }))).toBe(entry.id)
    }
  })

  it('tolerates the whitespace a copied payload picks up', () => {
    expect(catalogIdFromDrop(dropOf({ [CATALOG_MIME]: `  ${A_REAL_ID}\n` }))).toBe(A_REAL_ID)
  })

  it('asks for exactly one MIME', () => {
    const asked: string[] = []
    catalogIdFromDrop((mime) => {
      asked.push(mime)
      return mime === CATALOG_MIME ? A_REAL_ID : ''
    })
    expect(asked).toEqual([CATALOG_MIME])
  })
})

describe('a drag that is not ours', () => {
  it('refuses a foreign MIME', () => {
    expect(catalogIdFromDrop(dropOf({ 'text/plain': A_REAL_ID }))).toBeNull()
    expect(catalogIdFromDrop(dropOf({ 'text/uri-list': 'https://example.com' }))).toBeNull()
    expect(catalogIdFromDrop(dropOf({ 'text/html': `<b>${A_REAL_ID}</b>` }))).toBeNull()
  })

  /** The silent-failure case: nothing was set, so `getData` hands back ''. */
  it('refuses an empty payload', () => {
    expect(catalogIdFromDrop(dropOf({}))).toBeNull()
    expect(catalogIdFromDrop(dropOf({ [CATALOG_MIME]: '' }))).toBeNull()
    expect(catalogIdFromDrop(dropOf({ [CATALOG_MIME]: '   ' }))).toBeNull()
  })

  /**
   * A well-formed id for something the catalog no longer has. It must die here:
   * `getCatalogEntry` THROWS on an unknown id, and thrown from inside a drop
   * handler that takes the canvas down with it.
   */
  it('refuses a well-formed id the catalog does not have', () => {
    expect(catalogIdFromDrop(dropOf({ [CATALOG_MIME]: 'table.retired-in-round-2' }))).toBeNull()
    expect(catalogIdFromDrop(dropOf({ [CATALOG_MIME]: `${A_REAL_ID}x` }))).toBeNull()
    expect(catalogIdFromDrop(dropOf({ [CATALOG_MIME]: A_REAL_ID.toUpperCase() }))).toBeNull()
    expect(catalogIdFromDrop(dropOf({ [CATALOG_MIME]: '__proto__' }))).toBeNull()
    expect(catalogIdFromDrop(dropOf({ [CATALOG_MIME]: 'constructor' }))).toBeNull()
  })

  it('refuses a getter that hands back something that is not a string', () => {
    expect(catalogIdFromDrop(() => null as unknown as string)).toBeNull()
    expect(catalogIdFromDrop(() => undefined as unknown as string)).toBeNull()
    expect(catalogIdFromDrop(() => 42 as unknown as string)).toBeNull()
  })

  /** `DataTransfer.getData` throws outside a drag event in some browsers. */
  it('refuses a getter that throws, instead of taking the canvas with it', () => {
    expect(
      catalogIdFromDrop(() => {
        throw new Error('permission denied')
      }),
    ).toBeNull()
  })
})
