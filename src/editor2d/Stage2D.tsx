import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Stage } from 'react-konva'
import { getCatalogEntry } from '../core/catalog/registry'
import { isFloorTable, type CatalogEntry } from '../core/catalog/types'
import { aabbIntersects, aabbUnion, pointInHole, pointInOutline, type AABB } from '../core/layout/bounds'
import { checkPlacement } from '../core/layout/collision'
import { snapValue } from '../core/layout/snapping'
import type { Id, Vec2 } from '../core/model/types'
import {
  addObject,
  addObjectToSurface,
  addTablePreset,
  addSeatItemsToTable,
  clearSelection,
  duplicateObjects,
  removeObjects,
  reorder,
  mirrorCopyObjects,
  mirrorObjects,
  rotateObjectsBy,
  select,
  setLocked,
} from '../state/actions'
import {
  designEditTable,
  hasUserObjects,
  isEffectivelyLocked,
  isObjectVisible,
  objectAABB,
  subtreeAABB,
  visibleTopLevelIds,
} from '../state/selectors'
import { useEditorStore } from '../state/store'
import { useElementSize } from '../lib/useElementSize'
import { ContextMenu, type MenuEntry } from '../ui/ContextMenu'
import { strings } from '../ui/strings'
import { BeamLayer } from './BeamLayer'
import { clipboardHasContent, copySelection, cutSelection, pasteClipboard } from './clipboard'
import { cursorFor } from './cursor'
import { CATALOG_MIME, catalogIdFromDrop } from './dropPayload'
import { GridLayer } from './GridLayer'
import { displayName } from './ObjectNode'
import { ObjectsLayer } from './ObjectsLayer'
import { overlay, useOverlayStore } from './overlayStore'
import { OverlayLayer } from './OverlayLayer'
import { SelectionTransformer } from './SelectionTransformer'
import { useEditorShortcuts, type ZoomApi } from './useEditorShortcuts'
import { clampZoom, useViewportStore, ZOOM_100 } from './viewportStore'
import { VenueLayer } from './VenueLayer'
import { cachedVenueCut } from '../core/venueCut'
import { getVenuePack } from '../core/venuePacks'
import { registerCapture } from './captureBus'
import { registerZoomApi } from './zoomBus'

/** cm of paper the PNG export keeps around whatever it framed. */
const SHEET_MARGIN = 120

interface MenuState {
  x: number
  y: number
  world: Vec2
  targetId: Id | null
}

/**
 * The canvas cursor, written straight onto the container's style.
 *
 * It renders NOTHING, and that is the whole reason it exists. `cursorFor` needs
 * five overlay fields, two of which — the hover and the pan flag — change while
 * the pointer is simply crossing the plan; subscribing to them in `Stage2D` would
 * re-render the stage, all six layers and every one of the ~350 `ObjectNode`s each
 * time. Here the churn stops at a component with no output.
 *
 * Konva's Transformer sets its own rotation-aware per-anchor cursors on
 * `stage.content`, a CHILD of this element — the two compose, the anchor wins
 * where it applies, and nothing here has to fight it.
 */
