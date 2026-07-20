import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stage } from 'react-konva'
import { getCatalogEntry } from '../core/catalog/registry'
import type { CatalogEntry } from '../core/catalog/types'
import { aabbIntersects, aabbUnion, pointInOutline, type AABB } from '../core/layout/bounds'
import { snapValue } from '../core/layout/snapping'
import type { Id, Vec2 } from '../core/model/types'
import {
  addObject,
  addObjectToSurface,
  addTablePreset,
  addSeatItemsToTable,
  clearSelection,
  detachChair,
  duplicateObjects,
  removeObjects,
  reorder,
  rotateObjectsBy,
  select,
  setLocked,
} from '../state/actions'
import { isEffectivelyLocked, isObjectVisible, objectAABB, visibleTopLevelIds } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { useElementSize } from '../lib/useElementSize'
import { ContextMenu, type MenuEntry } from '../ui/ContextMenu'
import { strings } from '../ui/strings'
import { clipboardHasContent, copySelection, cutSelection, pasteClipboard } from './clipboard'
import { GridLayer } from './GridLayer'
import { displayName } from './ObjectNode'
import { ObjectsLayer } from './ObjectsLayer'
import { overlay, useOverlayStore } from './overlayStore'
import { OverlayLayer } from './OverlayLayer'
import { SelectionTransformer } from './SelectionTransformer'
import { useEditorShortcuts, type ZoomApi } from './useEditorShortcuts'
import { clampZoom, useViewportStore, ZOOM_100 } from './viewportStore'
import { VenueLayer } from './VenueLayer'
import { registerCapture } from './captureBus'
import { registerZoomApi } from './zoomBus'

interface MenuState {
  x: number
  y: number
  world: Vec2
  targetId: Id | null
}

