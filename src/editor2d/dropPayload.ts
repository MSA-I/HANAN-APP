/**
 * What a library tile puts on the clipboard of a drag, and how the canvas reads
 * it back.
 *
 * There is no HTML5 drag-and-drop in the app yet — `ui/LibraryPanel.tsx` sets
 * `draggable={false}` and arms a click-to-place mode instead — so this is the
 * whole contract for the one round 4 adds, and both ends of it live here. A drag
 * that silently does nothing is the classic way this feature ships broken: the
 * drop handler reads a MIME the drag never set, `getData` returns `''`, and every
 * branch after it quietly falls through to "not a catalog item".
 */
import { hasCatalogEntry } from '../core/catalog/registry'

/**
 * A private MIME, not `text/plain`. `text/plain` is what a drag from anywhere
 * else on the page carries — a URL, a filename, a selected paragraph — and
 * accepting it would mean a stray text drag onto the canvas tries to place a
 * table. A vendor type is only ever set by us.
 */
export const CATALOG_MIME = 'application/x-hanan-catalog-id'

/**
 * The catalog id a drop is carrying, or null when it is not one of ours.
 *
 * IT TAKES A GETTER, NOT A `DataTransfer`. Tests run under `environment: 'node'`,
 * where that DOM type does not exist at runtime, and the drop handler has the
 * one-liner `(mime) => event.dataTransfer.getData(mime)` to hand. Depending on
 * the shape of the browser object rather than on the one string it is asked for
 * would push this whole file out of the test suite.
 *
 * Validated through the CATALOG, so a stale id — a saved drag, a retired entry, a
 * hand-crafted payload — is refused here rather than throwing out of
 * `getCatalogEntry` inside a drop handler, where it would take the canvas down
 * with it.
 */
export function catalogIdFromDrop(getData: (mime: string) => string): string | null {
  let raw: string
  try {
    raw = getData(CATALOG_MIME)
  } catch {
    // `DataTransfer.getData` throws outside a drag event in some browsers
    return null
  }
  if (typeof raw !== 'string') return null
  const id = raw.trim()
  return id && hasCatalogEntry(id) ? id : null
}
