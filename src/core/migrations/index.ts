/**
 * Schema migration + validation for persisted project files.
 *
 * A stored file may have been written by an older build. `migrateAndValidate`
 * upgrades a raw value through every pending migration and then validates the
 * result against a zod schema mirroring the model types. This runs on every
 * repository read and on JSON import, so corrupt or foreign data is rejected
 * at the boundary rather than crashing the editor downstream.
 */
import { z } from 'zod'
import { clampHang } from '../layout/beams'
import { SCHEMA_VERSION } from '../model/types'
import { getVenuePack } from '../venuePacks'
import type { ProjectFile } from '../../persistence/types'

export { SCHEMA_VERSION }

/**
 * v1 → v2: the generic starter catalog was replaced by the venue's real inventory
 * (phase 2.5), so several catalog ids no longer exist. `getCatalogEntry` throws on
 * an unknown id, which would make an old project unopenable — remap them onto the
 * closest real item instead. Sizes are left alone: an object keeps its stored size,
 * and the GLB is fitted to it.
 */
const CATALOG_ID_V2: Record<string, string> = {
  // the two placeholder chairs → the house chair (white crossback)
  'chair.banquet': 'chair.x-white',
  'chair.chiavari': 'chair.x-white',
  // tables with no real counterpart → the nearest real one
  'table.rect': 'table.banquet',
  'table.cocktail': 'table.round',
}

function remapCatalogIds(raw: unknown): unknown {
  const file = raw as {
    project?: { scene?: { objects?: Record<string, { catalogId?: string; seating?: { chairCatalogId?: string } }> } }
  }
  const objects = file?.project?.scene?.objects
  if (objects) {
    for (const obj of Object.values(objects)) {
      const mapped = obj.catalogId ? CATALOG_ID_V2[obj.catalogId] : undefined
      if (mapped) obj.catalogId = mapped
      const chair = obj.seating?.chairCatalogId ? CATALOG_ID_V2[obj.seating.chairCatalogId] : undefined
      if (chair && obj.seating) obj.seating.chairCatalogId = chair
    }
  }
  return { ...(raw as object), schemaVersion: 2, project: { ...file.project, schemaVersion: 2 } }
}

/**
 * v2 → v3: the attachment format gained a second kind ('surface' — decor standing
 * on a table top). Existing v2 data is already valid v3, so this is a pure
 * version bump that marks the file as written by a surface-aware build.
 */
function bumpToV3(raw: unknown): unknown {
  const file = raw as { project?: object }
  return { ...(raw as object), schemaVersion: 3, project: { ...file.project, schemaVersion: 3 } }
}

/**
 * v3 → v4: the "staging" catalog category was removed — the venue pack itself
 * provides the fixed stage/dance-floor, so placed `stage.platform` and
 * `dancefloor.rect` objects are deleted (plus any children orphaned by that).
 * Also introduces `settings.layers` (per-category show/lock), defaulted to {}.
 */
const REMOVED_CATALOG_IDS_V4 = new Set(['stage.platform', 'dancefloor.rect'])

function dropStagingAndAddLayers(raw: unknown): unknown {
  const file = raw as {
    project?: {
      scene?: {
        objects?: Record<string, { catalogId?: string; parentId?: string | null }>
        objectOrder?: string[]
        settings?: { layers?: unknown }
      }
    }
  }
  const scene = file?.project?.scene
  const objects = scene?.objects
  if (objects) {
    for (const [id, obj] of Object.entries(objects)) {
      if (obj.catalogId && REMOVED_CATALOG_IDS_V4.has(obj.catalogId)) delete objects[id]
    }
    // orphan sweep to fixpoint — drop children whose parent chain was deleted
    let changed = true
    while (changed) {
      changed = false
      for (const [id, obj] of Object.entries(objects)) {
        if (obj.parentId && !(obj.parentId in objects)) {
          delete objects[id]
          changed = true
        }
      }
    }
    if (Array.isArray(scene.objectOrder)) {
      scene.objectOrder = scene.objectOrder.filter((id) => id in objects)
    }
  }
  if (scene?.settings) scene.settings.layers ??= {}
  return { ...(raw as object), schemaVersion: 4, project: { ...file.project, schemaVersion: 4 } }
}

/**
 * v4 → v5: ceiling items in the resort pack used to hang from the roof apex
 * (wallHeight 1160); they now hang from the lighting-truss pipe level. Re-pin
 * every stored hung object's TOP to that anchor. Constants are frozen at the
 * values this migration shipped with — the live pack config may drift later.
 */
const RESORT_HANG_HEIGHT_V5 = 895
const CEILING_CATALOG_IDS_V5 = new Set([
  'lamp.pendant',
  'lamp.pendant-cluster',
  'lamp.chandelier-diamond',
  'lamp.chandelier-basket',
  'lamp.chandelier-candelabra',
])

