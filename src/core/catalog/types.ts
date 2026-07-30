/**
 * Data-driven object catalog. A catalog entry fully describes an object type:
 * its 2D footprint (interpreted by one generic Konva component), its 3D build
 * recipe (interpreted by one generic three.js component), its material slots,
 * resize constraints and seating capability. Adding a furniture type means
 * adding an entry — never touching the renderers.
 */
import type { SeatingConfig, Size3D, Transform2D, Vec2 } from '../model/types'

/**
 * Library groups, in no particular order here — CATEGORY_ORDER (registry.ts) is
 * what the library and the layers panel read. They are also the layer keys
 * (`settings.layers`), so renaming one needs a migration; see migrations/index.ts
 * for the v5→v6 rename that split this list out of the original six.
 *
 * v8→v9 ADDED three (nine → twelve): 'tableDesigns' and 'ringCenter' for the two
 * new families of table-top arrangement, 'chuppahDecor' for the pieces that stand
 * on the floor beside the canopy. Adding a key needs no layer migration the way
 * renaming one does — a missing `settings.layers` entry already means visible and
 * unlocked (model/types.ts:115) — but MOVING an existing entry between categories
 * would orphan its stored flags, which is why none was moved; see the v9
 * migration's comment.
 *
 * v12→v13 REMOVED 'ringCenter' (twelve → eleven). Its two entries — the low table
 * that drops into the ⌀380's hole and the urn that stands on it — moved into
 * 'tables', because a library heading of its own for two items was a heading the
 * user had to learn. That IS the move v9's comment warned about, so v13 carries a
 * migration; unlike a rename it DELETES the orphaned layer flags rather than
 * merging them into `layers.tables`, for the reason written there.
 */
export type Category =
  | 'tables'
  | 'seating'
  | 'bridalChair'
  | 'bars'
  | 'tableware'
  | 'tableDecor'
  | 'tableDesigns'
  | 'lighting'
  | 'decor'
  | 'chuppah'
  | 'chuppahDecor'

export interface MaterialSlotDef {
  name: string
  /** key into strings.catalog.slots for the UI label */
  labelKey: string
  defaultColor: string
  /**
   * This slot takes ANY colour, not just the fixed event palette every other
   * editable slot offers. Set only on the two napkins, whose colour is chosen
   * per event to match the linen rather than picked from the house palette.
   */
  allowCustomColor?: boolean
}

export type FootprintPart =
  /** `rInner` > 0 draws a ring (⌀380 round table's central hole) rather than a disc */
  | { kind: 'circle'; r: number; rInner?: number; slot: string }
  | { kind: 'rect'; w: number; h: number; cx?: number; cy?: number; cornerRadius?: number; slot: string }
  /**
   * Annular sector — a slice of a ring, for curved bands (the serpentine table).
   * Plan space is y-down exactly like Konva's, so these map 1:1 onto <Arc>:
   * `startAngle` → its `rotation`, `sweep` → its `angle`, no conversion.
   *
   * `sweep` must be POSITIVE (degrees, clockwise on screen). Konva hands `angle`
   * to canvas `arc()` with counterClockwise=false, so a negative sweep would be
   * drawn as the 360°-minus complement — the whole ring instead of the slice.
   * Producers normalise by moving the start angle back instead.
   *
   * The one part that cannot be faked with what already exists: rect parts carry
   * no rotation, so a curved band tiled out of rects or circles renders as a
   * scalloped caterpillar once ObjectNode strokes every tile.
   */
  | {
      kind: 'arc'
      cx: number
      cy: number
      innerR: number
      outerR: number
      startAngle: number
      sweep: number
      slot: string
    }

