/**
 * The ⌀380 ring table's 156 cm opening (source doc §48), and how it meets the
 * centre rule (§28).
 *
 * Those two land on the same spot: §28 puts a centrepiece in the middle of the
 * table, and on this table the middle is a hole — so it stands on the FLOOR and
 * rises through the opening rather than floating over it. A design is exempt from
 * §28, so a design-laid item is the case that still sits on the ring at table
 * height, and the one that proves `inHole` is honoured rather than assumed.
 *
 * The invariant worth pinning: nothing changes elevation on its own. `inHole` is
 * settled by the rules, and every later clamp reaches the same answer, so no drag
 * can silently drop a piece 75 cm.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { holeRadius } from '../core/layout/bounds'
import { checkPlacement } from '../core/layout/collision'
import { useOverlayStore } from '../editor2d/overlayStore'
import { strings } from '../ui/strings'
import { addObject, addObjectToSurface, newProject, redo, setPosition, undo } from './actions'
import { useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene
const RING = 'table.round-large'
const SOLID = 'table.round'
const DECOR = 'decor.vase-ceramic'

const outlineOf = (catalogId: string) => {
  const e = getCatalogEntry(catalogId)
  return e.footprint(e.defaultSize).outline
}
const R_INNER = () => holeRadius(outlineOf(RING))
const R_OUTER = () => {
  const o = outlineOf(RING)
  return o.kind === 'circle' ? o.r : 0
}
/** how far the decor's own outline reaches from its centre */
const REACH = () => {
  const o = outlineOf(DECOR)
  return o.kind === 'circle' ? o.r : Math.max(o.w, o.h) / 2
}

const radius = (id: string) => {
  const p = scene().objects[id].transform.position
  return Math.hypot(p.x, p.y)
}

/**
 * ⚠ The two APIs take different frames: `addObjectToSurface` takes a WORLD point
 * (it derives the local one), while `setPosition` on a child writes
 * `transform.position` directly, which for an attached child is already
 * PARENT-LOCAL. Every drag below is local.
 */
const dragLocal = (id: string, x: number, y = 0) => setPosition(id, { x, y })

/**
 * Turn a child into what `layTableDesign` produces: tagged with a design id and
 * carrying a plain surface attachment. The tag is what exempts it from §28; the
 * reset matters because the hand drop that created it already resolved §28 and
 * committed it to the hole.
 */
const markAsDesign = (id: string) => {
  useEditorStore.setState((s) => {
    s.scene.objects[id].meta.design = 'test-design'
    s.scene.objects[id].attachment = { kind: 'surface' }
  })
}

beforeEach(() => {
  newProject({ name: 'ring', venuePackId: 'resort' })
})

describe('the ring table has a real opening', () => {
  it('reports an inner radius the solid table does not', () => {
    expect(R_INNER()).toBeGreaterThan(0)
    expect(holeRadius(outlineOf(SOLID))).toBe(0)
  })
})

/**
 * Source doc §26: "the circle that sits inside must cover the whole hole, there
 * must be no GAP". `ring.table` was ⌀149.7 — the raw bounds of its GLB — against a
 * ⌀156 opening, so 3 cm of floor showed all the way round. It is sized to the
 * OPENING now, and both numbers are read from the catalog here so neither can move
 * without the other (BRIEF §1.7).
 *
 * ⚠ The gap closes with no inner disc, and that is deliberate: the 2D layer draws a
 * real `Ring` with the floor showing through it (viewer2d/footprintShapes.tsx —
 * "a hole is a real hole"). Filling the hole in would have hidden a ⌀380 with
 * nothing in it. What closes the gap is the two radii being equal.
 */
