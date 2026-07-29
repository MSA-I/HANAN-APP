/**
 * How high the ground is at a point in the plan.
 *
 * The fault this exists for: the level was read off the ENTITY, never off the
 * place —
 *
 *     restricted.find(zone => zone.kind === entry.zoneKind)?.elevation ?? 0
 *
 * — and only the bar units, the DJ booth and the ceremony pieces carry a
 * `zoneKind` at all. NOTHING in the catalogue carries `zoneKind: 'kabalatPanim'`,
 * so a chair standing on the +4.70 m reception deck was drawn at Y = 0: on the
 * paving outside the building, four and a half metres below the deck the clamp
 * had just put it on. That is the user's report word for word (source doc item
 * 21), and R1/handoff/FOUND-04.md found the same line a round earlier.
 *
 * A level is a property of a PLACE, so it is looked up by place.
 *
 * ## Rectangles overlap, and the HIGHEST declared level wins
 *
 * Two real nestings in the resort, both total rather than partial:
 *
 * | inner | outer |
 * |---|---|
 * | the deck's ceremony pad, +5.20 | the reception deck, +4.70 |
 * | the hall's ceremony pad, +0.50 | the pool rectangle, no level |
 *
 * Both are a riser standing ON the larger surface, which is the general shape of
 * the thing — a platform is drawn inside what it stands on, never beside it — so
 * "the top surface here" is the answer that describes the building.
 *
 * It is also the safer of the two failure modes if a future pack overlaps two
 * rectangles in some way nobody has drawn yet. Taking the LOWEST (or the first in
 * the array, which is what the old code took by accident) buries the piece inside
 * the deck where it cannot be seen or picked — the exact fault being repaired.
 * Taking the highest can at worst leave it standing on a riser, in plain view.
 *
 * A rectangle with no `elevation` states no level and is skipped, rather than
 * counted as a declaration of 0. `pool`, `bar` and `dancefloor` say where you may
 * stand, not how high; reading their silence as "ground level" would mean any
 * rectangle drawn across the deck one day silently pulls everything on it back
 * down to the hall floor.
 */
import type { CatalogEntry } from '../catalog/types'
import type { Vec2 } from '../model/types'
import { isPointInZone, zoneUnder, type ZoneRect } from './zoneOccupancy'

export interface GroundZone extends ZoneRect {
  /** cm above the hall floor. Absent means this rectangle declares no level. */
  elevation?: number
  /** matched against a catalogue entry's `zoneKind` — see `standingHeightAt` */
  kind?: string
}

/** The top surface at this point, in plan cm. 0 where nothing is declared. */
export function groundHeightAt(point: Vec2, zones: readonly GroundZone[]): number {
  let top: number | undefined
  for (const zone of zones) {
    if (zone.elevation === undefined || !isPointInZone(point, zone)) continue
    // `> top` and not `> 0`: a sunken rectangle would be a level like any other,
    // and starting the fold at 0 would quietly refuse to report it
    if (top === undefined || zone.elevation > top) top = zone.elevation
  }
  return top ?? 0
}

/**
 * The level THIS entry stands at, here. The one rule, shared by the renderer and
 * the placement preview so that the ghost cannot promise a height the drop will
 * not use — a preview that hovers over a piece that lands is read as a worse
 * fault than the one being fixed.
 *
 * ⚠ `zoneKind` still WINS where it exists. A fixed station does not stand where
 * it was dropped: `clampToVenue` snaps it into its home rectangle from anywhere,
 * so the home rectangle — not the ground under the drop point — is the surface it
 * will end up on. Handing a chuppah the geometric answer instead would move every
 * canopy in every project saved so far.
 *
 * ⚠ A hung fixture answers 0 whatever it is over. Its `transform.elevation` is
 * already an absolute measured down from the lighting truss, and the truss is
 * fixed to the hall — it does not rise over the deck. A chandelier CAN hang over
 * the deck (`checkPlacement` exempts ceiling entries before the zone loop, and
 * `clampToVenue` pins them to the beam grid instead of ejecting them), so without
 * this line the first geometric ground reading would have lifted it 4.70 m
 * through its own cord.
 */
export function standingHeightAt(
  entry: Pick<CatalogEntry, 'zoneKind' | 'placement'>,
  point: Vec2,
  zones: readonly GroundZone[],
): number {
  if (entry.placement === 'ceiling') return 0
  if (entry.zoneKind) {
    const family = zones.filter((zone) => zone.kind === entry.zoneKind)
    return zoneUnder(family, point)?.elevation ?? 0
  }
  return groundHeightAt(point, zones)
}