function repinCeilingToTruss(raw: unknown): unknown {
  const file = raw as {
    project?: {
      scene?: {
        venue?: { venuePackId?: string | null }
        objects?: Record<string, { catalogId?: string; transform?: { elevation?: number }; size?: { height?: number } }>
      }
    }
  }
  const scene = file?.project?.scene
  if (scene?.venue?.venuePackId === 'resort' && scene.objects) {
    for (const obj of Object.values(scene.objects)) {
      if (!obj.catalogId || !CEILING_CATALOG_IDS_V5.has(obj.catalogId)) continue
      if (!obj.transform || typeof obj.size?.height !== 'number') continue
      obj.transform.elevation = RESORT_HANG_HEIGHT_V5 - obj.size.height
    }
  }
  return { ...(raw as object), schemaVersion: 5, project: { ...file.project, schemaVersion: 5 } }
}

/**
 * v5 → v6: the catalog's six categories became nine — the chuppot left the
 * catch-all 'structure' for their own 'chuppah', ceiling fixtures split out of
 * 'decor' into 'lighting', the place setting and the napkins out of 'tableDecor'
 * into 'tableware', and the bridal settee out of 'seating' into 'bridalChair'.
 *
 * Category names ARE the keys of `settings.layers`, so without this the stored
 * show/lock flags would be orphaned. A renamed category carries its flags across;
 * a category that SPLIT OFF inherits the flags of the layer its items used to
 * live in, so someone who hid "עיצוב" does not suddenly see chandeliers reappear.
 * Objects themselves need no change: they store a catalogId, and the category is
 * looked up from the catalog.
 *
 * Empty flags are not written. `setLayerFlag` (state/actions.ts) deletes a layer
 * entry once both flags are off, so `{}` is not a state worth propagating.
 */
const LAYER_RENAMED_V6: Record<string, string> = { structure: 'chuppah' }
/** new category ← the layer whose state it inherits */
const LAYER_SPLIT_FROM_V6: Record<string, string> = {
  lighting: 'decor',
  tableware: 'tableDecor',
  bridalChair: 'seating',
}

type LayerFlagsRaw = { hidden?: boolean; locked?: boolean }
const isSet = (f: LayerFlagsRaw | undefined) => !!f && (f.hidden === true || f.locked === true)

function renameCategoryLayers(raw: unknown): unknown {
  const file = raw as {
    project?: { scene?: { settings?: { layers?: Record<string, LayerFlagsRaw> } } }
  }
  const layers = file?.project?.scene?.settings?.layers
  if (layers) {
    for (const [from, to] of Object.entries(LAYER_RENAMED_V6)) {
      const flags = layers[from]
      delete layers[from]
      if (isSet(flags)) layers[to] = flags
    }
    for (const [to, from] of Object.entries(LAYER_SPLIT_FROM_V6)) {
      const flags = layers[from]
      if (isSet(flags)) layers[to] = { ...flags }
    }
  }
  return { ...(raw as object), schemaVersion: 6, project: { ...file.project, schemaVersion: 6 } }
}

/**
 * v6 → v7: the resort hall was re-imported from an updated SketchUp model. The
 * passage got shorter and a raised reception deck joined the plan, which widened
 * the venue from 4423 to 6051 cm. A stored scene carries its OWN `venue.size`,
 * so without this a project saved before the re-import would keep clamping
 * furniture to the old rectangle and the reception deck would be unreachable.
 *
 * ponytail: no re-clamp pass. Every hall zone kept its exact v6 rectangle, the
 * floor only GREW (2544 deep unchanged, 4423 → 6051 wide) and the one zone that
 * changed — the passage — only SHRANK. So no stored object can be newly out of
 * bounds or newly inside a no-go zone; a clamp here is provably a no-op, and
 * importing one from actions.ts would make persistence depend on the store.
 * The real `clampToVenue` still runs on the first edit either way.
 *
 * Constants are frozen at the values this migration shipped with, like v5 —
 * the live pack may drift later and old files must still land where they did.
 */
const RESORT_SIZE_V7 = { width: 6051, depth: 2544 }
const RESORT_WALL_HEIGHT_V7 = 1160

function widenResortVenue(raw: unknown): unknown {
  const file = raw as {
    project?: {
      scene?: {
        venue?: { venuePackId?: string | null; size?: { width: number; depth: number }; wallHeight?: number }
      }
    }
  }
  const venue = file?.project?.scene?.venue
  if (venue?.venuePackId === 'resort') {
    venue.size = { ...RESORT_SIZE_V7 }
    venue.wallHeight = RESORT_WALL_HEIGHT_V7
  }
  return { ...(raw as object), schemaVersion: 7, project: { ...file.project, schemaVersion: 7 } }
}

