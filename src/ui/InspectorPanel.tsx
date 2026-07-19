import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  Lock,
  Trash2,
} from 'lucide-react'
import { getCatalogEntry, hasCatalogEntry, listByCategory } from '../core/catalog/registry'
import { slotColor } from '../core/catalog/types'
import { computeMaxSeats } from '../core/layout/seatLayout'
import { attachedChairs } from '../core/model/seatingReconciler'
import type { SceneObject } from '../core/model/types'
import { composeTransform } from '../core/space'
import { displayName } from '../editor2d/ObjectNode'
import { getVenuePack } from '../core/venuePacks'
import {
  alignObjects,
  detachAllChairs,
  detachChair,
  distributeObjects,
  removeObjects,
  setAppearance,
  setChairAppearance,
  setLocked,
  setName,
  setPosition,
  setProjectName,
  setRotation,
  setSeatCount,
  setSeatingConfig,
  setSize,
} from '../state/actions'
import { isEffectivelyLocked, sceneCounts } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { useShallow } from 'zustand/react/shallow'
import { ColorField, FieldRow, NumberField, Section, Stepper } from './fields'
import { LayersSection } from './LayersSection'
import { strings } from './strings'

const T = strings.inspector

/** Read-only info line — the hall is fixed (dims are set at project creation). */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-ink-soft">{label}</span>
      <span className="ltr-nums text-[12px] font-medium text-ink">{value}</span>
    </div>
  )
}

function ProjectInspector() {
  const projectName = useEditorStore((s) => s.projectName)
  const venue = useEditorStore((s) => s.scene.venue)
  const counts = useEditorStore(useShallow((s) => sceneCounts(s.scene)))
  const pack = getVenuePack(venue.venuePackId)
  const m = (cm: number) => String(Math.round(cm) / 100)

  return (
    <>
      <Section title={T.projectTitle}>
        <FieldRow label={T.projectName}>
          <input
            className="w-36 rounded-md border border-line bg-panel px-2 py-1 text-[12px] focus:border-accent focus:outline-none"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </FieldRow>
      </Section>
      <Section title={T.venue}>
        {pack && <InfoRow label={T.venueName} value={pack.name} />}
        <InfoRow label={T.venueDims} value={`${m(venue.size.width)} × ${m(venue.size.depth)} מ׳`} />
        <InfoRow label={T.wallHeightInfo} value={`${m(venue.wallHeight)} מ׳`} />
      </Section>
      <Section title={T.summary}>
        <p className="text-[12px] text-ink-soft">
          <span className="ltr-nums">{counts.tables}</span> {strings.statusBar.tables} ·{' '}
          <span className="ltr-nums">{counts.chairs}</span> {strings.statusBar.chairs} ·{' '}
          <span className="ltr-nums">{counts.seats}</span> {strings.statusBar.seats}
        </p>
      </Section>
      <LayersSection />
    </>
  )
}

function SeatingSection({ obj }: { obj: SceneObject }) {
  // reflect the actual chairs' colors, not just the catalog defaults
  const firstChair = useEditorStore((s) => attachedChairs(s.scene, obj.id)[0] ?? null)
  if (!obj.seating) return null
  const entry = getCatalogEntry(obj.catalogId)
  const cap = entry.seating
  if (!cap) return null
  const chairEntry = getCatalogEntry(obj.seating.chairCatalogId)
  const max = Math.min(
    cap.max,
    computeMaxSeats(entry.footprint(obj.size).outline, obj.seating, chairEntry.defaultSize),
  )
  const chairModels = listByCategory('seating')

  return (
    <Section title={T.seating}>
      <Stepper
        label={T.seats}
        value={obj.seating.count}
        min={cap.min}
        max={max}
        hint={`${T.maxSeats} ${max} לשולחן בגודל זה`}
        onChange={(v) => setSeatCount(obj.id, v)}
      />
      <NumberField
        label={T.spacing}
        value={obj.seating.gap}
        unit="cm"
        min={0}
        max={60}
        onCommit={(v) => setSeatingConfig(obj.id, { gap: v })}
      />
      <FieldRow label={T.chairModel}>
        <select
          className="w-32 rounded-md border border-line bg-panel px-1.5 py-1 text-[12px] focus:border-accent focus:outline-none"
          value={obj.seating.chairCatalogId}
          onChange={(e) => setSeatingConfig(obj.id, { chairCatalogId: e.target.value })}
        >
          {chairModels.map((c) => (
            <option key={c.id} value={c.id}>
              {strings.catalog.items[c.labelKey as keyof typeof strings.catalog.items]}
            </option>
          ))}
        </select>
      </FieldRow>
      {chairEntry.materialSlots.map((slot) => (
        <ColorField
          key={slot.name}
          label={`${strings.catalog.slots[slot.labelKey as keyof typeof strings.catalog.slots]} (כיסאות)`}
          value={firstChair?.appearance[slot.name]?.color ?? slot.defaultColor}
          onChange={(c) => setChairAppearance(obj.id, slot.name, c)}
        />
      ))}
      {obj.seating.count > 0 && (
        <button
          className="mt-1 rounded-md border border-line px-2 py-1.5 text-[12px] text-ink-soft hover:border-danger hover:text-danger"
          onClick={() => detachAllChairs(obj.id)}
        >
          {T.detachAll}
        </button>
      )}
    </Section>
  )
}