function CanvasCursor({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const panMode = useOverlayStore((s) => s.spacePan || s.handTool)
  const panning = useOverlayStore((s) => s.panning)
  const placing = useOverlayStore((s) => s.placing !== null)
  // a BOOLEAN, not the ghost object: the ghost is rewritten on every mouse move
  // while an item is armed, and this only cares when validity flips
  const ghostValid = useOverlayStore((s) => s.ghost?.valid === true)
  const hovering = useOverlayStore((s) => s.hoveredId !== null)
  const cursor = cursorFor({ panMode, panning, placing, ghostValid, hovering })
  useEffect(() => {
    const el = target.current
    if (el) el.style.cursor = cursor
  }, [cursor, target])
  return null
}

/**
 * The top-centre chip slot. One shell, so a second tenant cannot arrive with a
 * second look — the placing chip added this round is the same pill in the same
 * place as the drill breadcrumb that was already there.
 */
function Chip({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
      <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-[13px] shadow-sm">
        {children}
      </div>
    </div>
  )
}

/**
 * Whatever the slot has to say, at most one thing at a time.
 *
 * PRECEDENCE: design-edit > drill > placing. Design-edit brings its own chip and
 * its own Esc, so anything here would be a second of each — one saying "back to
 * the table" and one "leave the mode" — and they contradict each other. A drill is
 * a place you are IN; an armed item is a thing about to happen, and the ghost is
 * already saying so on the canvas, so it yields.
 *
 * Without the placing tenant, arming an item is completely silent apart from the
 * tile's tint eighty centimetres away in the library: the ghost only appears once
 * the pointer is over the canvas, so from the moment of the click until the mouse
 * moves there is nothing at all to say a mode was entered or how to leave it.
 */
function StageChips({ dropActive }: { dropActive: boolean }) {
  const tableName = useEditorStore((s) => {
    if (s.selection.length !== 1) return null
    const child = s.scene.objects[s.selection[0]]
    if (!child?.parentId) return null
    const parent = s.scene.objects[child.parentId]
    return parent ? displayName(parent.name, parent.catalogId, parent.meta.number) : null
  })
  const childLabel = useEditorStore((s) => {
    if (s.selection.length !== 1) return null
    const child = s.scene.objects[s.selection[0]]
    if (!child?.parentId) return null
    return child.attachment?.kind === 'surface'
      ? displayName(child.name, child.catalogId, undefined)
      : strings.drill.chair
  })
  // The id the ✕ selects back to. The two selectors above compute the parent
  // OBJECT and throw the id away; this returns a PRIMITIVE (string | null), like
  // its neighbours, so there is no useShallow trap.
  const parentId = useEditorStore((s) => {
    if (s.selection.length !== 1) return null
    return s.scene.objects[s.selection[0]]?.parentId ?? null
  })
  const inDesignEdit = useEditorStore((s) => designEditTable(s.scene, s.designEditTableId) !== null)
  const placing = useOverlayStore((s) => s.placing)

  if (inDesignEdit) return null
  if (tableName) {
    return (
      <Chip>
        <span className="font-semibold">{tableName}</span>
        <span className="text-ink-soft">◂</span>
        <span>{childLabel}</span>
        <span className="text-ink-soft">·</span>
        <span className="ltr-nums text-ink-soft">{strings.drill.escHint}</span>
        {/* PLAN-10 §7: the drill chip has always SAID "Esc לחזרה" and never offered
            anything to press. Esc is not discoverable and this state is the one a
            usability tester most often felt trapped in. ⚠ `pointer-events-auto` is
            required — the Chip wrapper is pointer-events-none precisely so the chip
            never eats canvas clicks; this carves a ~20 px hole in the top centre,
            the identical trade DesignEditMode's own chip makes one row down. */}
        <button
          type="button"
          title={strings.drill.escHint}
          aria-label={strings.drill.escHint}
          data-testid="drill-exit"
          onClick={() => parentId && select([parentId])}
          className="pointer-events-auto rounded-full p-0.5 text-ink-soft transition-colors hover:bg-accent-tint hover:text-ink"
        >
          <X size={14} />
        </button>
      </Chip>
    )
  }
  if (!placing) return null
  return (
    <Chip>
      <span>
        {dropActive
          ? strings.workspace.dropHere
          : strings.workspace.placingChip(displayName('', placing, undefined))}
      </span>
    </Chip>
  )
}

/** 'surface' and 'seat' are the table-attached placements — the two that drop onto a table. */
function attachesToTable(entry: CatalogEntry): boolean {
  return entry.placement === 'surface' || entry.placement === 'seat'
}

interface ViewFit {
  scale: number
  x: number
  y: number
}

function computeFit(box: AABB, width: number, height: number, margin = 60): ViewFit {
  const w = box.maxX - box.minX
  const h = box.maxY - box.minY
  const scale = clampZoom(Math.min((width - margin * 2) / w, (height - margin * 2) / h))
  return {
    scale,
    x: (width - w * scale) / 2 - box.minX * scale,
    y: (height - h * scale) / 2 - box.minY * scale,
  }
}

export function Stage2D() {
  const { ref: containerRef, width, height } = useElementSize<HTMLDivElement>()
  const stageRef = useRef<Konva.Stage>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [initialView, setInitialView] = useState<ViewFit | null>(null)
  /** an HTML5 drag from the library is over this canvas right now */
  const [dropActive, setDropActive] = useState(false)
  const spacePan = useOverlayStore((s) => s.spacePan)
  const handTool = useOverlayStore((s) => s.handTool)
  const placing = useOverlayStore((s) => s.placing)
  const panMode = spacePan || handTool
  const marqueeRef = useRef<Vec2 | null>(null)
  const midPanRef = useRef<{ pointer: Vec2; stagePos: Vec2 } | null>(null)
  /**
   * The viewport as it was when design-edit mode opened, so exiting puts the user
   * back where they were looking (PLAN-10 §6).
   *
   * ⚠ A COMPONENT REF ON PURPOSE. It cannot reach `scene`, so it cannot be
   * persisted into a project file and cannot spend an undo entry — which is what
   * "where the camera was" must never do. `viewportStore` would be the second-best
   * home; the scene is not an option at all.
   */
  const savedViewRef = useRef<ViewFit | null>(null)

  const applyView = useCallback((scale: number, pos: Vec2) => {
    const stage = stageRef.current
    if (!stage) return
    stage.scale({ x: scale, y: scale })
    stage.position(pos)
    useViewportStore.getState().setZoom(scale)
  }, [])

  const zoomAtPoint = useCallback(
    (newScale: number, screenPoint: Vec2) => {
      const stage = stageRef.current
      if (!stage) return
      const oldScale = stage.scaleX()
      const clamped = clampZoom(newScale)
      const worldPoint = {
        x: (screenPoint.x - stage.x()) / oldScale,
        y: (screenPoint.y - stage.y()) / oldScale,
      }
      applyView(clamped, {
        x: screenPoint.x - worldPoint.x * clamped,
        y: screenPoint.y - worldPoint.y * clamped,
      })
    },
    [applyView],
  )

  const fitBox = useCallback(
    (box: AABB, margin = 60) => {
      if (box.maxX - box.minX <= 0 || box.maxY - box.minY <= 0) return
      const fit = computeFit(box, width, height, margin)
      applyView(fit.scale, { x: fit.x, y: fit.y })
    },
    [applyView, width, height],
  )

  const zoomApi: ZoomApi = useMemo(
    () => ({
      zoomIn: () => {
        userTouchedViewRef.current = true
        zoomAtPoint((stageRef.current?.scaleX() ?? ZOOM_100) * 1.25, { x: width / 2, y: height / 2 })
      },
      zoomOut: () => {
        userTouchedViewRef.current = true
        zoomAtPoint((stageRef.current?.scaleX() ?? ZOOM_100) / 1.25, { x: width / 2, y: height / 2 })
      },
      zoom100: () => {
        userTouchedViewRef.current = true
        zoomAtPoint(ZOOM_100, { x: width / 2, y: height / 2 })
      },
      fitVenue: () => {
        // an explicit fit hands the viewport back to auto-fit-on-resize
        userTouchedViewRef.current = false
        const { width: vw, depth: vd } = useEditorStore.getState().scene.venue.size
        fitBox({ minX: 0, minY: 0, maxX: vw, maxY: vd })
      },
      fitSelection: () => {
        userTouchedViewRef.current = true
        const state = useEditorStore.getState()
        const boxes = state.selection
          .map((id) => objectAABB(state.scene, id))
          .filter((b): b is AABB => !!b)
        if (boxes.length) fitBox(aabbUnion(boxes), 120)
      },
      /**
       * PLAN-10 §6: entering the mode on a table that is 70 px wide with twelve
       * place settings on it is not something anyone can arrange. Frame it on the
       * way in, put the view back on the way out.
       *
       * `subtreeAABB`, not `objectAABB` — the table PLUS its attached chairs, so
       * the chairs that stay live inside the mode stay on screen with it.
       */
      frameTable: (id) => {
        const stage = stageRef.current
        if (!id) {
          // ⚠ Cleared BEFORE the size guard: entering in split, switching to full
          // 3D and exiting there would otherwise leave a stale saved view that a
          // later exit snaps back to.
          const v = savedViewRef.current
          savedViewRef.current = null
          if (stage && width > 0 && height > 0 && v) applyView(v.scale, { x: v.x, y: v.y })
          return
        }
        // ⚠ In full 3D this pane is `display:none` and width/height are 0, which
        // would make computeFit produce a negative scale clamped to ZOOM_MIN.
        if (!stage || width <= 0 || height <= 0) return
        // guard so a table → table re-entry cannot overwrite the ORIGINAL view
        if (!savedViewRef.current) {
          savedViewRef.current = { scale: stage.scaleX(), x: stage.x(), y: stage.y() }
        }
        const box = subtreeAABB(useEditorStore.getState().scene, id)
        if (box) {
          // ⚠ Load-bearing: without it the resize effect re-fits the venue and
          // undoes this framing the moment a panel settles.
          userTouchedViewRef.current = true
          fitBox(box, 90)
        }
      },
    }),
    [zoomAtPoint, fitBox, applyView, width, height],
  )

  useEditorShortcuts(zoomApi)

  // let outside chrome (status bar) drive the viewport
  useEffect(() => {
    registerZoomApi(zoomApi)
    return () => registerZoomApi(null)
  }, [zoomApi])

  /**
   * End a middle-button pan that was released off the canvas.
   *
   * Konva binds its mouse events to its own canvas element and nothing else
   * (`Stage.js:308` — unlike its drag-and-drop, which listens on `window`), so a
   * middle-drag finished outside the viewport never reaches `handleMouseUp`: the
   * pan stayed armed and the next move over the canvas jumped the view by however
   * far the pointer had travelled meanwhile. That was invisible until this round;
   * with `panning` feeding the cursor it would also leave the closed hand on with
   * no gesture behind it.
   *
   * Cheap because it only acts when a pan is actually in flight — the ordinary
   * in-canvas release has already cleared the ref by the time this bubbles up.
   */
  useEffect(() => {
    const endMidPan = () => {
      if (!midPanRef.current) return
      midPanRef.current = null
      overlay.setPanning(false)
    }
    window.addEventListener('mouseup', endMidPan)
    return () => window.removeEventListener('mouseup', endMidPan)
  }, [])

  // dev-only debug handle for inspecting the live stage from the console
  useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as unknown as { __stage?: Konva.Stage | null }).__stage = stageRef.current
    }
  })

  // floor-plan capture source (PNG export + dashboard previews).
  // Normalizes the stage transform to a deterministic full-venue framing,
  // optionally hides helper layers + selection visuals, captures, restores.
  useEffect(() => {
    registerCapture(({ pixelRatio, clean }) => {
      const stage = stageRef.current
      if (!stage) return null
      const { width: vw, depth: vd } = useEditorStore.getState().scene.venue.size
      // ⚠ THE VENUE RECTANGLE IS NOT THE BUILDING. `size` is the box the editor
      // frames and clamps furniture to; the resort's walls run from y ≈ −640 to
      // 2550 and from x ≈ −230, all outside it. Framing the rectangle alone cut
      // the north wall off every export and left the top of the sheet looking
      // empty (handoff/FOUND-06.md §1) — on screen it was always there, because
      // the canvas is bigger than the rectangle. So the sheet is the UNION of the
      // two, and a pack with no walls still gets exactly its rectangle.
      const pack = getVenuePack(useEditorStore.getState().scene.venue.venuePackId)
      const walls = cachedVenueCut(pack?.cut)?.bounds
      const frame = {
        minX: Math.min(0, walls?.minX ?? 0),
        minY: Math.min(0, walls?.minY ?? 0),
        maxX: Math.max(vw, walls?.maxX ?? vw),
        maxY: Math.max(vd, walls?.maxY ?? vd),
      }
      const exportScale = ZOOM_100 // 64px/m at pixelRatio 1
      const prevScale = stage.scaleX()
      const prevPos = stage.position()
      const layers = stage.getLayers()
      // [0]=venue [1]=grid [2]=objects [3]=overlay [4]=transformer [5]=beams.
      // BeamLayer goes LAST and always renders a Layer (even when off) so these
      // indices keep meaning what they say — add new layers at the end too.
      const hidden = clean ? [layers[1], layers[3], layers[4], layers[5]].filter(Boolean) : []
      const prevVisible = hidden.map((l) => l.visible())
      // selection highlights are dedicated Konva nodes — hide them imperatively
      // (React flushing doesn't reach the react-konva reconciler synchronously)
      const selectionVisuals = clean ? stage.find('.selection-visual') : []
      try {
        hidden.forEach((l) => l.visible(false))
        selectionVisuals.forEach((n) => n.visible(false))
        stage.scale({ x: exportScale, y: exportScale })
        stage.position({ x: 0, y: 0 })
        return stage.toDataURL({
          x: (frame.minX - SHEET_MARGIN) * exportScale,
          y: (frame.minY - SHEET_MARGIN) * exportScale,
          width: (frame.maxX - frame.minX + SHEET_MARGIN * 2) * exportScale,
          height: (frame.maxY - frame.minY + SHEET_MARGIN * 2) * exportScale,
          pixelRatio,
          mimeType: 'image/png',
        })
      } finally {
        stage.scale({ x: prevScale, y: prevScale })
        stage.position(prevPos)
        hidden.forEach((l, i) => l.visible(prevVisible[i]))
        selectionVisuals.forEach((n) => n.visible(true))
        stage.batchDraw()
      }
    })
    return () => registerCapture(null)
  }, [])

  // compute the initial view synchronously once the container has a size,
  // BEFORE the stage first renders (no ref-timing dependence)
  useEffect(() => {
    if (width > 0 && height > 0 && !initialView) {
      const { width: vw, depth: vd } = useEditorStore.getState().scene.venue.size
      const fit = computeFit({ minX: 0, minY: 0, maxX: vw, maxY: vd }, width, height)
      useViewportStore.getState().setZoom(fit.scale)
      setInitialView(fit)
    }
  }, [width, height, initialView])

  // keep the venue fit while the pane is still settling (panels mounting,
  // split ratio changes) — until the user takes over the viewport
  const userTouchedViewRef = useRef(false)

  /**
   * The viewport follows the hall/reception toggle.
   *
   * The two are different buildings 20 m apart on the sheet, and the toggle now
   * hides one of them outright — so without this, switching to the reception
   * leaves you looking at the empty stretch where the hall used to be, with the
   * deck off in a corner. 3D already flies its camera to the reception angle on
   * the same switch; this is the 2D half of that.
   *
   * ⚠ It deliberately OVERRIDES a hand-set pan and zoom, which nothing else here
   * does. Pressing the toggle is a statement about what you want to look at, and
   * honouring the old viewport would answer it by showing you nothing.
   */
  const activeZone = useEditorStore((s) => s.activeZone)
  const firstZoneFit = useRef(true)
  useEffect(() => {
    if (!initialView || width <= 0 || height <= 0) return
    // not on mount: the fit above already framed the venue, and re-running here
    // would fight it on every panel resize
    if (firstZoneFit.current) {
      firstZoneFit.current = false
      return
    }
    const scene = useEditorStore.getState().scene
    const deck = getVenuePack(scene.venue.venuePackId)?.restricted?.find(
      (z) => z.kind === 'kabalatPanim',
    )
    const box =
      activeZone === 'kabalatPanim' && deck
        ? { minX: deck.x, minY: deck.y, maxX: deck.x + deck.width, maxY: deck.y + deck.depth }
        : {
            minX: 0,
            minY: 0,
            maxX: deck ? Math.min(scene.venue.size.width, deck.x) : scene.venue.size.width,
            maxY: scene.venue.size.depth,
          }
    userTouchedViewRef.current = true
    fitBox(box, 90)
  }, [activeZone, initialView, width, height, fitBox])
  useEffect(() => {
    if (initialView && width > 0 && height > 0 && !userTouchedViewRef.current) {
      const { width: vw, depth: vd } = useEditorStore.getState().scene.venue.size
      const fit = computeFit({ minX: 0, minY: 0, maxX: vw, maxY: vd }, width, height)
      applyView(fit.scale, { x: fit.x, y: fit.y })
    }
  }, [width, height, initialView, applyView])

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    userTouchedViewRef.current = true
    const factor = Math.exp(-e.evt.deltaY * 0.0015)
    zoomAtPoint(stage.scaleX() * factor, pointer)
  }

  const worldPointer = (): Vec2 | null => {
    const stage = stageRef.current
    return stage ? (stage.getRelativePointerPosition() as Vec2 | null) : null
  }

  /**
   * Topmost table whose outline contains the point — the drop target for surface
   * decor. `inHole` reports that the pointer is over the open centre of a ring
   * table, so the piece stands on the floor and rises through it (source doc §48)
   * instead of on the top.
   */
  const surfaceTargetAt = (world: Vec2): { id: Id; inHole: boolean } | null => {
    const { scene } = useEditorStore.getState()
    for (let i = scene.objectOrder.length - 1; i >= 0; i--) {
      const id = scene.objectOrder[i]
      const obj = scene.objects[id]
      if (!obj || !isObjectVisible(scene, id)) continue
      const entry = getCatalogEntry(obj.catalogId)
      // REACHABLE, unlike most of the v13 sites: `objectOrder` holds top-level
      // objects only, but PASTE promotes a copied surface child to one
      // (`root.parentId = null; delete root.attachment`, state/actions.ts). A
      // pasted `ring.table` standing on the floor would otherwise become a drop
      // target for table decor the moment it joined 'tables'.
      if (!isFloorTable(entry)) continue
      const outline = entry.footprint(obj.size).outline
      if (pointInOutline(world, obj.transform, outline)) {
        return { id, inHole: pointInHole(world, obj.transform, outline) }
      }
    }
    return null
  }

  /**
   * The ghost asks the same question the drop will ask (source doc §57). It used
   * to test the venue RECTANGLE alone, so it stayed green over the pool and the
   * item was quietly shoved out afterwards; now red means the click does nothing
   * and the status bar says why.
   */
  const ghostValidity = (catalogId: string, world: Vec2): boolean => {
    const { scene } = useEditorStore.getState()
    const entry = getCatalogEntry(catalogId)
    const target = attachesToTable(entry) ? surfaceTargetAt(world) : null
    if (attachesToTable(entry) && !target) {
      overlay.setViolation(null) // "not over a table" is a cursor state, not a refusal
      return false
    }
    const violations = checkPlacement(scene, {
      catalogId,
      transform: { position: world, rotation: entry.defaultRotation ?? 0, elevation: 0 },
      size: entry.defaultSize,
      parentId: target?.id,
    })
    overlay.setViolation(violations[0] ?? null)
    return violations.length === 0
  }

  /**
   * Put one catalog item on the plan at `world` — THE one placement path.
   *
   * Both ways in end here: the click that commits an armed item, and the drop that
   * ends a drag from the library. HTML5 drag-and-drop is a second way to ARM and
   * COMMIT the pipeline that already existed (`setPlacing` → `setGhost` →
   * `ghostValidity`), not a second placement system — if the two had their own
   * copies of the surface/seat/preset branching they would drift, and the drop
   * would be the copy nobody notices is wrong.
   *
   * `keepArmed` is the Alt-on-commit rule (`core/shortcuts.ts` `placeRepeat`),
   * which now works on a drop as well as on a click. A REFUSED placement returns
   * before it, so the item stays armed either way and the status bar keeps the
   * reason `ghostValidity` just published.
   */
  const commitPlacement = (catalogId: string, world: Vec2, keepArmed: boolean) => {
    if (!ghostValidity(catalogId, world)) return
    const entry = getCatalogEntry(catalogId)
    if (attachesToTable(entry)) {
      const target = surfaceTargetAt(world)
      // 'seat' fills the whole table; 'surface' drops exactly at the pointer
      // (grid snap is meaningless on a table top)
      if (target) {
        if (entry.placement === 'seat') addSeatItemsToTable(catalogId, target.id)
        else addObjectToSurface(catalogId, target.id, world, target.inHole)
      }
    } else {
      const { settings } = useEditorStore.getState().scene
      const pos = settings.snapEnabled
        ? { x: snapValue(world.x, settings.gridSize), y: snapValue(world.y, settings.gridSize) }
        : world
      // read at commit time, not off a render-scope binding: a drop handler runs
      // outside the render that armed it
      const preset = useOverlayStore.getState().placingPreset
      if (preset) addTablePreset(preset, pos)
      else addObject(catalogId, pos)
    }
    if (!keepArmed) overlay.setPlacing(null)
  }

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current
    if (!stage) return
    if (e.evt.button === 1) {
      e.evt.preventDefault()
      userTouchedViewRef.current = true
      const pointer = stage.getPointerPosition()
      if (pointer) {
        midPanRef.current = { pointer, stagePos: stage.position() }
        overlay.setPanning(true)
      }
      return
    }
    if (placing) return
    if (e.evt.button === 0 && e.target === stage && !panMode) {
      const editing = useEditorStore.getState()
      if (designEditTable(editing.scene, editing.designEditTableId)) {
        // PLAN-10 §5: inside the mode an empty-background DRAG pans. Measured
        // before this: dragging 600 px across empty floor cleared the mode, cleared
        // the selection and moved the view by zero pixels — while the SAME gesture
        // in 3D orbits the camera and keeps the mode. Two opposite answers to one
        // movement.
        //
        // Reuses the middle-button pan verbatim rather than duplicating the hand
        // tool. No marquee is lost: with the rest of the plan dimmed and deaf, a
        // rubber band could only ever catch what the mode just put out of reach.
        //
        // `overlay.setPanning(true)` is deliberately NOT set — it would flash the
        // closed hand on a press that turns out to be a plain click.
        const pointer = stage.getPointerPosition()
        if (pointer) {
          userTouchedViewRef.current = true
          midPanRef.current = { pointer, stagePos: stage.position() }
        }
        return
      }
      const world = worldPointer()
      if (world) {
        marqueeRef.current = world
        overlay.setMarquee({ x1: world.x, y1: world.y, x2: world.x, y2: world.y })
      }
    }
  }

  const handleMouseMove = () => {
    const stage = stageRef.current
    if (!stage) return
    const world = worldPointer()
    if (world) overlay.setCursorWorld(world)
    if (placing && world) {
      overlay.setGhost({ x: world.x, y: world.y, valid: ghostValidity(placing, world) })
    }
    if (midPanRef.current) {
      const pointer = stage.getPointerPosition()
      if (pointer) {
        stage.position({
          x: midPanRef.current.stagePos.x + (pointer.x - midPanRef.current.pointer.x),
          y: midPanRef.current.stagePos.y + (pointer.y - midPanRef.current.pointer.y),
        })
      }
      return
    }
    if (marqueeRef.current && world) {
      overlay.setMarquee({
        x1: marqueeRef.current.x,
        y1: marqueeRef.current.y,
        x2: world.x,
        y2: world.y,
      })
    }
  }

  const handleMouseUp = (e: KonvaEventObject<MouseEvent>) => {
    if (midPanRef.current) {
      const start = midPanRef.current.pointer
      const end = stageRef.current?.getPointerPosition() ?? start
      midPanRef.current = null
      overlay.setPanning(false)
      // ⚠ SCREEN PIXELS, NOT WORLD. A pan moves the stage under a stationary
      // pointer, so `getRelativePointerPosition()` reports the SAME world point at
      // press and at release — the world-space `isClick` below would score every
      // pan as a click.
      const moved = Math.abs(end.x - start.x) >= 3 || Math.abs(end.y - start.y) >= 3
      const editing = useEditorStore.getState()
      if (!moved && e.evt.button === 0 && designEditTable(editing.scene, editing.designEditTableId)) {
        // ⚠ THE MODE IS NOT CLOSED HERE, AND MUST NOT BE (the user, 2026-08-04:
        // "it should only be cancelled by Escape or by the button"). A stray click
        // anywhere on the floor used to end the session, which is how you lose a
        // table you were half way through arranging without ever asking to. The
        // ONLY ways out are now deliberate ones: Esc, `שמור וצא`, and the ✕ — all
        // three in `ui/DesignEditMode.tsx`.
        //
        // The click still DESELECTS, which is what a background click means
        // everywhere else in the plan: it steps off a place setting without
        // stepping out of the table.
        clearSelection()
      }
      return
    }
    if (placing) {
      const world = worldPointer()
      if (world) commitPlacement(placing, world, e.evt.altKey)
      return
    }
    if (!marqueeRef.current) return
    const start = marqueeRef.current
    marqueeRef.current = null
    const world = worldPointer() ?? start
    overlay.setMarquee(null)

    // ⚠ THE DESIGN-EDIT EXIT USED TO LIVE HERE AND IS NOW UNREACHABLE — deleted
    // rather than left to rot. Since PLAN-10 §5 an empty-background press inside
    // the mode arms `midPanRef` instead of a marquee (handleMouseDown), so the
    // release is always taken by the midPan branch at the top of this function,
    // which is also the only place that can tell a click from a pan. Two exit
    // implementations for one gesture is how the two views drifted apart in the
    // first place. `dragController.ts`'s "exited by a click on empty canvas
    // (Stage2D)" stays true — it just happens twenty lines higher.
    const zoom = useViewportStore.getState().zoom
    const isClick = Math.abs(world.x - start.x) * zoom < 3 && Math.abs(world.y - start.y) * zoom < 3
    if (isClick) {
      if (!e.evt.shiftKey) clearSelection()
      return
    }
    const box: AABB = {
      minX: Math.min(start.x, world.x),
      minY: Math.min(start.y, world.y),
      maxX: Math.max(start.x, world.x),
      maxY: Math.max(start.y, world.y),
    }
    const state = useEditorStore.getState()
    const hits = visibleTopLevelIds(state.scene).filter((id) => {
      const b = objectAABB(state.scene, id)
      const obj = state.scene.objects[id]
      return b && aabbIntersects(box, b) && !!obj && !isEffectivelyLocked(state.scene, obj)
    })
    select(e.evt.shiftKey ? [...new Set([...state.selection, ...hits])] : hits)
  }

  // -------------------------------------------------------------------------
  // HTML5 drag-and-drop from the library.
  //
  // ⚠ THESE LIVE ON THE CONTAINER <div>, NOT ON <Stage>. Konva does not forward
  // DOM drag events — it listens for pointer events on its own canvas and has no
  // dragover/drop of its own (`Konva.DragEvent` is a different, internal thing) —
  // so a handler on the Stage would simply never fire.
  //
  // The pointer position comes from `setPointersPositions(nativeEvent)`, which is
  // how Konva itself resolves a raw DOM event into stage coordinates, and then
  // through `getRelativePointerPosition` so pan and zoom are already accounted for.
  // -------------------------------------------------------------------------

  const dropWorld = (e: React.DragEvent<HTMLDivElement>): Vec2 | null => {
    const stage = stageRef.current
    if (!stage) return null
    stage.setPointersPositions(e.nativeEvent)
    return stage.getRelativePointerPosition() as Vec2 | null
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    // `types` is readable during a drag; `getData` is NOT — it returns '' outside
    // the drop event in every browser's protected mode. So the payload identifies
    // the drag here and the STORE supplies the catalog id, which the tile armed on
    // dragstart.
    const armed = useOverlayStore.getState().placing
    if (!armed || !e.dataTransfer.types.includes(CATALOG_MIME)) return
    // without this the browser refuses the drop and `onDrop` never fires
    e.preventDefault()
    setDropActive(true)
    const world = dropWorld(e)
    if (!world) return
    const valid = ghostValidity(armed, world)
    overlay.setGhost({ x: world.x, y: world.y, valid })
    overlay.setCursorWorld(world)
    // ⚠ THE ONLY WAY TO SAY "NO" DURING A DRAG. The browser owns the cursor for
    // the whole gesture and CSS `cursor` on the container is ignored, so
    // `cursorFor`'s `not-allowed` cannot be shown here. Setting 'none' also makes
    // the browser suppress the drop outright, which is what keeps an invalid
    // release from reaching `commitPlacement` at all.
    e.dataTransfer.dropEffect = valid ? 'copy' : 'none'
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // dragleave fires every time the pointer crosses onto a CHILD of the target —
    // and this container has a canvas and three absolutely-positioned overlays in
    // it. Without the containment test the ghost would flicker off constantly.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDropActive(false)
    overlay.setGhost(null)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setDropActive(false)
    const catalogId = catalogIdFromDrop((mime) => e.dataTransfer.getData(mime))
    if (!catalogId) return
    e.preventDefault()
    const world = dropWorld(e)
    // Alt on the drop keeps the item armed, exactly as Alt on a click does. The
    // ghost is left alone: it is already at the drop point, and `setPlacing(null)`
    // clears it for the ordinary (disarming) case.
    if (world) commitPlacement(catalogId, world, e.altKey)
  }

  const handleContextMenu = (e: KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const world = worldPointer()
    if (!world) return
    let targetId: Id | null = null
    if (e.target !== stage) {
      const selection = useEditorStore.getState().selection
      // Prefer a drilled-in chair: only when that chair is the current selection.
      const chairGroup = e.target.findAncestor('.attached-object', true)
      if (chairGroup && selection.includes(chairGroup.id())) {
        targetId = chairGroup.id()
      } else {
        const group = e.target.findAncestor('.scene-object', true)
        if (group) targetId = group.id()
      }
    }
    if (targetId && !useEditorStore.getState().selection.includes(targetId)) select([targetId])
    setMenu({ x: e.evt.clientX, y: e.evt.clientY, world, targetId })
  }

  const menuItems: MenuEntry[] = useMemo(() => {
    if (!menu) return []
    const state = useEditorStore.getState()
    if (menu.targetId) {
      const target = state.scene.objects[menu.targetId]
      if (target?.parentId) {
        const childId = target.id
        if (target.attachment?.kind === 'surface') {
          // table-top decor: it lives on the table only — delete, never detach
          return [
            { label: strings.menu.delete, shortcut: 'Del', danger: true, onClick: () => removeObjects([childId]) },
          ]
        }
        // drilled-in attached chair
        return [
          { label: strings.menu.deleteChair, danger: true, onClick: () => removeObjects([childId]) },
        ]
      }
      const sel = state.selection
      const anyLocked = sel.some((id) => state.scene.objects[id]?.flags.locked)
      const replaceId = menu.targetId
      return [
        { label: strings.menu.duplicate, shortcut: 'Ctrl+D', onClick: () => duplicateObjects(sel) },
        { label: strings.menu.copy, shortcut: 'Ctrl+C', onClick: () => copySelection() },
        { label: strings.menu.cut, shortcut: 'Ctrl+X', onClick: () => cutSelection() },
        'separator',
        { label: strings.menu.rotate90, shortcut: 'R', onClick: () => rotateObjectsBy(sel, 90) },
        // Shift+R has always turned the other way; the menu only ever offered one
        // direction, so the second one was reachable exclusively by keyboard.
        {
          label: strings.menu.rotate90ccw,
          shortcut: 'Shift+R',
          onClick: () => rotateObjectsBy(sel, -90),
        },
        // Beside the rotations because that is where the user looks for it, and
        // because the whole point is that no rotation does this.
        { label: strings.menu.mirror, shortcut: 'M', onClick: () => mirrorObjects(sel) },
        {
          label: strings.menu.mirrorCopy,
          shortcut: 'Alt+M',
          onClick: () => mirrorCopyObjects(sel),
        },
        {
          // arms the library's replace mode — the actual pick happens there
          label: strings.menu.replace,
          disabled: sel.length !== 1 || !target || isEffectivelyLocked(state.scene, target),
          onClick: () => overlay.setReplaceTarget(replaceId),
        },
        'separator',
        { label: strings.menu.bringForward, onClick: () => sel.forEach((id) => reorder(id, 'forward')) },
        { label: strings.menu.sendBackward, onClick: () => sel.forEach((id) => reorder(id, 'backward')) },
        { label: strings.menu.bringToFront, onClick: () => sel.forEach((id) => reorder(id, 'front')) },
        { label: strings.menu.sendToBack, onClick: () => sel.forEach((id) => reorder(id, 'back')) },
        'separator',
        {
          label: anyLocked ? strings.menu.unlock : strings.menu.lock,
          onClick: () => setLocked(sel, !anyLocked),
        },
        'separator',
        { label: strings.menu.delete, shortcut: 'Del', danger: true, onClick: () => removeObjects(sel) },
      ]
    }
    return [
      {
        label: strings.menu.pasteHere,
        disabled: !clipboardHasContent(),
        onClick: () => pasteClipboard(menu.world),
      },
      { label: strings.menu.selectAll, shortcut: 'Ctrl+A', onClick: () => select(visibleTopLevelIds(state.scene)) },
      'separator',
      { label: strings.menu.fitVenue, shortcut: 'Shift+1', onClick: () => zoomApi.fitVenue() },
      { label: strings.menu.zoom100, shortcut: 'Ctrl+0', onClick: () => zoomApi.zoom100() },
    ]
  }, [menu, zoomApi])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-canvas"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {width > 0 && height > 0 && initialView && (
        <Stage
          ref={stageRef}
          width={width}
          height={height}
          scaleX={initialView.scale}
          scaleY={initialView.scale}
          x={initialView.x}
          y={initialView.y}
          draggable={panMode}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onContextMenu={handleContextMenu}
          onDragStart={(e) => {
            if (e.target === stageRef.current) overlay.setPanning(true)
          }}
          onDragEnd={(e) => {
            // stage drag = space/hand pan (object drags don't bubble this far
            // with a stage target)
            if (e.target !== stageRef.current) return
            userTouchedViewRef.current = true
            overlay.setPanning(false)
          }}
        >
          <VenueLayer />
          <GridLayer />
          <ObjectsLayer />
          <OverlayLayer />
          <SelectionTransformer stageRef={stageRef} />
          {/* last on purpose — its veil dims everything above the floor plan */}
          <BeamLayer />
        </Stage>
      )}
      <CanvasCursor target={containerRef} />
      <StageChips dropActive={dropActive} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      <EmptyCanvasHint />
    </div>
  )
}