/** Chip shown while an attached child is drilled into, naming its table and the way out. */
function DrillBreadcrumb() {
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
  if (!tableName) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
      <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[11px] shadow-sm">
        <span className="font-semibold">{tableName}</span>
        <span className="text-ink-soft">◂</span>
        <span>{childLabel}</span>
        <span className="text-ink-soft">·</span>
        <span className="ltr-nums text-ink-soft">{strings.drill.escHint}</span>
      </div>
    </div>
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
  const spacePan = useOverlayStore((s) => s.spacePan)
  const handTool = useOverlayStore((s) => s.handTool)
  const placing = useOverlayStore((s) => s.placing)
  const placingPreset = useOverlayStore((s) => s.placingPreset)
  const panMode = spacePan || handTool
  const marqueeRef = useRef<Vec2 | null>(null)
  const midPanRef = useRef<{ pointer: Vec2; stagePos: Vec2 } | null>(null)

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
    }),
    [zoomAtPoint, fitBox, width, height],
  )

  useEditorShortcuts(zoomApi)

  // let outside chrome (status bar) drive the viewport
  useEffect(() => {
    registerZoomApi(zoomApi)
    return () => registerZoomApi(null)
  }, [zoomApi])

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
      const exportScale = ZOOM_100 // 64px/m at pixelRatio 1
      const prevScale = stage.scaleX()
      const prevPos = stage.position()
      const layers = stage.getLayers()
      // [0]=venue [1]=grid [2]=objects [3]=overlay [4]=transformer
      const hidden = clean ? [layers[1], layers[3], layers[4]].filter(Boolean) : []
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
          x: 0,
          y: 0,
          width: vw * exportScale,
          height: vd * exportScale,
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

  /** Topmost table whose outline contains the point — the drop target for surface decor. */
  const surfaceTargetAt = (world: Vec2): Id | null => {
    const { scene } = useEditorStore.getState()
    for (let i = scene.objectOrder.length - 1; i >= 0; i--) {
      const id = scene.objectOrder[i]
      const obj = scene.objects[id]
      if (!obj || !isObjectVisible(scene, id)) continue
      const entry = getCatalogEntry(obj.catalogId)
      if (entry.category !== 'tables') continue
      if (pointInOutline(world, obj.transform, entry.footprint(obj.size).outline)) return id
    }
    return null
  }

  const ghostValidity = (catalogId: string, world: Vec2): boolean => {
    const entry = getCatalogEntry(catalogId)
    if (attachesToTable(entry)) return surfaceTargetAt(world) !== null
    const outline = entry.footprint(entry.defaultSize).outline
    const hw = outline.kind === 'circle' ? outline.r : outline.w / 2
    const hh = outline.kind === 'circle' ? outline.r : outline.h / 2
    const venue = useEditorStore.getState().scene.venue.size
    return world.x - hw >= 0 && world.x + hw <= venue.width && world.y - hh >= 0 && world.y + hh <= venue.depth
  }

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current
    if (!stage) return
    if (e.evt.button === 1) {
      e.evt.preventDefault()
      userTouchedViewRef.current = true
      const pointer = stage.getPointerPosition()
      if (pointer) midPanRef.current = { pointer, stagePos: stage.position() }
      return
    }
    if (placing) return
    if (e.evt.button === 0 && e.target === stage && !panMode) {
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
      midPanRef.current = null
      return
    }
    if (placing) {
      const world = worldPointer()
      if (world && ghostValidity(placing, world)) {
        const entry = getCatalogEntry(placing)
        if (attachesToTable(entry)) {
          const target = surfaceTargetAt(world)
          // 'seat' fills the whole table; 'surface' drops exactly at the pointer
          // (grid snap is meaningless on a table top)
          if (target) {
            if (entry.placement === 'seat') addSeatItemsToTable(placing, target)
            else addObjectToSurface(placing, target, world)
          }
        } else {
          const { settings } = useEditorStore.getState().scene
          const pos = settings.snapEnabled
            ? { x: snapValue(world.x, settings.gridSize), y: snapValue(world.y, settings.gridSize) }
            : world
          if (placingPreset) addTablePreset(placingPreset, pos)
          else addObject(placing, pos)
        }
        if (!e.evt.altKey) {
          overlay.setPlacing(null)
        }
      }
      return
    }
    if (!marqueeRef.current) return
    const start = marqueeRef.current
    marqueeRef.current = null
    const world = worldPointer() ?? start
    overlay.setMarquee(null)

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
          { label: strings.menu.detachChair, onClick: () => detachChair(childId) },
          { label: strings.menu.deleteChair, danger: true, onClick: () => removeObjects([childId]) },
        ]
      }
      const sel = state.selection
      const anyLocked = sel.some((id) => state.scene.objects[id]?.flags.locked)
      return [
        { label: strings.menu.duplicate, shortcut: 'Ctrl+D', onClick: () => duplicateObjects(sel) },
        { label: strings.menu.copy, shortcut: 'Ctrl+C', onClick: () => copySelection() },
        { label: strings.menu.cut, shortcut: 'Ctrl+X', onClick: () => cutSelection() },
        'separator',
        { label: strings.menu.rotate90, shortcut: 'R', onClick: () => rotateObjectsBy(sel, 90) },
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
      style={{ cursor: panMode ? 'grab' : placing ? 'copy' : 'default' }}
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
          onDragEnd={(e) => {
            // stage drag = space/hand pan (object drags don't bubble this far
            // with a stage target)
            if (e.target === stageRef.current) userTouchedViewRef.current = true
          }}
        >
          <VenueLayer />
          <GridLayer />
          <ObjectsLayer />
          <OverlayLayer />
          <SelectionTransformer stageRef={stageRef} />
        </Stage>
      )}
      <DrillBreadcrumb />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      <EmptyCanvasHint />
    </div>
  )
}

function EmptyCanvasHint() {
  const isEmpty = useEditorStore((s) => s.scene.objectOrder.length === 0)
  if (!isEmpty) return null
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <p className="rounded-full border border-line bg-panel/85 px-4 py-2 text-[13px] text-ink-soft shadow-sm">
        {strings.workspace.emptyCanvasHint}
      </p>
    </div>
  )
}