/** Inspector for a drilled-in attached chair (parentId set). */
function ChairInspector({ obj }: { obj: SceneObject }) {
  const entry = hasCatalogEntry(obj.catalogId) ? getCatalogEntry(obj.catalogId) : null
  const parent = useEditorStore((s) => (obj.parentId ? s.scene.objects[obj.parentId] : null))
  if (!entry) return null
  const world = parent ? composeTransform(parent.transform, obj.transform) : obj.transform
  const parentName = parent ? displayName(parent.name, parent.catalogId, parent.meta.number) : ''
  const fmt = (cm: number) => (Math.round(cm) / 100).toFixed(2)

  return (
    <>
      <Section title={T.name}>
        <input
          className="w-full rounded-md border border-line bg-panel px-2 py-1 text-[13px] font-semibold focus:border-accent focus:outline-none"
          value={obj.name || displayName(obj.name, obj.catalogId, obj.meta.number)}
          onChange={(e) => setName(obj.id, e.target.value)}
        />
      </Section>
      <Section title={T.transform}>
        <FieldRow label={T.posX}>
          <span className="ltr-nums w-24 text-end text-[12px] text-ink-soft">{fmt(world.position.x)}</span>
        </FieldRow>
        <FieldRow label={T.posY}>
          <span className="ltr-nums w-24 text-end text-[12px] text-ink-soft">{fmt(world.position.y)}</span>
        </FieldRow>
        <NumberField
          label={T.rotation}
          value={obj.transform.rotation}
          unit="deg"
          onCommit={(v) => setRotation(obj.id, v)}
        />
      </Section>
      <Section title={T.appearance}>
        {entry.materialSlots.map((slot) => (
          <ColorField
            key={slot.name}
            label={strings.catalog.slots[slot.labelKey as keyof typeof strings.catalog.slots] ?? slot.name}
            value={slotColor(entry, obj.appearance, slot.name)}
            onChange={(c) => setAppearance([obj.id], slot.name, c)}
          />
        ))}
      </Section>
      <Section title={obj.attachment?.kind === 'surface' ? strings.drill.decor : strings.drill.chair}>
        <p className="text-[12px] text-ink-soft">
          {T.belongsTo} <span className="font-semibold text-ink">{parentName}</span>
        </p>
        {obj.attachment?.kind !== 'surface' && (
          <button
            className="mt-1 rounded-md border border-line px-2 py-1.5 text-[12px] text-ink-soft hover:border-danger hover:text-danger"
            onClick={() => detachChair(obj.id)}
          >
            {T.detachChair}
          </button>
        )}
      </Section>
    </>
  )
}