/**
 * The first thing a new operator sees, and until round 4 it was never seen at
 * all: the condition was `objectOrder.length === 0`, which is never true on the
 * resort pack because 25 baked fixtures are seeded into `objectOrder`. Asking
 * `hasUserObjects` is the fix — rewriting the text alone would have left every
 * line exactly as invisible while making the round look finished.
 *
 * Four lines in reading order, and they are a designed set rather than four
 * ways of saying one thing: what you are looking at · the direct gesture, which
 * now genuinely works · **the way in that needs no dragging at all** · where the
 * rest of the answers live. The layouts line matters most for the person this
 * round is for — someone seating 300 guests does not start by placing one chair.
 */
function EmptyCanvasHint() {
  const empty = useEditorStore((s) => !hasUserObjects(s.scene))
  const placing = useOverlayStore((s) => s.placing !== null)
  // while an item is armed the placing chip already owns the top of the canvas,
  // and the ghost is the instruction — two overlays would compete
  if (!empty || placing) return null
  const W = strings.workspace
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="max-w-xs rounded-xl border border-line bg-panel/85 px-5 py-4 text-center shadow-sm">
        <p className="text-[15px] font-semibold text-ink">{W.emptyCanvasTitle}</p>
        <p className="mt-2 text-[13px] text-ink-soft">{W.emptyCanvasHint}</p>
        <p className="mt-1 text-[13px] text-ink-soft">{W.emptyCanvasLayouts}</p>
        <p className="mt-3 text-[13px] text-ink-soft">{W.emptyCanvasHelp}</p>
      </div>
    </div>
  )
}