/**
 * A RING is a circle carrying `rInner`, NOT a third variant.
 *
 * The ⌀380 round table has a real ⌀156 hole through its top (measured off
 * table-round-380.glb: radial coverage is 0% inside r=76 and 100% from r=80, the
 * edge landing at r≈78). Everything an outline is used for — the AABB, snapping,
 * venue clamping, seat placement, selection visuals, the library thumb — wants
 * the OUTER radius and is already correct reading `r`. Only the two consumers
 * that care about the hole read `rInner`, via `holeRadius`/`pointInHole` in
 * layout/bounds.ts.
 *
 * Spelling it `{ kind:'ring'; rOuter; rInner }` instead would have been the same
 * geometry, but it narrows `kind !== 'circle'` to include the ring, so all eight
 * sites that read `outline.w` in that branch stop compiling and each grows a case
 * that returns the outer radius they already had. serpentine.ts's header records
 * the project rejecting a third variant for exactly that reason. Absent or 0 =
 * solid disc, which is every other entry, unchanged.
 */
export type Outline =
  | { kind: 'circle'; r: number; rInner?: number }
  | { kind: 'rect'; w: number; h: number }

export interface FootprintSpec {
  parts: FootprintPart[]
  /** used for seat layout, snapping bounds and selection */
  outline: Outline
}

export type MeshPart = {
  shape: 'box' | 'cylinder' | 'sphere'
  /** box: [w,h,d] · cylinder: [rTop,rBottom,h] · sphere: [r] — cm */
  dims: number[]
  /** object-local, three convention: [x, elevation, z] where z = plan y — cm */
  offset: [number, number, number]
  slot: string
}

export interface SeatingCapability {
  min: number
  max: number
  defaultCount: number
  defaultChair: string
  defaultGap: number
  defaultOffset: number
}