/**
 * v7 → v8: `meta.layout` was ONE tag shared by every kind of saved arrangement,
 * so applying a lighting layout deleted the table layout and vice versa (only
 * one could exist at a time). Each kind now owns a key — `meta.layoutTables`,
 * `meta.layoutLighting`, and the pre-existing `meta.design` for table decor.
 *
 * Every v7 tag was written by a hall TABLE layout (that was the only producer),
 * so the rename is unconditional. Objects keep their identity and position; only
 * the tag key moves, which is what keeps an applied layout still recognised as
 * applied after the upgrade.
 *
 * `flags.frozen` also arrives in v8, but it is optional and only the bake tool
 * writes it — no stored object needs touching.
 */
function splitLayoutTags(raw: unknown): unknown {
  const file = raw as {
    project?: { scene?: { objects?: Record<string, { meta?: Record<string, unknown> }> } }
  }
  const objects = file?.project?.scene?.objects
  if (objects) {
    for (const object of Object.values(objects)) {
      const meta = object.meta
      if (!meta || meta.layout === undefined) continue
      meta.layoutTables = meta.layout
      delete meta.layout
    }
  }
  return { ...(raw as object), schemaVersion: 8, project: { ...file.project, schemaVersion: 8 } }
}

/**
 * v8 → v9: the catalog's nine categories became twelve — 'tableDesigns' and
 * 'ringCenter' for the two new families of table-top arrangement, 'chuppahDecor'
 * for the pieces that stand on the floor beside the canopy. Category ids are also
 * the keys of `settings.layers`, which is why a category change lands here at all.
 *
 * What this migration does, and — just as important — what it deliberately does
 * NOT do:
 *
 * 1. LAYERS: nothing, on purpose. v5→v6 had to act because keys were RENAMED and
 *    SPLIT, so a stored `structure: {hidden:true}` would have been orphaned and
 *    its objects would have silently reappeared. ADDING a key strands nothing.
 *    `LayerFlags` states the rule outright — "a missing key means visible +
 *    unlocked" (model/types.ts:115) — and every consumer implements exactly that,
 *    reading `layers?.[category]?.hidden` / `?.locked` and nothing else
 *    (state/selectors.ts:57,61 · layout/collision.ts:270 · prompts/refs.ts:97).
 *    So an absent key is ALREADY the state a category nobody has touched should be
 *    in. Seeding `{}` entries would not just be redundant, it would be a state the
 *    app erases: `setLayerFlag` (state/actions.ts:1801-1814) DELETES an entry once
 *    both flags are off. The failure this part exists to prevent — a new category
 *    behaving as hidden or undefined in a saved project — cannot occur in this
 *    codebase, so the honest form of "seed the new layers" is a documented no-op.
 *
 * 2. CATEGORY MOVES: none. Source doc line 75 says some existing decor moved into
 *    the new "עיצובי שולחן" group, but it names no items and the code has no
 *    category by the name it uses, so which of tableDecor's 24 entries moved is
 *    not derivable. Moving one would orphan its layer flags in every saved
 *    project, so nothing moved and nothing is remapped here. When the user marks
 *    the list (Plans/R2/handoff/BLOCKED-02-A2.md), a FOLLOW-UP migration carries
 *    the flags — this one must stay as it shipped.
 *
 * 3. NO VENUE RE-CLAMP, though the venue's zones did change. `clampToVenue` is a
 *    private function of state/actions.ts and needs the store's zone, uniqueness
 *    and pose rules plus the catalog; importing it would make persistence depend
 *    on the store — the dependency the v6→v7 `ponytail:` note refused — and
 *    re-implementing it here would be a second copy free to drift from the first.
 *    Unlike v6→v7 this is NOT provably a no-op: it is a gap. What runs instead is
 *    the real `clampToVenue`, on the object's first edit (every mutation site in
 *    actions.ts calls it), so an object nobody touches keeps a position that may
 *    now sit in a restricted zone until it is dragged.
 *
 * 4. HANG RE-CLAMP, for pack halls only. `clampHang` lives in core (no store), so
 *    this calls the same function the editor calls rather than a copy, and reads
 *    both `MAX_DROP_FROM_CEILING` and the pack live — it needs no numbers from the
 *    plans changing them. Scoped to `venuePackId` because that is exactly where
 *    the risk is: `hangRange`'s inputs are the object's own height and
 *    `venue.wallHeight` (both stored IN the file, which no migration rewrites),
 *    `MAX_DROP_FROM_CEILING` (which only ever lowers the floor of the range, so it
 *    cannot make a legal elevation illegal), and `pack.hangHeight` — the one input
 *    that lives outside the file and can move under it when the hall is
 *    re-measured. A procedural room has no pack and therefore no such input, so
 *    clamping there could only rewrite values the app never wrote.
 *
 * 5. `stackedOn` joins the zod attachment schema (see its comment below). That is
 *    a schema fix, not a data fix: no stored file needs touching, because the
 *    field was being stripped on the way IN and every file that ever had one
 *    lost it long ago. Napkins saved from here on keep their host.
 *
 * The ceiling ids are frozen like v5's, and the set is complete by construction:
 * a v8 file can only hold catalog ids that existed at v8. It is a separate copy
 * of the same five on purpose — a later edit to either list must not silently
 * change the other migration's behaviour.
 */
