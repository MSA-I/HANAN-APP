import { useEffect, useMemo } from 'react'
import { Circle, Group, Image as KonvaImage, Rect, Text } from 'react-konva'
import { useShallow } from 'zustand/react/shallow'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { slotColor, type Outline } from '../core/catalog/types'
import { childSortKey, type Id } from '../core/model/types'
import { notify } from '../state/notice'
import {
  designEditTable,
  isArrangeableDecor,
  isCover,
  isDesignEditMuted,
  isEffectivelyLocked,
  isHoverable,
  isObjectVisible,
} from '../state/selectors'
import { useEditorStore } from '../state/store'
import { strings } from '../ui/strings'
import {
  onChildDblClick,
  onChildDragEnd,
  onChildDragMove,
  onChildDragStart,
  onChildMouseDown,
  onObjectClick,
  onObjectDblClick,
  onObjectDragEnd,
  onObjectDragMove,
  onObjectDragStart,
  onObjectMouseDown,
} from './dragController'
import { FootprintPartShape } from './footprintShapes'
import { isHoverSuppressed, overlay, useOverlayStore } from './overlayStore'
import { usePlanImage } from './planImage'

const STROKE = '#57534e'
const SELECTED_STROKE = '#3056d3'
/** the refusal colour the rest of the app already uses (OverlayLayer's GUIDE) */
const REFUSED_STROKE = '#d64545'
/**
 * How faint the hover ring is against the selection ring it previews.
 *
 * Same colour, same shape, same width — only opacity, and that is the whole point:
 * hover reads as "clicking would select this" rather than as a fourth state with a
 * vocabulary of its own. A new token here would be a new thing to learn.
 */
const HOVER_OPACITY = 0.45
/**
 * How far back the plan falls while one table is being edited (source doc §52).
 * Low enough to read as "not this", high enough to keep the neighbours as
 * context — the same intent as the lighting veil, one layer up.
 */
const DESIGN_EDIT_DIM = 0.22
/** screen-space (strokeScaleEnabled=false), so the pattern holds at every zoom */
const HANGING_DASH = [6, 4]

/**
 * The thin ring around an object: blue while it is selected, red on the sibling
 * a refused drag just ran into.
 *
 * Both answer to the `selection-visual` name because that is what the PNG
 * capture hides (Stage2D) — neither is part of the plan being exported.
 */
function OutlineRing({
  outline,
  stroke,
  opacity = 1,
}: {
  outline: Outline
  stroke: string
  opacity?: number
}) {
  const common = {
    name: 'selection-visual',
    stroke,
    strokeWidth: 1.75,
    strokeScaleEnabled: false,
    listening: false,
    fillEnabled: false,
    perfectDrawEnabled: false,
    opacity,
  }
  return outline.kind === 'circle' ? (
    <Circle {...common} radius={outline.r} />
  ) : (
    <Rect
      {...common}
      offsetX={outline.w / 2}
      offsetY={outline.h / 2}
      width={outline.w}
      height={outline.h}
    />
  )
}

function childIdsSelector(id: Id) {
  return (s: ReturnType<typeof useEditorStore.getState>) =>
    Object.values(s.scene.objects)
      .filter((o) => o.parentId === id && isObjectVisible(s.scene, o.id))
      .sort((a, b) => childSortKey(a) - childSortKey(b))
      .map((o) => o.id)
}

export function displayName(name: string, catalogId: string, number: unknown): string {
  if (name) return name
  const entry = hasCatalogEntry(catalogId) ? getCatalogEntry(catalogId) : null
  const label = entry ? (strings.catalog.items[entry.labelKey as keyof typeof strings.catalog.items] ?? entry.id) : catalogId
  return typeof number === 'number' ? `${label} ${number}` : label
}

interface ObjectNodeProps {
  id: Id
  /** attached children render inside the parent group and don't listen (v1) */
  isChild?: boolean
}

