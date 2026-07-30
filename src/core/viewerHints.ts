/**
 * Which single line the 3D viewer's hint strip is showing.
 *
 * Ids only — the mapping to Hebrew copy belongs to the 3D plan and `ui/strings.ts`.
 * Keeping the CHOICE here, away from the text, is what makes it node-testable and
 * what makes the precedence a stated rule rather than a chain of `&&`s inside a
 * JSX expression, where it would be re-derived slightly differently the next time
 * a state is added.
 */

export type HintId =
  /** an object is being dragged across the floor */
  | 'dragMove'
  /** an object is being turned by its ring */
  | 'dragRotate'
  /** the camera is being orbited */
  | 'orbit'
  /** an item is armed and the next click drops it */
  | 'placing'
  /** one table is isolated for decor editing */
  | 'designEdit'
  /** something is selected and nothing is happening to it */
  | 'selection'
  /** nothing selected, nothing armed */
  | 'idle'

export interface ViewerHintContext {
  /** how many objects are selected */
  selection: number
  /** an item is armed for placement */
  placing: boolean
  /** the orbit modifier/button is down */
  orbitHeld: boolean
  dragging: 'move' | 'rotate' | null
  /** design-edit mode is open on a table */
  designEdit: boolean
}

/**
 * ONE total order, most-immediate first. Ties are impossible by construction,
 * which is the entire reason this is a function and not five nested ternaries in
 * the viewer:
 *
 *  1. `dragging` — the user's hand is down and something is moving RIGHT NOW.
 *     Nothing can be more urgent, and the line has to say what releasing does.
 *  2. `orbitHeld` — the hand is down on the camera. Below `dragging` on purpose:
 *     an object drag and an orbit cannot both start (the button is already
 *     taken), so the pair only ever collides through a stale flag, and this
 *     ordering means a leftover orbit flag can never mask a live drag. The
 *     reverse would freeze the hint on "orbiting" for the rest of the session.
 *  3. `placing` — the pointer is loaded. It beats every mode below because it
 *     describes what the NEXT CLICK does, and the next click places.
 *  4. `designEdit` — a mode that changes what a click means but does not consume
 *     it. It is the ROOM the placement happens in, so it sits under placing.
 *  5. `selection` — ambient: here is what you could do to what you have picked.
 *  6. `idle`.
 *
 * `selection` is a count rather than a boolean so the copy can distinguish one
 * object from several without a second context field going stale beside it.
 */
export function viewerHint(ctx: ViewerHintContext): HintId {
  if (ctx.dragging === 'move') return 'dragMove'
  if (ctx.dragging === 'rotate') return 'dragRotate'
  if (ctx.orbitHeld) return 'orbit'
  if (ctx.placing) return 'placing'
  if (ctx.designEdit) return 'designEdit'
  if (ctx.selection > 0) return 'selection'
  return 'idle'
}
