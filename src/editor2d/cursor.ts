/**
 * Which cursor the plan canvas is wearing.
 *
 * It was `panMode ? 'grab' : placing ? 'copy' : 'default'`, inline on the Stage2D
 * container (`Stage2D.tsx:600`), which is why the canvas never once said "this is
 * grabbable" over an object and never once said "you cannot drop that here" over
 * a blocked spot. Round 4 adds both, and the moment the expression grows past
 * three arms it needs a name, a stated precedence, and a test of the whole matrix
 * — a cursor bug is invisible in a screenshot and nobody files it.
 */

/**
 * A CSS cursor keyword. `pointer` is deliberately not in the union: it means
 * "this is a link", the canvas has none, and offering it is how a floor plan ends
 * up feeling like a web page.
 */
export type CursorStyle = 'grab' | 'grabbing' | 'copy' | 'not-allowed' | 'move' | 'default'

export interface CursorContext {
  /** the hand tool is on, or space is held */
  panMode: boolean
  /** the view is being dragged right now */
  panning: boolean
  /** an item is armed for placement */
  placing: boolean
  /** the placement ghost is over a legal spot */
  ghostValid: boolean
  /** the pointer is over something `isHoverable` said yes to */
  hovering: boolean
}

/**
 * Precedence, highest first. Each rank is what the pointer would DO if it were
 * pressed right now, which is the only ordering a cursor can honestly express:
 *
 *  1. `panning` — the view is already moving; a closed hand, whatever armed it.
 *     Above `panMode` so the grab/grabbing pair reads as one gesture rather than
 *     flickering back to the open hand mid-drag.
 *  2. `panMode` — pressing pans. This keeps the pan tool above `placing`, which
 *     is what Stage2D already does today: with the hand tool on, an armed item
 *     waits and the canvas is a viewport.
 *  3. `placing` — pressing drops. `copy` or `not-allowed`, and the invalid arm is
 *     the point: silently refusing a click is the failure mode round 3 shipped.
 *  4. `hovering` — pressing grabs the object under the pointer.
 *  5. everything else.
 */
export function cursorFor(ctx: CursorContext): CursorStyle {
  if (ctx.panning) return 'grabbing'
  if (ctx.panMode) return 'grab'
  if (ctx.placing) return ctx.ghostValid ? 'copy' : 'not-allowed'
  if (ctx.hovering) return 'move'
  return 'default'
}
