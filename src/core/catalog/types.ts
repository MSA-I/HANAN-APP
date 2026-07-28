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
 */
export type Category =
  | 'tables'
  | 'seating'
  | 'bridalChair'
  | 'bars'
  | 'tableware'
  | 'tableDecor'
  | 'tableDesigns'
  | 'ringCenter'
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
