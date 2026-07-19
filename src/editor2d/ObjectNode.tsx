import { useMemo } from 'react'
import { Circle, Group, Rect, Text } from 'react-konva'
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

const STROKE = '#57534e'
const SELECTED_STROKE = '#3056d3'

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

  if (!obj || !entry || !footprint) return null

  const showLabel = showLabels && entry.labelByDefault
  // base stroke never changes with selection — the highlight is a separate
  // '.selection-visual' node so exports can hide it imperatively
  const stroke = STROKE
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
      {footprint.parts.map((part, i) =>
        part.kind === 'circle' ? (
          <Circle
            key={i}
            radius={part.r}
            fill={slotColor(entry, obj.appearance, part.slot)}
            stroke={stroke}
            strokeWidth={1}
            strokeScaleEnabled={false}
            perfectDrawEnabled={false}
          />
        ) : (
          <Rect
            key={i}
            x={part.cx ?? 0}
            y={part.cy ?? 0}
            offsetX={part.w / 2}
            offsetY={part.h / 2}
            width={part.w}
            height={part.h}
            cornerRadius={part.cornerRadius ?? 0}
            fill={slotColor(entry, obj.appearance, part.slot)}
            stroke={stroke}
            strokeWidth={1}
            strokeScaleEnabled={false}
            perfectDrawEnabled={false}
          />
        ),
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