describe('§26 — the ring-centre table covers the whole opening', () => {
  const RING_TABLE = 'ring.table'
  const radiusOf = (catalogId: string) => {
    const o = outlineOf(catalogId)
    return o.kind === 'circle' ? o.r : Math.max(o.w, o.h) / 2
  }

  it('is exactly as wide as the hole it fills — no floor left showing', () => {
    expect(radiusOf(RING_TABLE)).toBeCloseTo(R_INNER(), 6)
    // and the 2D shape really is a filled disc of that radius, not an annulus
    const e = getCatalogEntry(RING_TABLE)
    const parts = e.footprint(e.defaultSize).parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ kind: 'circle', r: R_INNER() })
    expect(holeRadius(outlineOf(RING_TABLE))).toBe(0)
  })

  it('stands flush with the ⌀380 it sits in', () => {
    expect(getCatalogEntry(RING_TABLE).defaultSize.height).toBe(
      getCatalogEntry(RING).defaultSize.height,
    )
  })

  /**
   * ⚠ THE SILENT TRAP (handoff/02-migration.md §6). The 3D loader fits a model by
   * `size / (modelSize ?? defaultSize)`. `ring.table` used to carry no `modelSize`,
   * so that ratio was 1 whatever the entry declared: growing `defaultSize` alone
   * would have left 3D rendering the old ⌀149.7 table inside a ⌀156 footprint —
   * the gap gone from the plan, still there in the viewport, and nothing failing.
   * This is the guard that makes deleting the field loud instead of silent.
   */
  it('states its FILE size too, so 3D grows the model instead of ignoring the change', () => {
    const { defaultSize, modelSize } = getCatalogEntry(RING_TABLE)
    if (!modelSize) throw new Error(`${RING_TABLE}: an entry sized to the hole must state its file's own size`)
    // it is genuinely a rescale — equal sizes would mean the field is decorative
    expect(modelSize.width).not.toBeCloseTo(defaultSize.width, 1)
    expect(defaultSize.width / modelSize.width).toBeGreaterThan(1)
    expect(defaultSize.height / modelSize.height).toBeLessThan(1)
  })

  /**
   * The half that was missing, and the half the user could actually see. The test
   * above is about the PLAN, where ⌀156 = ⌀156 and there was never a gap; the
   * crescent was in 3D, where the loader fits the GLB by its own bounds — and this
   * model is a DRAPED table, so its bounds are the skirt at the floor and not the
   * top a plate stands on.
   *
   * ⚠ ONE number is frozen here: 64, the radius in FILE cm out to which the top 5%
   * of the model is solid. It is a property of the file in public/props, so
   * re-prepping the GLB invalidates it — re-measure with
   *
   *   node tools/glb-prep/measure-top.mjs public/props/ring-center-table.glb 1
   *
   * (2026-07-30: 63:100% 64:98% 65:64% 66:20% 67:4% 68:0%). Everything else is
   * derived from the catalogue, so a re-sized entry moves the expectation with it.
   */
  it('fits by the TOP, so the solid disc reaches the opening instead of stopping 11 cm short', () => {
    const FILE_TOP_R = 64
    const { defaultSize, modelSize, modelTopSize } = getCatalogEntry(RING_TABLE)
    if (!modelTopSize) throw new Error(`${RING_TABLE}: a draped model must state its top's own size`)
    if (!modelSize) throw new Error(`${RING_TABLE}: expected a file size to compare against`)

    // what the loader does now — the same expression as viewer3d/propModel.ts
    for (const reach of [
      FILE_TOP_R * (defaultSize.width / modelTopSize.width),
      FILE_TOP_R * (defaultSize.depth / modelTopSize.depth),
    ]) {
      expect(reach).toBeGreaterThanOrEqual(R_INNER() - 0.01)
    }

    // and what it did before, which is the gap the user reported: the top stopped
    // well inside the opening on BOTH axes, and by different amounts — an
    // off-centre ring, which is why it read as a crescent rather than a halo
    const byBox = [
      FILE_TOP_R * (defaultSize.width / modelSize.width),
      FILE_TOP_R * (defaultSize.depth / modelSize.depth),
    ]
    for (const reach of byBox) expect(R_INNER() - reach).toBeGreaterThan(8)
    expect(Math.abs(byBox[0] - byBox[1])).toBeGreaterThan(0)

    // the height is deliberately NOT fitted by the top: a hem is a horizontal
    // overhang, and `modelSize.height` is what STACK_HEIGHTS converts through
    expect(modelTopSize).not.toHaveProperty('height')
  })

  it('drops into the well and covers it there too', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const child = addObjectToSurface(RING_TABLE, table, { x: 1000, y: 700 })!
    const obj = scene().objects[child]
    // centred in the opening, standing on the floor through it
    expect(obj.transform.position).toEqual({ x: 0, y: 0 })
    expect(obj.transform.elevation).toBe(0)
    // and the placed instance is still hole-wide, so the gap cannot come back via
    // a resize the inspector allowed
    expect(Math.max(obj.size.width, obj.size.depth) / 2).toBeGreaterThanOrEqual(R_INNER())
  })
})

