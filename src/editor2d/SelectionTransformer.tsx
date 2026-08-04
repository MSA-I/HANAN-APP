import type Konva from 'konva'
import { useEffect, useRef } from 'react'
import { Layer, Transformer } from 'react-konva'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { outlineAABB } from '../core/layout/bounds'
import { outlineShortSide } from '../core/layout/rotateHandle'
import { ROTATION_SNAP_DEG, rotationSnapsDeg, snapAngle } from '../core/rotation'
import { beginGesture, endGesture, setPosition, setRotation, setSize } from '../state/actions'
import { useEditorStore } from '../state/store'
import { overlay, useOverlayStore } from './overlayStore'
import { useViewportStore } from './viewportStore'

const ACCENT = '#3056d3'

/** The eight angles Shift lands on. Derived, never restated — see `core/rotation.ts`. */
const SNAP_ANGLES = rotationSnapsDeg(ROTATION_SNAP_DEG)

/**
 * How close the handle must come to a snap angle to take it: HALF THE STEP, so
 * every angle belongs to exactly one of them and Shift means "land on a multiple"
 * rather than "land on a multiple if you were nearly there anyway". Konva's
 * default is 5°, which would leave 80% of the circle free with Shift held down.
 *
 * Not more than half. `getSnap` (`konva/lib/shapes/Transformer.js:132-143`) keeps
 * the LAST matching entry rather than the nearest, so a tolerance wide enough for
 * two snaps to match at once would round the wrong way near the midpoints. At
 * exactly half, the test `dif < tol` takes neither snap at the exact midpoint —
 * the one angle equidistant from both — and `snapAngle` rounds it clockwise on
 * commit, which the next frame writes back to the node.
 */
const SNAP_TOLERANCE_DEG = ROTATION_SNAP_DEG / 2

/**
 * The smallest box a resize gesture may produce, in WORLD centimetres — see the
 * note on `boundBoxFunc`. Twelve centimetres is below every catalog minimum, so
 * this floor only ever stops a degenerate box, never a legitimate size.
 */
const MIN_BOX_CM = 12

const ALL_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]
const CORNER_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

/**
 * True when the gesture is a single object's rotation, which must NOT write a
 * position.
 *
 * Konva rotates around the transformer's bounding-box centre, so for any object
 * whose origin is not that centre — the serpentine table, whose arcs are centred
 * at (116.9, -116.1) while its outline is centred at the origin — committing
 * `node.x()/y()` turns "rotate" into "rotate and slide". The model rotates around
 * the object's own origin, so dropping the position write is what makes the two
 * agree. A multi-selection is the opposite case: orbiting around the group centre
 * IS the wanted behaviour, and a resize genuinely moves the origin.
 */
function spinsInPlace(anchor: string | null, nodeCount: number): boolean {
  return anchor === 'rotater' && nodeCount === 1
}

interface Props {
  stageRef: React.RefObject<Konva.Stage | null>
}