export interface CatalogEntry {
  id: string
  category: Category
  /** key into strings.catalog.items */
  labelKey: string
  defaultSize: Size3D
  /** initial plan rotation for newly placed instances; existing saved objects are untouched */
  defaultRotation?: number
  resizable: Array<'width' | 'depth' | 'height'>
  minSize: Partial<Size3D>
  maxSize: Partial<Size3D>
  /** round tables etc.: diameter — width and depth stay equal */
  linkWidthDepth?: boolean
  materialSlots: MaterialSlotDef[]
  /** the only material slot the user may recolor; omitted means appearance is fixed */
  editableColorSlot?: string
  footprint: (size: Size3D) => FootprintSpec
  buildMesh: (size: Size3D) => MeshPart[]
  /**
   * URL of a real GLB (public/props/, prepped by glb-prep --mode prop). When set,
   * the 3D viewer renders this model instead of `buildMesh`. When
   * `editableColorSlot` is set, an explicit override tints cloned model materials
   * while preserving their textures and PBR properties. `buildMesh` stays as the
   * loading/error fallback.
   */
  model?: string
  /**
   * The prepped GLB's OWN real size, for the few entries catalogued at a size the
   * file was not prepped at (the chuppot, the DJ booth, the arc lamp). The loader
   * fits the model by `size / (modelSize ?? defaultSize)`, so the model always
   * ends up at the object's stored size — the same number the plan footprint, the
   * selection outline, snapping and the zone clamp use.
   *
   * It replaced a `modelScale` multiplier, which encoded the same ratio the other
   * way round (`defaultSize / modelSize`) and applied on top of the fit. That was
   * a derived number two edits away from its source: raising `defaultSize` without
   * matching it silently shrank the model to `defaultSize / modelScale` in 3D
   * while 2D drew `defaultSize`. Stating the model's own size instead cannot drift
   * — it is a property of the file, not of the catalogue entry.
   *
   * Omit it whenever glb-prep was run at `defaultSize`, which is the normal case.
   */
  modelSize?: Size3D
  /**
   * URL of a square photo thumbnail (public/thumbs/, 512×512 webp prepped by
   * tools/thumbs-prep.mjs). The library shows it instead of the vector top-view;
   * the SVG footprint stays as the fallback when absent or on image load error.
   */
  thumbnail?: string
  /**
   * Where this object lives. 'floor' (default) = a top-level object on the venue
   * floor. 'surface' = placed ON a table top (attached child, kind 'surface') —
   * it can only be dropped onto a table and is clamped to the table's outline.
   * 'seat' = like 'surface', but dropping it on a table lays one out at EVERY
   * seat instead of one at the pointer (place settings). 'ceiling' = hung from
   * the ceiling: a top-level object whose `elevation` starts at the venue's
   * wallHeight instead of 0.
   *
   * 'floor' and 'ceiling' are top-level objects; 'surface' and 'seat' are
   * attached children that can only be dropped onto a table.
   */
  placement?: 'floor' | 'surface' | 'seat' | 'ceiling'
  /**
   * Fixed-station entries (bar, DJ booth): when the venue pack has a restricted
   * zone of this kind, the object lives ONLY inside that zone — dropping it
   * anywhere snaps it in, and it can never be dragged out. Venues without a
   * matching zone (procedural room) place it freely.
   */
  zoneKind?: string
  /**
   * The item belongs in a BAND around a zone, not inside it and not anywhere
   * else: `within` cm measured outward from the zone rectangle's edge.
   *
   * The band, rather than a plain "allowed in zone X" list, is what source doc
   * §14 actually asks for — "vegetation 1 goes only AROUND the pool". The pool
   * is a no-go rectangle; nothing can be placed in it, so a membership list
   * would have made the rule unsatisfiable.
   *
   * Absent or empty = the whole legal floor, which is every other entry.
   */
  allowedZones?: { kind: string; within: number }[]
  /** The item must stand against a wall: at most N cm from the venue contour. */
  nearWall?: number
  /**
   * This item answers to NO placement rule: it may stand in a restricted zone, on
   * top of other furniture, and off the venue floor entirely. Source doc §17, in
   * the user's words: "it can be placed anywhere, including places other elements
   * are not allowed."
   *
   * It is a catalog property rather than a special case in the rules because that
   * is the only place the exemption is a fact about the ITEM. The two mechanisms
   * that already look like it are both the wrong shape:
   *
   *  - `zoneKind` also skips the check (collision.ts's early `return []`), but it
   *    means "fixed station", and `clampToVenue` reads it as licence to TELEPORT
   *    the object into that zone from anywhere in the hall. "Allowed everywhere"
   *    would become "allowed in exactly one rectangle".
   *  - `allowedZones` widens which zones an item may enter, but it also NARROWS it
   *    to those zones and nothing else, which is the opposite of the request.
   *
   * Set on exactly one entry, the human figure: it is a person standing in the
   * render for scale, not furniture that has to fit anywhere.
   */
  placeAnywhere?: boolean
  /**
   * The item cannot stand alone — it sits ON another catalog item, which must
   * already be on the same table. Dropping it lays one copy per host (the
   * napkins, which stack on the place settings; source doc §27).
   */
  requiresHost?: string
  /**
   * Where a surface item sits on its table. 'center' locks it to the middle,
   * 'free' (the default) lets it be dropped and dragged anywhere on the top.
   */
  surfaceAnchor?: 'center' | 'free'
  /**
   * Exclusivity tag. At most ONE object carrying a given `unique` value may
   * exist in a scene, across every catalog id that shares the tag — all eight
   * chuppot are `unique: 'chuppah'`, so any one of them blocks the rest, in any
   * zone. `addObject`/`replaceObject` reject the second one outright.
   */
  unique?: string
  seating?: SeatingCapability
  /**
   * Seat placement for a table whose seat line is neither a circle nor a
   * rectangle (the serpentine). When present, `seatsForEntry` uses this instead
   * of the generic `computeSeatTransforms`, and capacity comes from asking for
   * more seats than can fit and counting what comes back — so capacity and
   * placement can never disagree.
   *
   * It is a function here rather than a third `Outline` variant on purpose: a
   * new variant would force new geometry into all nine outline consumers —
   * point-in-S-band, clamp-decor-to-S-band, a THREE.Shape and a Konva selection
   * path among them — and every one of the 40+ existing entries would pay for a
   * shape one table needs. Entries with `seats` still declare a rect `outline`
   * of their bounding box, which is conservative in the safe direction: snapping
   * and venue clamping keep MORE clearance than the real table needs.
   */
  seats?: (seating: SeatingConfig, chair: Size3D) => Transform2D[]
  /** show the name label on canvas by default (tables) */
  labelByDefault?: boolean
  /**
   * How the library tile labels this item. 'size' (default) prints the footprint in
   * metres; 'seats' prints the chair count from `seating.defaultCount`; 'none' prints
   * nothing — most decor is bought by look, not by dimension (source doc §20).
   */
  librarySubtitle?: 'size' | 'seats' | 'none'
  /**
   * A short English noun phrase describing what this item LOOKS LIKE, for the
   * image-generation prompt (core/prompts). Singular and article-first ("a
   * folded linen napkin") — the composer pluralises it and prefixes the count.
   *
   * Written against the model and the product shot, not the Hebrew label: the
   * label is a name a venue manager uses ("שולחן אבירים"), and the image model
   * needs a description of the object. Where the two disagree the render wins —
   * `decor.goblet-crystal` is a pair of cut-crystal vases whatever its id says.
   *
   * Optional so an entry without one still composes; it falls back to the id,
   * which reads badly in a prompt and is meant to.
   */
  promptFragment?: string