const CEILING_CATALOG_IDS_V9 = new Set([
  'lamp.pendant',
  'lamp.pendant-cluster',
  'lamp.chandelier-diamond',
  'lamp.chandelier-basket',
  'lamp.chandelier-candelabra',
])

function addCategoriesAndReclampHang(raw: unknown): unknown {
  const file = raw as {
    project?: {
      scene?: {
        venue?: { venuePackId?: string | null; wallHeight?: number }
        objects?: Record<string, { catalogId?: string; transform?: { elevation?: number }; size?: { height?: number } }>
      }
    }
  }
  const scene = file?.project?.scene
  const venue = scene?.venue
  if (venue?.venuePackId && typeof venue.wallHeight === 'number' && scene?.objects) {
    const pack = getVenuePack(venue.venuePackId)
    for (const obj of Object.values(scene.objects)) {
      if (!obj.catalogId || !CEILING_CATALOG_IDS_V9.has(obj.catalogId)) continue
      if (typeof obj.transform?.elevation !== 'number' || typeof obj.size?.height !== 'number') continue
      obj.transform.elevation = clampHang(pack, venue.wallHeight, obj.size.height, obj.transform.elevation)
    }
  }
  return { ...(raw as object), schemaVersion: 9, project: { ...file.project, schemaVersion: 9 } }
}

/**
 * v9 → v10: `bar.straight` is retired, and `dj.booth` changed model.
 *
 * ‼ WHY THIS MIGRATION MUST BE EXHAUSTIVE. `getCatalogEntry` THROWS on an unknown
 * id (catalog/registry.ts:29-33) and the zod schema below validates `catalogId` as
 * a plain string, so a leftover `bar.straight` passes validation and then throws
 * the first time anything reads the object — the 3D pane, the seat reconciler, a
 * selector. That is a project the user cannot open. The sweep below therefore
 * walks the whole `objects` map rather than `objectOrder`, so an object that is
 * somehow parented or missing from the order is still caught.
 *
 * 1. `bar.straight` WAS the resort bar: its own promptFragment called it "a 5.8m
 *    double bar counter with a full-height bottle display wall behind it". It is
 *    now three separately placeable pieces, and a resort project gets them at the
 *    positions the bake produced. Those absolute positions are the honest answer
 *    rather than an offset measured off the old object, because `bar.straight`
 *    carries `zoneKind: 'bar'` and the clamp has always pinned it inside ZONE_BAR
 *    — in a PACK hall it could never be anywhere else.
 *
 *    ⚠ That reasoning holds ONLY for a pack hall. `zoneKind` binds an object to a
 *    zone the venue declares, and a procedural room declares none, so the clamp
 *    never ran there (state/actions.ts:350 filters `zones` and does nothing when
 *    the list is empty; catalog/types.ts:190-193 says as much). A `bar.straight`
 *    in a manual-dimensions room really can sit anywhere. It is DROPPED there
 *    rather than converted, and not because converting is hard: the piece only
 *    ever existed as the resort's own bar, the replacements are frozen fittings OF
 *    that hall, and seeding three immovable resort fittings into a room that is
 *    not the resort would be wrong in a way no position could fix. The old
 *    footprint does not map onto the new one either — 580×80 against an assembly
 *    that is 519.6 wide and 345.4 deep — so there is no honest anchor to use.
 *    Same treatment `stage.platform` got at v3→v4, orphan sweep included.
 *
 * 2. EVERY resort project is given the fixtures, not only one that held a bar.
 *    `venueFixtures` is read in exactly one place, `createDefaultScene`
 *    (model/factory.ts:40), which copies the fixtures INTO the scene at creation;
 *    nothing re-seeds them on load. So a project saved before the bake carries no
 *    bar at all, and would keep showing a hall with no bar while every new project
 *    has one. The bar is a fitting of the building, not event furniture, so the
 *    two must agree. Idempotent by fixture id, so converting and seeding cannot
 *    both fire and produce six objects.
 *
 * 3. `dj.booth` keeps its id and gets a new stored `size`. The entry swapped to
 *    `dj-resort.glb`, whose bounds are 309.9 × 242.9 × 183.8, and propModel scales
 *    per axis by `size / (modelSize ?? defaultSize)` — a stored 208 × 91 × 143
 *    would have drawn the new model squashed to 0.37 on depth.
 *
 * Constants are frozen copies, like v5's and v9's: a later re-bake must not reach
 * back and change what v10 meant.
 */
const BAR_STRAIGHT_V10 = 'bar.straight'
const DJ_BOOTH_V10 = 'dj.booth'
const DJ_BOOTH_SIZE_V10 = { width: 309.9, depth: 242.9, height: 183.8 }