/**
 * Round 4 §9 — dropping the floral on a BARE ⌀380 lays the inner table under it,
 * in the same gesture.
 *
 * `requiresHost` is untouched and stays load-bearing three times over (the
 * sibling-overlap skip, the `stackedOn` link, `surfaceBase`'s 75 instead of 0).
 * `autoHost` changes one thing: a missing host is no longer a refusal.
 */
describe('§9 — the floral lays its own table', () => {
  const RING_TABLE = 'ring.table'
  const FLORAL = 'ring.floral'

  const childrenOnTop = (tableId: string) =>
    Object.values(scene().objects).filter(
      (o) => o.parentId === tableId && o.attachment?.kind === 'surface',
    )
  const ofKind = (tableId: string, catalogId: string) =>
    childrenOnTop(tableId).filter((o) => o.catalogId === catalogId)

  it('lays the inner table under a floral dropped on a bare ⌀380', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    expect(childrenOnTop(table)).toHaveLength(0)

    const floral = addObjectToSurface(FLORAL, table, { x: 1000, y: 700 })!
    expect(ofKind(table, RING_TABLE)).toHaveLength(1)
    expect(ofKind(table, FLORAL).map((o) => o.id)).toEqual([floral])

    // the host went where `clampToSurface` puts it — the middle of the table,
    // through the opening, standing on the floor
    const bed = ofKind(table, RING_TABLE)[0]
    expect(bed.transform.position).toEqual({ x: 0, y: 0 })
    expect(bed.transform.elevation).toBe(0)
    expect(bed.attachment).toEqual({ kind: 'surface', inHole: true })
  })

  /** §46b: the urn stands ON the small table, not on the floor beside it. */
  it('links them, so the urn stands at table height and not at 0', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const floral = addObjectToSurface(FLORAL, table, { x: 1000, y: 700 })!
    const bed = ofKind(table, RING_TABLE)[0]

    const urn = scene().objects[floral]
    if (urn.attachment?.kind !== 'surface') throw new Error('expected a surface child')
    expect(urn.attachment.stackedOn).toBe(bed.id)
    expect(urn.transform.elevation).toBe(bed.size.height)
    expect(urn.transform.elevation).toBeGreaterThan(0)
  })

  it('is ONE gesture — a single undo removes both', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    addObjectToSurface(FLORAL, table, { x: 1000, y: 700 })
    expect(childrenOnTop(table)).toHaveLength(2)
    undo()
    expect(childrenOnTop(table)).toHaveLength(0)
    redo()
    expect(childrenOnTop(table)).toHaveLength(2)
  })

  it('adds nothing when the inner table is already there', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const bed = addObjectToSurface(RING_TABLE, table, { x: 1000, y: 700 })!
    addObjectToSurface(FLORAL, table, { x: 1000, y: 700 })
    expect(ofKind(table, RING_TABLE).map((o) => o.id)).toEqual([bed])
    expect(childrenOnTop(table)).toHaveLength(2)
  })

  /**
   * Half a gesture is worse than none. When the host cannot go down, NOTHING goes
   * down — and the status bar names the real obstacle rather than the urn.
   */
  it('lays nothing when the well is occupied, and says why', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    // a centre-anchored piece hand-dropped on this table lands IN the well (§28+§48)
    const squatter = addObjectToSurface(DECOR, table, { x: 1000, y: 700 })!
    expect(scene().objects[squatter].attachment).toEqual({ kind: 'surface', inHole: true })

    useOverlayStore.setState({ violation: null })
    expect(addObjectToSurface(FLORAL, table, { x: 1000, y: 700 })).toBeNull()
    expect(ofKind(table, RING_TABLE)).toHaveLength(0)
    expect(ofKind(table, FLORAL)).toHaveLength(0)
    expect(useOverlayStore.getState().violation).toMatchObject({
      kind: 'overlapsSibling',
      id: squatter,
    })
  })

  /**
   * The exemption is tied to there being a well. A solid top gets the old refusal
   * — now naming the inner table, which is what the message was always about.
   */
  it('still refuses on a table with no opening, naming the inner table', () => {
    const table = addObject(SOLID, { x: 1000, y: 700 })
    expect(holeRadius(outlineOf(SOLID))).toBe(0)
    const v = checkPlacement(scene(), {
      catalogId: FLORAL,
      transform: { position: { x: 1000, y: 700 }, rotation: 0, elevation: 0 },
      size: getCatalogEntry(FLORAL).defaultSize,
      parentId: table,
    })
    expect(v).toEqual([{ kind: 'missingHost', requires: RING_TABLE }])
    expect(strings.status.violation.missingHost(strings.catalog.items.ringTable)).toBe(
      'יש להניח שולחן פנימי קודם',
    )
  })

  /**
   * The message the napkins get must not have moved. It was hard-coded to the
   * place setting and is now resolved from the violation's own `requires`, so this
   * is the byte-for-byte check that the change is invisible where it should be.
   */
  it('renders the napkin refusal exactly as it did before', () => {
    expect(strings.status.violation.missingHost(strings.catalog.items.decorPlaceSetting)).toBe(
      'יש להניח ערכת סכו״ם קודם',
    )
  })
})