  /**
   * Hebrew synonyms the library search should find this item by, beyond its own
   * label. Matched as a SUBSTRING over normalised text (ui/librarySearch.ts), so
   * write the SHORT, SINGULAR form and the longer ones come free: 'שולחן' finds
   * 'שולחנות', and not the other way round. Where both spellings are in real use
   * and neither contains the other — 'כסא' / 'כיסא' — both have to be listed.
   *
   * Authored on the ENTRY FACTORIES wherever one exists, so a family of twenty
   * items is one edit and cannot go half-done. Per-entry lists say what is true
   * of that one item and nothing else.
   *
   * They are search keys, not user-visible text, so they do NOT live in
   * ui/strings.ts (BRIEF §1.2 is about strings the user READS). Nothing renders
   * them.
   */
  keywords?: string[]

  // -------------------------------------------------------------------------
  // ROUND-4 ADDITIONS (A5). Four fields, kept together in one block rather than
  // filed beside the field each pairs with, because round 4 edits this file from
  // two branches at once and a contiguous append merges without a conflict. Each
  // one names its partner in its own comment; move them next to those partners
  // once the round has landed if that reads better.
  // -------------------------------------------------------------------------

  /**
   * The zone loop does not apply to this item: it may stand in a restricted
   * rectangle (the pool, the dance floor, the ceremony pad) and it answers to
   * EVERY other rule — collision, table clearance, the venue outline, the band
   * rules, `nearWall`. Source doc round 4 §7, in the user's words: the chuppah
   * decorations "should be placeable anywhere in the hall, in any zone".
   *
   * The narrowest of the three flags that look alike, and the other two are both
   * the wrong shape for this:
   *
   *  - `zoneKind` means FIXED STATION. It skips the check with an early
   *    `return []`, but `clampToVenue` also reads it as licence to TELEPORT the
   *    object into that rectangle from anywhere in the hall, and `ruled()` exempts
   *    it from the placement gate outright. "Anywhere" would become "in exactly
   *    one rectangle, wherever you let go of it".
   *  - `placeAnywhere` is a blanket `return []` at the top of `check()`: no
   *    collision, no siblings, not even the venue outline. That is right for a
   *    person standing in the render for scale and wrong for a 52 × 61 cm floral
   *    column, which is furniture and has to stay off the tables and inside the
   *    building.
   *
   * Deleting `zoneKind` alone would not do it either: a restricted zone refuses
   * everything that TOUCHES it, so the decoration would then be pushed OUT of the
   * chuppah pad, the aisle and the pool surround — the opposite of the request.
   *
   * Lifts the zone loop and nothing else. `allowedOnDeck` names it for the same
   * reason it names `placeAnywhere`: once `check()` stops asking about zones, a
   * "no" there would let `checkPlacement` say yes while `clampToVenue` shoved the
   * piece off the deck.
   */
  ignoresZones?: boolean

  /**
   * Pairs with `requiresHost`: a missing host is not a refusal, the drop LAYS the
   * host in the same gesture.
   *
   * `requiresHost` stays exactly as load-bearing as it was — it is what the
   * sibling-overlap skip, the `stackedOn` link and `surfaceBase` all read. This
   * flag changes one thing only: whether `checkPlacement` says `missingHost`.
   * Set on `ring.floral`, which drops into the ⌀380's well onto a `ring.table`
   * that the venue would always have put there anyway. NOT on the napkins: a
   * napkin without a place setting under it is a mistake, and 22 auto-laid covers
   * is not a gesture anybody asked for.
   */
  autoHost?: boolean