/** The bake of 2026-07-28, copied verbatim out of core/venueFixtures.ts. */
const RESORT_BAR_FIXTURES_V10 = [
  {
    id: 'fixture-resort-001',
    catalogId: 'bar.back-wall',
    name: 'קיר מאחורי הבר',
    transform: { position: { x: 2189, y: 42.95 }, rotation: 180, elevation: 0 },
    size: { width: 188.9, depth: 85.9, height: 240 },
    parentId: null,
    appearance: {},
    flags: { locked: true, visible: true, frozen: true },
    meta: { fixture: true },
  },
  {
    id: 'fixture-resort-002',
    catalogId: 'bar.resort-left',
    name: 'בר ריזורט שמאל',
    transform: { position: { x: 2059.1, y: 275.65 }, rotation: 180, elevation: 0 },
    size: { width: 259.8, depth: 139.5, height: 157 },
    parentId: null,
    appearance: {},
    flags: { locked: true, visible: true, frozen: true },
    meta: { fixture: true },
  },
  {
    id: 'fixture-resort-003',
    catalogId: 'bar.resort-right',
    name: 'בר ריזורט ימין',
    transform: { position: { x: 2318.9, y: 275.65 }, rotation: 180, elevation: 0 },
    size: { width: 259.8, depth: 139.5, height: 157 },
    parentId: null,
    appearance: {},
    flags: { locked: true, visible: true, frozen: true },
    meta: { fixture: true },
  },
]

function retireBarStraight(raw: unknown): unknown {
  const file = raw as {
    project?: {
      scene?: {
        venue?: { venuePackId?: string | null }
        objects?: Record<string, { catalogId?: string; parentId?: string | null; size?: unknown }>
        objectOrder?: string[]
      }
    }
  }
  const scene = file?.project?.scene
  const objects = scene?.objects
  if (objects) {
    for (const obj of Object.values(objects)) {
      if (obj.catalogId === DJ_BOOTH_V10) obj.size = { ...DJ_BOOTH_SIZE_V10 }
    }

    // the whole map, not objectOrder — see the header note on exhaustiveness
    for (const [id, obj] of Object.entries(objects)) {
      if (obj.catalogId === BAR_STRAIGHT_V10) delete objects[id]
    }
    // orphan sweep to fixpoint, as v3→v4 does: nothing attaches to a bar today,
    // but a child left pointing at a deleted parent is silent corruption
    let changed = true
    while (changed) {
      changed = false
      for (const [id, obj] of Object.entries(objects)) {
        if (obj.parentId && !(obj.parentId in objects)) {
          delete objects[id]
          changed = true
        }
      }
    }
    if (Array.isArray(scene.objectOrder)) {
      scene.objectOrder = scene.objectOrder.filter((id) => id in objects)
    }

    if (scene.venue?.venuePackId === 'resort') {
      // `unshift` rather than push: createDefaultScene seeds fixtures first, and a
      // migrated project should draw in the same order as a fresh one.
      const added: string[] = []
      for (const fixture of RESORT_BAR_FIXTURES_V10) {
        if (fixture.id in objects) continue
        objects[fixture.id] = structuredClone(fixture)
        added.push(fixture.id)
      }
      if (added.length) scene.objectOrder = [...added, ...(scene.objectOrder ?? [])]
    }
  }
  return { ...(raw as object), schemaVersion: 10, project: { ...file.project, schemaVersion: 10 } }
}

/**
 * v10 → v11: the DJ booth is catalogued at 0.7 of the model's own size.
 *
 * The user asked for the stand to be shrunk (round-3 correction §1), so
 * `dj.booth` now states 216.9 × 170 × 128.7 where v10 stated the GLB's full
 * bounds of 309.9 × 242.9 × 183.8. The entry gained a `modelSize` in the same
 * edit, which is what makes the loader draw the model at 0.7 rather than at 1.
 *
 * A stored object keeps the size it was saved with — nothing re-reads
 * `defaultSize` for an object that already exists — so without this a project
 * saved yesterday would go on showing a full-size booth beside a library that
 * places small ones, and the two would disagree about the same physical stand.
 * Same shape of fix as v9→v10's third clause, and for the same reason.
 *
 * What it does NOT do:
 *
 * 1. NO RE-CLAMP, and none is owed. The booth only ever lives inside ZONE_DJ
 *    (`zoneKind: 'dj'`), the object only ever SHRINKS, and a smaller box inside
 *    a rectangle it already fitted still fits it. The centre does not move, so
 *    the stand stays where the user left it and simply occupies less of its
 *    zone. In a procedural room there is no zone to satisfy at all.
 *
 * 2. NO ROTATION REWRITE. `clampToVenue` snaps a station to a quarter turn only
 *    when its AABB is wider or deeper than its home zone (state/actions.ts:404).
 *    At 309.9 × 242.9 against a 310 × 243 zone that branch sat one millimetre
 *    from firing; at 216.9 × 170 it cannot fire at all. Nothing to migrate —
 *    the note is here so the next reader does not go looking for it.
 *
 * The constants are frozen copies, like v5's, v9's and v10's: a later re-scale
 * must not reach back and change what v11 meant. In particular this file must
 * NOT import the catalogue — no migration does. A migration states what the
 * world looked like at one moment in the past, and reading a live value would
 * make every old file land wherever the catalogue happens to be today.
 */