describe('a hand-placed centrepiece', () => {
  it('stands on the floor through the opening of a ring table', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    // dropped well off-centre, on the ring
    const child = addObjectToSurface(DECOR, table, { x: 1000 + R_OUTER() - REACH() - 1, y: 700 })!
    const obj = scene().objects[child]
    // §28 pulls it to the middle, and the middle of THIS table is the hole
    expect(obj.transform.position).toEqual({ x: 0, y: 0 })
    expect(obj.attachment).toEqual({ kind: 'surface', inHole: true })
    expect(obj.transform.elevation).toBe(0)
  })

  it('sits on the top of a solid table, not on the floor', () => {
    const table = addObject(SOLID, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1060, y: 700 })!
    const obj = scene().objects[child]
    expect(obj.transform.position).toEqual({ x: 0, y: 0 })
    expect(obj.attachment).toEqual({ kind: 'surface' })
    expect(obj.transform.elevation).toBe(scene().objects[table].size.height)
  })

  it('cannot be dragged out of the middle', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1000, y: 700 })!
    for (const x of [40, 120, R_OUTER(), 900]) {
      dragLocal(child, x)
      expect(radius(child)).toBe(0)
      expect(scene().objects[child].transform.elevation).toBe(0)
    }
  })
})

describe('a design-laid item is exempt, and then the hole rules apply', () => {
  it('keeps a ring item on the top and clear of the opening', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1000 + R_OUTER() - REACH() - 1, y: 700 })!
    markAsDesign(child)
    const top = scene().objects[table].size.height

    // aim straight through the middle to the far side — it never enters the hole
    for (const x of [R_OUTER(), 100, 40, 0, -40, -100, -R_OUTER()]) {
      dragLocal(child, x)
      const o = scene().objects[child]
      expect(o.transform.elevation).toBe(top)
      expect(radius(child)).toBeGreaterThanOrEqual(R_INNER() + REACH() - 0.01)
      expect(radius(child)).toBeLessThanOrEqual(R_OUTER() - REACH() + 0.01)
    }
  })

  it('keeps a hole item in the hole all the way out to the edge', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1000, y: 700 }, true)!
    // design-laid THROUGH the opening: the tag lifts §28, `inHole` still holds
    useEditorStore.setState((s) => {
      s.scene.objects[child].meta.design = 'test-design'
      s.scene.objects[child].attachment = { kind: 'surface', inHole: true }
    })
    const maxR = Math.max(0, R_INNER() - REACH())
    for (const x of [40, 120, R_OUTER(), 400]) {
      dragLocal(child, x)
      expect(scene().objects[child].transform.elevation).toBe(0)
      expect(radius(child)).toBeLessThanOrEqual(maxR + 0.01)
    }
  })

  it('clamps only at the outer edge on a solid table', () => {
    const table = addObject(SOLID, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1000, y: 700 })!
    markAsDesign(child)
    const o = outlineOf(SOLID)
    const r = o.kind === 'circle' ? o.r : 0

    dragLocal(child, 0)
    expect(radius(child)).toBe(0) // dead centre is legal on a solid top

    dragLocal(child, 900)
    expect(radius(child)).toBeCloseTo(r - REACH(), 2)
    expect(scene().objects[child].transform.elevation).toBe(
      scene().objects[table].size.height,
    )
  })
})