export function SelectionTransformer({ stageRef }: Props) {
  const trRef = useRef<Konva.Transformer>(null)
  /** which anchor started the gesture — `getActiveAnchor` is already cleared by transformend */
  const anchorRef = useRef<string | null>(null)
  const selection = useEditorStore((s) => s.selection)
  const objects = useEditorStore((s) => s.scene.objects)

  const single = selection.length === 1 ? objects[selection[0]] : null
  const entry = single && hasCatalogEntry(single.catalogId) ? getCatalogEntry(single.catalogId) : null

  /**
   * PLAN-10 §8, 2D half — the rotate handle and the anchors scale with how big the
   * object actually IS on screen.
   *
   * ⚠ PIXELS, NOT CENTIMETRES. Konva's Transformer overrides `getAbsoluteTransform`
   * to ignore the stage scale, so its anchors live in SCREEN space while the object
   * lives in world cm — the same mismatch `boundBoxFunc` below already converts for,
   * and the one that hid a real bug until round 4.
   *
   * Measured before this: at the ~0.128 px/cm the venue opens at, a single chair's
   * box is ~28 px with a 26 px handle floating above it, and a 36 cm prop is under
   * 5 px wide. The handle was bigger than the thing it turned.
   *
   * ⚠ THE ZOOM SUBSCRIPTION IS LOAD-BEARING, not decoration. This component
   * subscribes to `selection` and `objects` and nothing else, so on a wheel zoom
   * Konva repositions the transformer while re-reading the SAME stale anchor size.
   * Once these props are a function of zoom, the component MUST re-render on zoom
   * or it is worse than the constant it replaced. Every zoom path in Stage2D
   * funnels through `applyView` → `setZoom`, so this store is a complete signal,
   * and the `nodes()` effect does not depend on zoom, so re-rendering costs no
   * re-attach.
   *
   * ⚠ ACCEPTED REGRESSION (the user's explicit decision, 2026-08-04): the ceilings
   * are SCREEN pixels, so a ⌀180 table — 23 px at hall zoom — now lands on the
   * FLOORS (10 / 5) and only regains today's 26 / 8 above roughly 65% zoom. That
   * contradicts "no regression on the case that already works" as originally
   * written, and it is deliberate: a 26 px handle on a 23 px table is the same
   * complaint in a different costume.
   *
   * `Infinity` for a multi-selection, so both clamps land on their ceilings.
   */
  const zoom = useViewportStore((s) => s.zoom)
  const shortSidePx =
    entry && single ? outlineShortSide(entry.footprint(single.size).outline) * zoom : Infinity
  const rotateOffsetPx = Math.min(26, Math.max(10, shortSidePx * 0.35))
  const anchorPx = Math.min(8, Math.max(5, shortSidePx * 0.18))

  let anchors: string[] = []
  let keepRatio = false
  if (entry && single && !single.parentId) {
    const canW = entry.resizable.includes('width')
    const canD = entry.resizable.includes('depth')
    if (canW && canD) anchors = ALL_ANCHORS
    else if (canW && entry.linkWidthDepth) {
      anchors = CORNER_ANCHORS
      keepRatio = true
    } else if (canW) anchors = ['middle-left', 'middle-right']
  }

  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    const nodes = selection
      .map((id) => stage.findOne(`#${id}`))
      .filter((n): n is Konva.Group => !!n && n.name() === 'scene-object')
    tr.nodes(nodes)
  }, [selection, objects, stageRef])

  // A readout that outlives its gesture reads as a stuck number rather than as
  // feedback — and the transformer unmounts with the selection, which Esc and
  // Delete both clear mid-drag.
  useEffect(() => () => overlay.setGesture(null), [])

  /**
   * The snap step THIS FRAME is under: the 45° detents while Shift is down, 0 —
   * free, `snapAngle`'s exact passthrough — otherwise.
   *
   * Asked of the store rather than of the event on purpose. Konva does hand
   * `onTransform` an `evt`, but drei's `TransformControls` hands the 3D gizmo
   * nothing at all, and one field both views read is the only way the same table
   * cannot turn differently depending on which one you are looking at.
   */
  const snapStep = (): number => (useOverlayStore.getState().shiftHeld ? ROTATION_SNAP_DEG : 0)

  /**
   * Give Konva the same step, IMPERATIVELY on the node rather than as a prop.
   *
   * A prop would arrive on the next React commit, and the commit is driven by the
   * store writes this very handler makes — so the handle the user is dragging
   * would be snapping to last frame's answer while the store held this frame's.
   * Set here, the drawn handle and the committed rotation are computed in one tick
   * from one value.
   */
  const applySnaps = (step: number) => {
    const tr = trRef.current
    if (!tr) return
    tr.rotationSnaps(step > 0 ? SNAP_ANGLES : [])
    tr.rotationSnapTolerance(step > 0 ? SNAP_TOLERANCE_DEG : 0)
  }

  /**
   * Publish the live numbers for `OverlayLayer` to draw. Single selection only.
   *
   * The box is the object's OUTLINE, rebuilt from the catalog at the size and pose
   * the node is wearing this frame — not `getClientRect`. Konva's rect on a
   * labelled table is 300 cm wide, because the name is a `Text` of that width
   * inside the same group (`ObjectNode`), and `Transformer.getClientRect` takes no
   * `relativeTo` at all (`Transformer.d.ts:100`), so it can only answer in screen
   * pixels. The outline answers in plan centimetres and is what the user thinks of
   * as the box.
   *
   * The POSE comes off the node rather than out of the store, deliberately. Konva
   * rotates a single node around the transformer's bounding-box centre, which is
   * a position the store refuses to take (see `spinsInPlace`) — so the store is
   * the right answer to "where is this object" and the node is the right answer to
   * "where is the thing on screen the readout has to sit above". Every node the
   * transformer holds is top-level (the effect above filters on `scene-object`),
   * so its own transform IS the world one; there is no parent to compose with.
   */
  const publishReadout = (node: Konva.Node, rotating: boolean, step: number) => {
    const obj = useEditorStore.getState().scene.objects[node.id()]
    if (!obj || !hasCatalogEntry(obj.catalogId)) return
    // `size` is still the PRE-gesture size — `setSize` runs once, at the end — so
    // the live figure is that size times the scale Konva is carrying on the node,
    // which is exactly what `transformend` will commit.
    const width = obj.size.width * Math.abs(node.scaleX())
    const depth = obj.size.depth * Math.abs(node.scaleY())
    const box = outlineAABB(
      { position: { x: node.x(), y: node.y() }, rotation: node.rotation(), elevation: 0 },
      getCatalogEntry(obj.catalogId).footprint({ ...obj.size, width, depth }).outline,
    )
    const cx = (box.minX + box.maxX) / 2
    overlay.setGesture(
      rotating
        ? {
            kind: 'rotate',
            deg: snapAngle(node.rotation(), step),
            snapped: step > 0,
            at: { x: cx, y: box.minY },
          }
        : { kind: 'resize', width, depth, at: { x: cx, y: box.maxY } },
    )
  }

  return (
    <Layer>
      <Transformer
        ref={trRef}
        enabledAnchors={anchors}
        keepRatio={keepRatio}
        // FREE AT EVERY ANGLE BY DEFAULT (PLAN-09/G1) — that has not changed and
        // must not. What round 4 adds is the opposite polarity of the snap that
        // was removed: nothing is quantised unless SHIFT IS HELD, and then it is
        // 45° (`core/rotation.ts`), which is the Figma/SketchUp/Illustrator rule.
        //
        // There is still no `rotationSnaps` PROP, and that is deliberate: the
        // snaps are handed to the node inside the handlers (`applySnaps`) so the
        // step can change mid-gesture, and so an always-on array can never be
        // reintroduced by editing one line here. `snapAngle(x, 0)` is an exact
        // passthrough, which is what keeps the free case provably free.
        // Must mirror viewer3d/ObjectGroup.tsx `RotationHandle`.
        rotateEnabled
        rotateAnchorOffset={rotateOffsetPx}
        borderStroke={ACCENT}
        anchorStroke={ACCENT}
        anchorFill="#ffffff"
        anchorSize={anchorPx}
        anchorCornerRadius={1}
        ignoreStroke
        shouldOverdrawWholeArea={false}
        /**
         * ⚠ Konva hands this function ABSOLUTE, SCREEN coordinates — not world
         * units. The floor below was written as though they were world units,
         * and at the zoom the venue actually opens at that is fatal rather than
         * theoretical: the hall fits at ~20%, where the stage scale is about
         * 0.128 px/cm, so a 76 cm-deep buffet table measures ~10 screen px. Every
         * resize was refused before it began — nothing moved and nothing said
         * why — and it was invisible to the test suite, because a node-only
         * suite has no zoom. Found by driving the real app (round 4).
         *
         * So convert to world centimetres before comparing. The floor only has to
         * stop a degenerate or inverted box mid-drag; per-entry minimums are the
         * catalog's job and `setSize` clamps to them on commit.
         */
        boundBoxFunc={(oldBox, newBox) => {
          const scale = trRef.current?.getStage()?.scaleX() || 1
          const wCm = Math.abs(newBox.width) / scale
          const hCm = Math.abs(newBox.height) / scale
          if (wCm < MIN_BOX_CM || hCm < MIN_BOX_CM) return oldBox
          return newBox
        }}
        onTransformStart={() => {
          anchorRef.current = trRef.current?.getActiveAnchor() ?? null
          applySnaps(anchorRef.current === 'rotater' ? snapStep() : 0)
          beginGesture()
        }}
        onTransform={() => {
          // live-commit position + rotation (3D follows); size only at the end
          const nodes = trRef.current?.nodes() ?? []
          const spin = spinsInPlace(anchorRef.current, nodes.length)
          // `spin` is not the same question: it is false for a MULTI-selection
          // rotate, which orbits round the group centre and so does write a
          // position — but still snaps.
          const rotating = anchorRef.current === 'rotater'
          const step = rotating ? snapStep() : 0
          applySnaps(step)
          for (const node of nodes) {
            const id = node.id()
            if (!spin) setPosition(id, { x: node.x(), y: node.y() })
            setRotation(id, snapAngle(node.rotation(), step))
          }
          if (nodes.length === 1) publishReadout(nodes[0], rotating, step)
        }}
        onTransformEnd={() => {
          const nodes = trRef.current?.nodes() ?? []
          const spin = spinsInPlace(anchorRef.current, nodes.length)
          const step = anchorRef.current === 'rotater' ? snapStep() : 0
          for (const node of nodes) {
            const id = node.id()
            const obj = useEditorStore.getState().scene.objects[id]
            if (!obj) continue
            const scaleX = node.scaleX()
            const scaleY = node.scaleY()
            node.scale({ x: 1, y: 1 })
            if (!spin) setPosition(id, { x: node.x(), y: node.y() })
            setRotation(id, snapAngle(node.rotation(), step))
            if (scaleX !== 1 || scaleY !== 1) {
              setSize(id, {
                width: obj.size.width * Math.abs(scaleX),
                depth: obj.size.depth * Math.abs(scaleY),
              })
            }
          }
          anchorRef.current = null
          // leave nothing armed: the next gesture asks for the step itself, and a
          // stale snap array would quantise a drag nobody held Shift for
          applySnaps(0)
          overlay.setGesture(null)
          endGesture()
        }}
      />
    </Layer>
  )
}