const DJ_BOOTH_V11 = 'dj.booth'
const DJ_BOOTH_SIZE_V11 = { width: 216.9, depth: 170, height: 128.7 }

function shrinkDjBooth(raw: unknown): unknown {
  const file = raw as {
    project?: { scene?: { objects?: Record<string, { catalogId?: string; size?: unknown }> } }
  }
  const objects = file?.project?.scene?.objects
  if (objects) {
    // the whole map, not objectOrder — same exhaustiveness note v9→v10 carries
    for (const obj of Object.values(objects)) {
      if (obj.catalogId === DJ_BOOTH_V11) obj.size = { ...DJ_BOOTH_SIZE_V11 }
    }
  }
  return { ...(raw as object), schemaVersion: 11, project: { ...file.project, schemaVersion: 11 } }
}

/**
 * v11 → v12: the rolled napkin is catalogued at 0.62 of the model's own size.
 *
 * `decor.napkin-folded` used to state the GLB's own bounds, 12.2 × 30.78 × 10,
 * and a 30.8 cm napkin does not fit the ⌀23 cm plate it is laid on — it hung 8-11
 * cm off the cover, which is the "the napkins are not laid on the plate" report
 * (round-3 correction §13). The entry now states a uniform 0.62 of the file and
 * gained a `modelSize` in the same edit, which is what makes the loader draw it
 * small rather than at 1.
 *
 * A stored object keeps the size it was saved with — nothing re-reads
 * `defaultSize` for an object that already exists — so without this every napkin
 * in every saved project would stay giant for ever, beside a library that lays
 * small ones. The same shape of fix as v10→v11, for the same reason.
 *
 * What it does NOT do:
 *
 * 1. NO RE-POSITION, and none is owed. Where a napkin sits is not stored data the
 *    user owns: it is DERIVED from its host every time the surface clamp runs
 *    (`stackedPosition`, state/actions.ts), so the first edit after the upgrade
 *    re-pins every napkin onto its plate. Writing a position here would be a
 *    second copy of that rule, free to drift from the first, and it would need
 *    the host's rotation — i.e. it would make persistence depend on the store,
 *    the dependency v6→v7 and v8→v9 both refused.
 * 2. NO ROTATION REWRITE. A napkin may now carry a rotation of its own, and a
 *    stored one carries the host's rotation, which is exactly what a fresh lay
 *    still produces. There is no old value to correct.
 * 3. NOTHING FOR THE OTHER TWO NAPKINS. `decor.fabric-folded` (6 × 10.8) and
 *    `decor.napkin-white` (8.6 × 5.4) both fit the plate at their catalogued
 *    sizes and did not change, so a stored one is already right.
 *
 * The constants are frozen copies, like v5's, v9's, v10's and v11's: this file
 * must NOT import the catalogue. A later re-measure of the napkin must not reach
 * back and change what v12 meant.
 */
const NAPKIN_V12 = 'decor.napkin-folded'
const NAPKIN_SIZE_V12 = { width: 7.56, depth: 19.08, height: 6.2 }

function shrinkRolledNapkin(raw: unknown): unknown {
  const file = raw as {
    project?: { scene?: { objects?: Record<string, { catalogId?: string; size?: unknown }> } }
  }
  const objects = file?.project?.scene?.objects
  if (objects) {
    // the whole map, not objectOrder — same exhaustiveness note v9→v10 carries,
    // and a napkin is a CHILD, so it never appears in objectOrder at all
    for (const obj of Object.values(objects)) {
      if (obj.catalogId === NAPKIN_V12) obj.size = { ...NAPKIN_SIZE_V12 }
    }
  }
  return { ...(raw as object), schemaVersion: 12, project: { ...file.project, schemaVersion: 12 } }
}

