import { useMemo } from 'react'
import { Circle, Group, Image as KonvaImage, Rect, Text } from 'react-konva'
import { useShallow } from 'zustand/react/shallow'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { slotColor } from '../core/catalog/types'
import { childSortKey, type Id } from '../core/model/types'
import { isEffectivelyLocked, isObjectVisible } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { strings } from '../ui/strings'
import {
  onChildDblClick,
  onChildDragEnd,
  onChildDragMove,
  onChildDragStart,
  onChildMouseDown,
  onObjectClick,
  onObjectDragEnd,
  onObjectDragMove,
  onObjectDragStart,
  onObjectMouseDown,
} from './dragController'
import { FootprintPartShape } from './footprintShapes'
import { usePlanImage } from './planImage'

const STROKE = '#57534e'
const SELECTED_STROKE = '#3056d3'
/** screen-space (strokeScaleEnabled=false), so the pattern holds at every zoom */
const HANGING_DASH = [6, 4]

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

  if (!obj || !entry || !footprint) return null

  // 3D fits the GLB by size/defaultSize × modelScale (propModel.ts:56-63) and the
  // image spans a known number of plan cm, so applying the same factor here is
  // what makes the two views land on the same footprint.
  const modelScale = entry.modelScale ?? 1
  const planW = plan ? (plan.cmW * obj.size.width * modelScale) / entry.defaultSize.width : 0
  const planD = plan ? (plan.cmD * obj.size.depth * modelScale) / entry.defaultSize.depth : 0

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

  return (
    <Group
      id={id}
      name={isChild ? 'attached-object' : 'scene-object'}
      x={obj.transform.position.x}
      y={obj.transform.position.y}
      rotation={obj.transform.rotation}
      listening={isChild ? true : !effectiveLocked}
      draggable={isChild ? childSelected : !effectiveLocked}
      onMouseDown={(e) => (isChild ? onChildMouseDown(id, childSelected, e) : onObjectMouseDown(id, e))}
      onClick={isChild ? undefined : (e) => onObjectClick(id, e)}
      onDblClick={isChild ? (e) => onChildDblClick(id, e) : undefined}
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
      {isSelected &&
        (footprint.outline.kind === 'circle' ? (
          <Circle
            name="selection-visual"
            radius={footprint.outline.r}
            stroke={SELECTED_STROKE}
            strokeWidth={1.75}
            strokeScaleEnabled={false}
            listening={false}
            fillEnabled={false}
            perfectDrawEnabled={false}
          />
        ) : (
          <Rect
            name="selection-visual"
            offsetX={footprint.outline.w / 2}
            offsetY={footprint.outline.h / 2}
            width={footprint.outline.w}
            height={footprint.outline.h}
            stroke={SELECTED_STROKE}
            strokeWidth={1.75}
            strokeScaleEnabled={false}
            listening={false}
            fillEnabled={false}
            perfectDrawEnabled={false}
          />
        ))}
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