function SingleInspector({ obj }: { obj: SceneObject }) {
  // layer lock has no per-object unlock button — reachable via 3D click or lock-while-selected
  const layerLocked = useEditorStore((s) => {
    const o = s.scene.objects[obj.id]
    return !!o && !o.flags.locked && isEffectivelyLocked(s.scene, o)
  })
  if (obj.parentId) return <ChairInspector obj={obj} />
  const entry = hasCatalogEntry(obj.catalogId) ? getCatalogEntry(obj.catalogId) : null
  if (!entry) return null
  const canW = entry.resizable.includes('width')
  const canD = entry.resizable.includes('depth') && !entry.linkWidthDepth
  const canH = entry.resizable.includes('height')

  return (
    <>
      <Section title={T.name}>
        <input
          className="w-full rounded-md border border-line bg-panel px-2 py-1 text-[13px] font-semibold focus:border-accent focus:outline-none"
          value={obj.name || displayName(obj.name, obj.catalogId, obj.meta.number)}
          onChange={(e) => setName(obj.id, e.target.value)}
        />
        {obj.flags.locked && (
          <div className="flex items-center justify-between rounded-md bg-warning/10 px-2 py-1.5 text-[12px] text-warning">
            <span className="flex items-center gap-1">
              <Lock size={12} /> {T.lockedNotice}
            </span>
            <button className="font-semibold hover:underline" onClick={() => setLocked([obj.id], false)}>
              {T.unlock}
            </button>
          </div>
        )}
        {layerLocked && (
          <div className="flex items-center gap-1 rounded-md bg-warning/10 px-2 py-1.5 text-[12px] text-warning">
            <Lock size={12} /> {T.layerLockedNotice}
          </div>
        )}
      </Section>
      <Section title={T.transform}>
        <NumberField label={T.posX} value={obj.transform.position.x} unit="m" onCommit={(v) => setPosition(obj.id, { x: v, y: obj.transform.position.y })} />
        <NumberField label={T.posY} value={obj.transform.position.y} unit="m" onCommit={(v) => setPosition(obj.id, { x: obj.transform.position.x, y: v })} />
        <NumberField label={T.rotation} value={obj.transform.rotation} unit="deg" onCommit={(v) => setRotation(obj.id, v)} />
        {canW && (
          <NumberField
            label={entry.linkWidthDepth ? T.diameter : T.width}
            value={obj.size.width}
            unit="m"
            min={entry.minSize.width}
            max={entry.maxSize.width}
            onCommit={(v) => setSize(obj.id, { width: v })}
          />
        )}
        {canD && (
          <NumberField label={T.depth} value={obj.size.depth} unit="m" min={entry.minSize.depth} max={entry.maxSize.depth} onCommit={(v) => setSize(obj.id, { depth: v })} />
        )}
        {canH && (
          <NumberField label={T.height} value={obj.size.height} unit="m" min={entry.minSize.height} max={entry.maxSize.height} onCommit={(v) => setSize(obj.id, { height: v })} />
        )}
      </Section>
      <SeatingSection obj={obj} />
      <Section title={T.appearance}>
        {entry.materialSlots.map((slot) => (
          <ColorField
            key={slot.name}
            label={strings.catalog.slots[slot.labelKey as keyof typeof strings.catalog.slots] ?? slot.name}
            value={slotColor(entry, obj.appearance, slot.name)}
            onChange={(c) => setAppearance([obj.id], slot.name, c)}
          />
        ))}
      </Section>
    </>
  )
}

function MultiInspector({ ids }: { ids: string[] }) {
  const alignButtons = [
    { title: T.alignStart, icon: <AlignStartVertical size={15} />, run: () => alignObjects(ids, 'start') },
    { title: T.alignCenterX, icon: <AlignCenterVertical size={15} />, run: () => alignObjects(ids, 'centerX') },
    { title: T.alignEnd, icon: <AlignEndVertical size={15} />, run: () => alignObjects(ids, 'end') },
    { title: T.alignTop, icon: <AlignStartHorizontal size={15} />, run: () => alignObjects(ids, 'top') },
    { title: T.alignCenterY, icon: <AlignCenterHorizontal size={15} />, run: () => alignObjects(ids, 'centerY') },
    { title: T.alignBottom, icon: <AlignEndHorizontal size={15} />, run: () => alignObjects(ids, 'bottom') },
  ]
  return (
    <>
      <Section title={`${ids.length} ${T.itemsSelected}`}>
        <div>
          <span className="mb-1.5 block text-[12px] text-ink-soft">{T.align}</span>
          <div className="flex gap-1">
            {alignButtons.map((b) => (
              <button
                key={b.title}
                title={b.title}
                className="rounded-md border border-line p-1.5 text-ink-soft hover:border-accent hover:text-accent"
                onClick={b.run}
              >
                {b.icon}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1.5 block text-[12px] text-ink-soft">{T.distribute}</span>
          <div className="flex gap-1">
            <button
              title={T.distributeX}
              disabled={ids.length < 3}
              className="rounded-md border border-line p-1.5 text-ink-soft hover:border-accent hover:text-accent disabled:opacity-40"
              onClick={() => distributeObjects(ids, 'x')}
            >
              <AlignHorizontalSpaceBetween size={15} />
            </button>
            <button
              title={T.distributeY}
              disabled={ids.length < 3}
              className="rounded-md border border-line p-1.5 text-ink-soft hover:border-accent hover:text-accent disabled:opacity-40"
              onClick={() => distributeObjects(ids, 'y')}
            >
              <AlignVerticalSpaceBetween size={15} />
            </button>
          </div>
        </div>
        <button
          className="mt-1 flex items-center justify-center gap-1.5 rounded-md border border-danger/40 px-2 py-1.5 text-[12px] text-danger hover:bg-danger/10"
          onClick={() => removeObjects(ids)}
        >
          <Trash2 size={13} />
          {T.deleteSelected}
        </button>
      </Section>
    </>
  )
}

export function InspectorPanel() {
  const selection = useEditorStore((s) => s.selection)
  const first = useEditorStore((s) => (s.selection.length === 1 ? s.scene.objects[s.selection[0]] : null))

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-e border-line bg-panel">
      {selection.length === 0 && <ProjectInspector />}
      {selection.length === 1 && first && <SingleInspector obj={first} />}
      {selection.length > 1 && <MultiInspector ids={selection} />}
    </aside>
  )
}