/**
 * v12 → v13: the `ringCenter` layer key dies, and the last two placeholder
 * entries become real models. Three jobs, one function, because they are one
 * catalogue edit.
 *
 * 1. DELETE `settings.layers.ringCenter`. ⚠ IT IS NOT MERGED INTO
 *    `layers.tables`, AND THAT IS THE WHOLE POINT OF THE CLAUSE. The v5→v6
 *    rename above (:154-182) CARRIES flags across a category rename, and copying
 *    that here would be the bug: `ringCenter` held at most two centrepieces, and
 *    a user who once hid them would open v13 to find EVERY TABLE IN THE HALL
 *    gone, with no way to connect the two. So `layers.tables` is left exactly as
 *    stored and the dead key is dropped.
 *
 *    Strictly the delete is optional — `layers` is a `z.record` (:721-726), so an
 *    unknown key survives validation and is simply never read. It is done anyway
 *    so the file stops carrying a key no code can resolve; the v6 rename deletes
 *    its source key for the same reason.
 *
 * 2 & 3. `buffet.table` and `divider.screen` take their measured sizes. Both were
 *    procedural placeholders with invented dimensions (240 × 76 × 90 and
 *    180 × 6 × 180) until the user supplied a GLB and a photo for each; the
 *    catalogue now states the bounds glb-prep printed. A stored object keeps the
 *    size it was saved with — nothing re-reads `defaultSize` for an object that
 *    already exists — so without this the 3D loader would fit the new model to
 *    the old placeholder box: `size / (modelSize ?? defaultSize)` is per-axis, so
 *    the divider in particular would be squashed to 6 cm deep and the buffet
 *    stretched to 240 wide. Exactly the shape of v10→v11's `shrinkDjBooth`.
 *
 * What it does NOT do:
 *
 *  - NO OBJECT REWRITE FOR `ring.table` / `ring.floral`. Their catalog ids did not
 *    change, and an object stores a `catalogId`, never a category — the category
 *    is looked up from the catalogue on every read. There is nothing about the
 *    fold that is visible in a saved file.
 *  - NO RE-CLAMP. The buffet grows 24 cm deep and the divider 26 cm; both are
 *    ordinary floor objects with no home zone, and `clampToVenue` runs on the
 *    first edit after the load anyway. Writing one here would make persistence
 *    depend on the store, the dependency v6→v7 and v8→v9 both refused.
 *
 * The constants are frozen copies, like v5's, v9's, v10's, v11's and v12's: this
 * file must NOT import the catalogue. A later re-measure must not reach back and
 * change what v13 meant.
 */
const RING_CENTER_LAYER_V13 = 'ringCenter'
const BUFFET_V13 = 'buffet.table'
const BUFFET_SIZE_V13 = { width: 180.5, depth: 83.1, height: 185 }
const DIVIDER_V13 = 'divider.screen'
const DIVIDER_SIZE_V13 = { width: 155.9, depth: 31.9, height: 180 }

function realBuffetAndDivider(raw: unknown): unknown {
  const file = raw as {
    project?: {
      scene?: {
        objects?: Record<string, { catalogId?: string; size?: unknown }>
        settings?: { layers?: Record<string, unknown> }
      }
    }
  }
  const scene = file?.project?.scene
  const layers = scene?.settings?.layers
  if (layers) delete layers[RING_CENTER_LAYER_V13]

  const objects = scene?.objects
  if (objects) {
    // the whole map, not objectOrder — same exhaustiveness note v9→v10 carries.
    // A divider or a buffet is a top-level object today, but a migration that
    // walks the order silently skips anything that ever becomes a child.
    for (const obj of Object.values(objects)) {
      if (obj.catalogId === BUFFET_V13) obj.size = { ...BUFFET_SIZE_V13 }
      else if (obj.catalogId === DIVIDER_V13) obj.size = { ...DIVIDER_SIZE_V13 }
    }
  }
  return { ...(raw as object), schemaVersion: 13, project: { ...file.project, schemaVersion: 13 } }
}

/**
 * Keyed by the SOURCE version each function upgrades FROM. `migrations[0]`
 * turns a v0 file into a v1 file (and must set `schemaVersion` to 1).
 */
export const migrations: Record<number, (raw: unknown) => unknown> = {
  1: remapCatalogIds,
  2: bumpToV3,
  3: dropStagingAndAddLayers,
  4: repinCeilingToTruss,
  5: renameCategoryLayers,
  6: widenResortVenue,
  7: splitLayoutTags,
  8: addCategoriesAndReclampHang,
  9: retireBarStraight,
  10: shrinkDjBooth,
  11: shrinkRolledNapkin,
  12: realBuffetAndDivider,
}

function schemaVersionOf(raw: unknown): number {
  if (raw && typeof raw === 'object' && 'schemaVersion' in raw) {
    const v = (raw as { schemaVersion: unknown }).schemaVersion
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return 0
}

/**
 * Pure, testable migration runner: applies migrations from the file's current
 * version up towards `target`, stopping when no migration is registered for the
 * current version. Each migration MUST advance the version or we throw rather
 * than loop forever.
 */
export function runMigrations(
  raw: unknown,
  registry: Record<number, (raw: unknown) => unknown> = migrations,
  target: number = SCHEMA_VERSION,
): unknown {
  let current = raw
  let version = schemaVersionOf(current)
  while (version < target) {
    const migrate = registry[version]
    if (!migrate) break
    const next = migrate(current)
    const nextVersion = schemaVersionOf(next)
    if (nextVersion <= version) {
      throw new Error(`Migration from schema v${version} did not advance the version`)
    }
    current = next
    version = nextVersion
  }
  return current
}

// --- zod schema (mirrors src/core/model/types.ts) --------------------------

const vec2 = z.object({ x: z.number(), y: z.number() })

const size3d = z.object({
  width: z.number(),
  depth: z.number(),
  height: z.number(),
})

const transform2d = z.object({
  position: vec2,
  rotation: z.number(),
  elevation: z.number(),
  /**
   * ROUND 4 / AGENT A3 — the mirror flag on an object's pose.
   *
   * Listed here BEFORE the feature that writes it, and deliberately: a plain
   * `z.object` STRIPS an undeclared key on every load (see the `stackedOn` note
   * on `attachment` below, which cost a whole round). Adding it with the feature
   * is one commit too late — the field would work in the session it was set and
   * come back gone from the next load, with nothing failing anywhere.
   *
   * Optional, so every file written before A3's work still parses.
   */
  mirrored: z.boolean().optional(),
})

const attachment = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('seat'),
    seatIndex: z.number(),
    manual: z.boolean(),
  }),
  // `surface` carries TWO modifiers (model/types.ts:40-64), and a zod object is
  // non-strict: an undeclared key is STRIPPED, not rejected. `stackedOn` was
  // missing here until v9, so every napkin came back from every load without its
  // host — orphaned on the bare cloth, and invisible to `deleteWithStack`
  // (actions.ts:661-669), which finds riders by that very field. Both modifiers
  // must be listed or the schema silently rewrites the scene it validates.
  z.object({
    kind: z.literal('surface'),
    inHole: z.boolean().optional(),
    stackedOn: z.string().optional(),
  }),
])