  /**
   * Pairs with `modelSize`: the width and depth of the model's USABLE TOP, in the
   * file's own units, for a model whose widest point is not its top.
   *
   * `modelSize` is the file's whole bounding box, and for a draped table that box
   * is the HEM near the floor. Fitting by it lands the top disc well short of the
   * opening it is supposed to fill — 10…12 cm of bare floor showing round
   * `ring.table` inside the ⌀380's ⌀156 well. Read by the 3D loader for the x and
   * z factors ONLY; the height still fits the file's own height.
   *
   * ⚠ Deliberately NOT "`modelSize` with different numbers". `STACK_HEIGHTS` in
   * state/actions.ts converts file cm to catalogue cm through
   * `defaultSize.height / modelSize.height`, and `stackedPosition` does the same
   * on x and z — so re-pointing `modelSize` at the top would silently mis-scale
   * the place setting's charger height and the napkin's offset onto it. The two
   * are different measurements of the same file and both are needed.
   *
   * Omit it whenever the file's box IS its top, which is every other entry.
   */
  modelTopSize?: { width: number; depth: number }

  /**
   * Pairs with `seats`: WHICH of the transforms `seats` produced take a place
   * setting, by index. Absent means all of them, which is every other table.
   *
   * By index because `seats` already has an ordering contract — `reconcileSeats`
   * maps a stored chair to a position by its index, so the serpentine's flanks own
   * 0…n−1 and its two heads are APPENDED. Stating the subset in the same terms is
   * what lets this file and layout/serpentine.ts agree without either re-deriving
   * the other's numbers.
   *
   * ⚠ NOT `headSeats: number`. `serpentineSeats` appends the heads with
   * `.slice(0, max(0, count − out.length))`, so a table configured for 15 chairs
   * has ZERO heads and "drop the last two" would silently strip two FLANK covers.
   * The index set is derived from the same `capacities()` the walk divides by, so
   * it is empty of heads exactly when the walk is.
   *
   * Set on the serpentine, where the two head covers lie at 90° to their flank
   * neighbours across the band and interpenetrate them by a measured 12…15 cm at
   * every position inside it (layout/serpentine.ts's note on the head seats has
   * the sweep). The CHAIRS are unaffected — all 22 stay.
   */
  seatItemSeats?: (seating: SeatingConfig, chair: Size3D) => number[]
}

export function defaultAppearance(entry: CatalogEntry): Record<string, { color?: string }> {
  const out: Record<string, { color?: string }> = {}
  for (const slot of entry.materialSlots) out[slot.name] = { color: slot.defaultColor }
  return out
}

export function slotColor(
  entry: CatalogEntry,
  appearance: Record<string, { color?: string }>,
  slot: string,
): string {
  const fromOverride = appearance[slot]?.color
  if (fromOverride) return fromOverride
  const def = entry.materialSlots.find((s) => s.name === slot)
  return def?.defaultColor ?? '#cccccc'
}

export function anchorOf(_size: Size3D): Vec2 {
  return { x: 0, y: 0 }
}

/**
 * A table you can put a chair at and stand things on — the thing every reader of
 * `category === 'tables'` has always meant.
 *
 * ⚠ `category === 'tables'` STOPPED MEANING THAT AT v13. The category then held
 * six floor tables and nothing else, so the two tests were the same test. v13
 * folded `ringCenter` into it (see the `Category` note above), and its two members
 * are `placement: 'surface'` — a table-top piece and the low table that drops
 * through the ⌀380's hole. Left as a bare category test, nine call sites would
 * have started treating a centrepiece as a guest table: offering it as a drop
 * target for table decor, demanding table-to-table clearance around it, laying a
 * table design on it.
 *
 * It lives HERE and not in state/selectors.ts on purpose: core/layout/collision.ts
 * is one of its callers, and nothing in core/ may depend on state/.
 */
export function isFloorTable(entry: CatalogEntry): boolean {
  return entry.category === 'tables' && entry.placement !== 'surface'
}