export function ObjectNode({ id, isChild = false }: ObjectNodeProps) {
  const obj = useEditorStore((s) => s.scene.objects[id])
  const isSelected = useEditorStore((s) => s.selection.includes(id))
  const showLabels = useEditorStore((s) => s.scene.settings.showLabels)
  const effectiveLocked = useEditorStore((s) => {
    const o = s.scene.objects[id]
    return !!o && isEffectivelyLocked(s.scene, o)
  })
  const childIds = useEditorStore(useShallow(useMemo(() => childIdsSelector(id), [id])))
  // Validated on read, never the raw field — see `designEditTable`. A primitive,
  // so a node only re-renders when the isolated table actually changes.
  const editTableId = useEditorStore((s) => designEditTable(s.scene, s.designEditTableId))
  // Live refusal naming THIS object as the piece that is in the way. A boolean
  // selector, so the other 350 nodes do not re-render when one of them is hit.
  const refused = useOverlayStore(
    (s) => s.violation?.kind === 'overlapsSibling' && s.violation.id === id,
  )
  // Same shape as `refused`, and for the same reason: a boolean selector means the
  // other 350 nodes do not re-render when the pointer crosses one of them.
  const hovered = useOverlayStore((s) => s.hoveredId === id && !isHoverSuppressed(s))

  const entry = obj && hasCatalogEntry(obj.catalogId) ? getCatalogEntry(obj.catalogId) : null
  const footprint = useMemo(
    () => (entry && obj ? entry.footprint(obj.size) : null),
    [entry, obj],
  )

  // Same value ObjectGroup hands the 3D model (ObjectGroup.tsx:303), where three
  // multiplies the base texture by it — the 2D image is tinted the same way, or
  // the two views disagree on the colour the user just picked.
  const planColor = entry?.editableColorSlot
    ? (obj?.appearance[entry.editableColorSlot]?.color ?? null)
    : null
  const plan = usePlanImage(entry?.model, planColor)

  // Deleting the object under the pointer unmounts this node without ever firing
  // a mouseleave, and a `hoveredId` naming a gone object leaves the canvas wearing
  // the `move` cursor over empty floor until the mouse happens to move.
  useEffect(() => (isChild ? undefined : () => overlay.clearHovered(id)), [id, isChild])

  if (!obj || !entry || !footprint) return null

  // 3D fits the GLB by size ÷ (modelSize ?? defaultSize) (propModel.ts), and the
  // top-down image spans a known number of cm OF THAT SAME GLB, so dividing by the
  // same denominator is what makes the two views land on one footprint. Reading
  // `modelSize` rather than restating the ratio means a re-measured GLB moves both
  // views together.
  const modelBasis = entry.modelSize ?? entry.defaultSize
  const planW = plan ? (plan.cmW * obj.size.width) / modelBasis.width : 0
  const planD = plan ? (plan.cmD * obj.size.depth) / modelBasis.depth : 0

  const showLabel = showLabels && entry.labelByDefault
  // base stroke never changes with selection — the highlight is a separate
  // '.selection-visual' node so exports can hide it imperatively
  const stroke = STROKE
  // Seen from above a chandelier is indistinguishable from a table, so the one
  // renderer exception for ceiling items: a dashed outline reading "overhead".
  const dash = entry.placement === 'ceiling' ? HANGING_DASH : undefined
  // An attached chair listens (for dbl-click drill-in) but is only draggable
  // once it is the drilled-in selection; otherwise events fall through to the table.
  const childSelected = isChild && isSelected
  // Design-edit isolation (source doc §52). Asked only of top-level nodes:
  // children live inside the parent's Konva group and inherit both its opacity
  // and its `listening`, so muting the group mutes the whole table at once.
  const muted = !isChild && isDesignEditMuted(editTableId, id)
  // Inside the edited table the decor IS the subject, so it is grabbable without
  // drilling in first. Restricted to surface decor: the chairs stay on their
  // drill-in path, or a stray press while arranging a centrepiece would drag a
  // chair off its seat.
  const inEditSession = isChild && editTableId !== null && obj.parentId === editTableId
  // …with the COVER carved back out (source doc §11). `isArrangeableDecor` is the
  // one home of that rule; viewer3d/ObjectGroup.tsx asks the same question of the
  // same object, or a place setting would be locked here and draggable in 3D.
  const editableDecor = inEditSession && isArrangeableDecor(obj)
  // A cover refuses the grab by BOTH routes, not just the mode's. Double-clicking
  // one opens the mode AND selects it (`onChildDblClick`), so `childSelected`
  // alone would hand back the very drag the line above just took away.
  const cover = isCover(obj)
  const childGrabbable = !cover && (childSelected || editableDecor)

  return (
    <Group
      id={id}
      name={isChild ? 'attached-object' : 'scene-object'}
      x={obj.transform.position.x}
      y={obj.transform.position.y}
      rotation={obj.transform.rotation}
      opacity={muted ? DESIGN_EDIT_DIM : 1}
      listening={isChild ? true : muted ? false : !effectiveLocked}
      draggable={isChild ? childGrabbable : !muted && !effectiveLocked}
      onMouseDown={(e) => {
        if (!isChild) return onObjectMouseDown(id, e)
        // Say why the press did nothing. Without this the cover is a dead spot on
        // the very table the user opened to arrange; with it, the gesture still
        // bubbles (onChildMouseDown returns early), so it behaves exactly like a
        // press on a chair — it moves the table, not the china.
        if (inEditSession && cover) notify(strings.editMode.placeSettingLocked)
        onChildMouseDown(id, childGrabbable, e)
      }}
      // Hover is a TOP-LEVEL question. Konva's enter/leave do not fire again when
      // the pointer crosses from a group onto its own child, so a chair or a
      // centrepiece keeps its table lit — which is honest, because pressing either
      // of them selects and drags the table, not the piece.
      onMouseEnter={
        isChild
          ? undefined
          : () => {
              // asked of the shared selector, never of three conditions restated
              // here: a hover ring the plan draws and 3D does not is exactly how
              // one locked chandelier ends up grabbable in one view and inert in
              // the other
              const s = useEditorStore.getState()
              if (isHoverable(s.scene, id, s.designEditTableId)) overlay.setHovered(id)
            }
      }
      onMouseLeave={isChild ? undefined : () => overlay.clearHovered(id)}
      onClick={isChild ? undefined : (e) => onObjectClick(id, e)}
      onDblClick={(e) => (isChild ? onChildDblClick(id, e) : onObjectDblClick(id, e))}
      onDragStart={(e) => (isChild ? onChildDragStart(id, e) : onObjectDragStart(id, e))}
      onDragMove={(e) => (isChild ? onChildDragMove(id, e) : onObjectDragMove(id, e))}
      onDragEnd={(e) => (isChild ? onChildDragEnd(id, e) : onObjectDragEnd(id, e))}
    >
      {/* hidden, not removed, when a plan image covers it: this is still the hit
          region and still the geometry snapping and collisions are built on */}
      {footprint.parts.map((part, i) => (
        <FootprintPartShape
          key={i}
          part={part}
          style={{
            fill: slotColor(entry, obj.appearance, part.slot),
            stroke,
            dash,
            opacity: plan ? 0 : 1,
          }}
        />
      ))}
      {plan && (
        <KonvaImage
          image={plan.image}
          width={planW}
          height={planD}
          offsetX={planW / 2}
          offsetY={planD / 2}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {isSelected && <OutlineRing outline={footprint.outline} stroke={SELECTED_STROKE} />}
      {/* A preview of the selection ring, drawn only when there is no real one to
          preview. `effectiveLocked`/`muted` are re-asked here because the object
          can be locked or the mode entered while the pointer sits still, and no
          mouseleave would ever arrive to take the promise back. */}
      {hovered && !isSelected && !effectiveLocked && !muted && (
        <OutlineRing
          outline={footprint.outline}
          stroke={SELECTED_STROKE}
          opacity={HOVER_OPACITY}
        />
      )}
      {/* Why the drag stopped, said on the canvas the user is looking at rather
          than only in the status bar: the piece that refused it goes red for as
          long as the refusal stands (cleared on drag end). */}
      {refused && <OutlineRing outline={footprint.outline} stroke={REFUSED_STROKE} />}
      {childIds.map((cid) => (
        <ObjectNode key={cid} id={cid} isChild />
      ))}
      {showLabel && (
        <Text
          text={displayName(obj.name, obj.catalogId, obj.meta.number)}
          rotation={-obj.transform.rotation}
          width={300}
          offsetX={150}
          offsetY={9}
          align="center"
          fontSize={18}
          fontFamily="Assistant, sans-serif"
          fontStyle="600"
          fill="#211e1b"
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  )
}