/**
 * ROUND 4 / AGENT A2 — `textureId` joins `color` on a material slot.
 *
 * Same reason as `mirrored` on `transform2d` above, and the same trap: the
 * per-slot value is a plain `z.object`, so a slot's chosen texture would be
 * stripped on every load and the item would come back untextured with no error.
 * `nullable` as well as `optional` because "explicitly no texture" and "never
 * chose one" are different states — the first is what clearing a texture writes.
 */
const appearance = z.record(
  z.object({ color: z.string().optional(), textureId: z.string().nullable().optional() }),
)

const seatingConfig = z.object({
  enabled: z.boolean(),
  chairCatalogId: z.string(),
  count: z.number(),
  gap: z.number(),
  offset: z.number(),
  startAngle: z.number(),
})

// meta values are validated loosely — arbitrary primitive tags are allowed.
const meta = z.record(z.union([z.string(), z.number(), z.boolean()]))

const sceneObject = z.object({
  id: z.string(),
  catalogId: z.string(),
  name: z.string(),
  transform: transform2d,
  size: size3d,
  parentId: z.string().nullable(),
  attachment: attachment.optional(),
  appearance,
  seating: seatingConfig.optional(),
  // v8 `frozen` marks a baked venue fixture; optional so pre-v8 files parse.
  flags: z.object({ locked: z.boolean(), visible: z.boolean(), frozen: z.boolean().optional() }),
  meta,
})

const venue = z.object({
  size: z.object({ width: z.number(), depth: z.number() }),
  wallHeight: z.number(),
  floor: z.object({ color: z.string() }),
  elements: z.array(z.never()),
  // optional — old projects have none (procedural room). nullish so it survives load.
  venuePackId: z.string().nullish(),
})

const layerFlags = z.object({ hidden: z.boolean().optional(), locked: z.boolean().optional() })

const sceneSettings = z.object({
  gridSize: z.number(),
  snapEnabled: z.boolean(),
  showGrid: z.boolean(),
  showLabels: z.boolean(),
  // v4 category layers. String-keyed on purpose: a stale category key (e.g. a
  // removed 'staging', or 'structure' from before the v6 rename) must never
  // brick a load — which is also why the v6 category rename needs no change
  // here. Optional so pre-v4 files parse; the v4 migration + factory
  // materialize {}.
  layers: z.record(layerFlags).optional(),
  // v5 outdoor lighting. Optional so pre-v5 files parse; lightingOf() defaults.
  lighting: z
    .object({
      mode: z.enum(['day', 'sunset', 'night']),
      sunAzimuth: z.number(),
      sunElevation: z.number(),
      sunIntensity: z.number(),
      // Needs no schema bump — it is optional, so old files parse and new files
      // load anywhere. It DOES need to be listed: this is a plain z.object, so
      // an unlisted key is stripped on every load and the setting would appear
      // to reset itself (the same trap that eats `stackedOn`, :319).
      shadowSharpness: z.enum(['soft', 'medium', 'sharp']).optional(),
    })
    .optional(),
})

const sceneState = z.object({
  venue,
  objects: z.record(sceneObject),
  objectOrder: z.array(z.string()),
  settings: sceneSettings,
})

const project = z.object({
  id: z.string(),
  schemaVersion: z.number(),
  name: z.string(),
  eventName: z.string().optional(),
  eventDate: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  scene: sceneState,
})

export const projectFileSchema = z.object({
  schemaVersion: z.number(),
  app: z.literal('hanan-app'),
  savedAt: z.string(),
  project,
})

/** Upgrade a raw stored/imported value and validate it. Throws on garbage. */
export function migrateAndValidate(raw: unknown): ProjectFile {
  const migrated = runMigrations(raw)
  return projectFileSchema.parse(migrated) as ProjectFile
}
