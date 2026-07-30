import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  Filter,
  Lock,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import {
  CATEGORY_ORDER,
  getCatalogEntry,
  hasCatalogEntry,
  listByCategory,
  listCatalog,
} from '../core/catalog/registry'
import type { CatalogEntry, Category } from '../core/catalog/types'
import { editableSlotsOf, slotColor, slotTextureId } from '../core/catalog/types'
import { FABRIC_TEXTURE_IDS } from '../core/catalog/textures'
import { maxGapForSeats, maxSeatsForEntry } from '../core/layout/seatLayout'
import type { LightingMode, SceneObject, ShadowSharpness } from '../core/model/types'
import { composeTransform, relativeTransform } from '../core/space'
import { displayName } from '../editor2d/ObjectNode'
import { overlay, useOverlayStore } from '../editor2d/overlayStore'
import { getVenuePack } from '../core/venuePacks'
import { hangRange } from '../core/layout/beams'
import {
  addSeatItemsToTable,
  alignObjects,
  distributeObjects,
  removeObjects,
  removeSeatItems,
  seatItems,
  select,
  setAppearance,
  setElevation,
  setLocked,
  setLighting,
  setPosition,
  setProjectName,
  setRotation,
  setSeatCount,
  setSeatingConfig,
  setSize,
  setSlotTexture,
} from '../state/actions'
import { categoryOf, isEffectivelyLocked, isFrozen, lightingOf, sceneCounts } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { useShallow } from 'zustand/react/shallow'
import { LIGHTING_MODES } from '../viewer3d/lightingModes'
import { ColorField, FieldRow, NumberField, Section, SliderField, Stepper, TextureField } from './fields'
import { LayersSection } from './LayersSection'
import {
  HallLayoutsSection,
  SaveSelectionSection,
  ScenePresetsSection,
  TableDesignHintSection,
  TableDesignSection,
} from './PresetsSection'
import { strings } from './strings'

const T = strings.inspector

/** Read-only info line — the hall is fixed (dims are set at project creation). */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[14px] text-ink-soft">{label}</span>
      <span className="ltr-nums text-[14px] font-medium text-ink">{value}</span>
    </div>
  )
}

/** Slider index → value. Explicit, because the union has no ordering of its own. */
const SHARPNESS_STEPS: ShadowSharpness[] = ['soft', 'medium', 'sharp']

/**
 * Shadow sharpness — a three-stop slider, since each stop is one shadow-map size
 * (viewer3d/LightingRig SHADOW_MAP_SIZES) and nothing in between exists.
 *
 * Local rather than `SliderField` because that one prints the raw number where
 * this needs the stop's name: the readout would otherwise read "0 / 1 / 2",
 * which means nothing to the user. Same markup and classes as `SliderField`
 * apart from that one span, so it sits flush with the three sun sliders — minus
 * `ltr-nums`, which forces LTR + mono and would mangle a Hebrew word.
 */
function ShadowSharpnessField({
  value,
  onChange,
}: {
  value: ShadowSharpness
  onChange: (v: ShadowSharpness) => void
}) {
  const L = strings.lighting
  const stopLabels: Record<ShadowSharpness, string> = {
    soft: L.shadowSharpnessLow,
    medium: L.shadowSharpnessMedium,
    sharp: L.shadowSharpnessHigh,
  }
  return (
    <div>
      <span className="mb-1.5 block text-[14px] text-ink-soft">{L.shadows}</span>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[14px] text-ink-soft">{L.shadowSharpness}</span>
        <span className="text-[14px] font-medium text-ink">{stopLabels[value]}</span>
      </div>
      <input
        dir="ltr"
        type="range"
        min={0}
        max={2}
        step={1}
        value={SHARPNESS_STEPS.indexOf(value)}
        onChange={(e) => onChange(SHARPNESS_STEPS[Number(e.target.value)])}
        className="w-full accent-accent"
        aria-label={L.shadowSharpness}
      />
      <p className="mt-1 text-[13px] text-ink-soft">{L.shadowSharpnessHint}</p>
    </div>
  )
}

/** Outdoor lighting: mode chips + sun steering. Picking a mode resets the sun
 *  to that mode's canonical stance; the sliders then steer off it. */
function LightingSection() {
  const lighting = useEditorStore((s) => lightingOf(s.scene))
  const L = strings.lighting
  const modes: { id: LightingMode; label: string }[] = [
    { id: 'day', label: L.day },
    { id: 'sunset', label: L.sunset },
    { id: 'night', label: L.night },
  ]
  const pickMode = (id: LightingMode) => {
    const sun = LIGHTING_MODES[id].sun
    setLighting({ mode: id, sunAzimuth: sun.azimuth, sunElevation: sun.elevation, sunIntensity: sun.intensity })
  }
  return (
    <Section title={L.title}>
      <div className="flex gap-1">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={lighting.mode === m.id}
            onClick={() => pickMode(m.id)}
            className={
              'min-h-9 flex-1 rounded-md border px-2 py-1.5 text-[14px] transition-colors ' +
              (lighting.mode === m.id
                ? 'border-accent bg-accent text-white'
                : 'border-line text-ink-soft hover:border-accent hover:text-accent')
            }
          >
            {m.label}
          </button>
        ))}
      </div>
      <SliderField label={L.sunAzimuth} value={lighting.sunAzimuth} min={0} max={360} unit="°" onChange={(v) => setLighting({ sunAzimuth: v })} />
      <SliderField label={L.sunElevation} value={lighting.sunElevation} min={10} max={90} unit="°" onChange={(v) => setLighting({ sunElevation: v })} />
      <SliderField label={L.sunIntensity} value={lighting.sunIntensity} min={0} max={2} step={0.05} onChange={(v) => setLighting({ sunIntensity: v })} />
      {/* Read with a fallback and never written on mount: absent already renders
          as 'medium' (= the 4096 the rig always used), so materialising it here
          would dirty every project that opens without changing a pixel. */}
      <ShadowSharpnessField
        value={lighting.shadowSharpness ?? 'medium'}
        onChange={(v) => setLighting({ shadowSharpness: v })}
      />
    </Section>
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
            className="min-h-9 w-40 rounded-md border border-line bg-panel px-2 py-1.5 text-[14px] focus:border-accent focus:outline-none"
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
        <p className="text-[14px] text-ink-soft">
          <span className="ltr-nums">{counts.tables}</span> {strings.statusBar.tables} ·{' '}
          <span className="ltr-nums">{counts.chairs}</span> {strings.statusBar.chairs} ·{' '}
          <span className="ltr-nums">{counts.seats}</span> {strings.statusBar.seats}
        </p>
      </Section>
      <LightingSection />
      <HallLayoutsSection />
      <ScenePresetsSection />
      <TableDesignHintSection />
      <LayersSection />
    </>
  )
}

export function SeatingSection({ obj }: { obj: SceneObject }) {
  if (!obj.seating) return null
  const entry = getCatalogEntry(obj.catalogId)
  const cap = entry.seating
  if (!cap) return null
  const chairEntry = getCatalogEntry(obj.seating.chairCatalogId)
  const max = Math.min(
    cap.max,
    maxSeatsForEntry(entry, obj.size, obj.seating, chairEntry.defaultSize),
  )
  const chairModels = listByCategory('seating')
  // Capacity is a step function of gap with narrow steps (the 160 square seats 12
  // at gap 8 and 8 at gap 9), so a free 0–60 field could delete four chairs on one
  // nudge. Cap it at whatever still seats the table's default count.
  const gapMax = maxGapForSeats(
    entry,
    obj.size,
    obj.seating,
    chairEntry.defaultSize,
    cap.defaultCount,
  )

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
        max={gapMax}
        onCommit={(v) => setSeatingConfig(obj.id, { gap: v })}
      />
      <FieldRow label={T.chairModel}>
        <select
          className="min-h-9 w-36 rounded-md border border-line bg-panel px-2 py-1.5 text-[14px] focus:border-accent focus:outline-none"
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
    </Section>
  )
}

/** Catalog items laid one-per-seat — today only the resort's place setting. */
const seatItemEntries = () => listCatalog().filter((entry) => entry.placement === 'seat')

/**
 * Source doc §17 — direct control over the place settings on a table. Until now
 * the only way to lay them was to drop the item from the library onto the table
 * and the only way to see how many were laid was to count them.
 */
export function PlaceSettingsSection({ obj }: { obj: SceneObject }) {
  // .length, not the array: seatItems() builds a new array every call, and a
  // selector whose snapshot changes identity on every render loops forever
  const laid = useEditorStore((s) => seatItems(s.scene, obj.id).length)
  const locked = useEditorStore((s) => {
    const o = s.scene.objects[obj.id]
    return !!o && isEffectivelyLocked(s.scene, o)
  })
  const entries = seatItemEntries()
  const [catalogId, setCatalogId] = useState(entries[0]?.id ?? '')
  const P = strings.presets
  if (!obj.seating || !entries.length) return null
  const seats = obj.seating.count
  const active = laid > 0

  return (
    <Section title={P.placeSettings}>
      <p className="text-[14px] text-ink-soft">
        {active ? <span className="ltr-nums">{P.placeSettingsCount(laid, seats)}</span> : P.placeSettingsOff}
      </p>
      {entries.length > 1 && (
        <FieldRow label={P.placeSettingsType}>
          <select
            className="min-h-9 w-36 rounded-md border border-line bg-panel px-2 py-1.5 text-[14px] focus:border-accent focus:outline-none"
            value={catalogId}
            onChange={(e) => setCatalogId(e.target.value)}
          >
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {strings.catalog.items[entry.labelKey as keyof typeof strings.catalog.items]}
              </option>
            ))}
          </select>
        </FieldRow>
      )}
      <div className="flex gap-1.5">
        <button
          className="min-h-9 flex-1 rounded-md border border-line px-3 py-1.5 text-[14px] font-medium text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:text-ink-soft/40"
          disabled={locked}
          title={locked ? P.designLocked : undefined}
          onClick={() => addSeatItemsToTable(catalogId, obj.id)}
        >
          {P.placeSettingsAdd}
        </button>
        {active && (
          <button
            className="min-h-9 flex-1 rounded-md border border-line px-3 py-1.5 text-[14px] text-ink-soft hover:border-danger hover:text-danger"
            onClick={() => removeSeatItems(obj.id)}
          >
            {P.placeSettingsRemove}
          </button>
        )}
      </div>
    </Section>
  )
}

/**
 * Inspector for a drilled-in child: an attached chair, or a decor item standing on
 * a table top (`SingleInspector` routes everything with a `parentId` here).
 *
 * Source doc §49 asks for three things on a selected chair — no name field, a way
 * to change the chair TYPE, and position + rotation. §51 generalises the first to
 * every item, so the name is printed rather than edited (see `SingleInspector`).
 *
 * The type control differs by what the child IS, and both halves come from the same
 * rule in `actions.ts`:
 *
 * - a CHAIR is owned by `reconcileSeats`, which rewrites `catalogId` back to the
 *   table's `seating.chairCatalogId` on the next reconcile — so swapping one chair
 *   alone cannot stick, and `canReplaceObject` refuses it (`attachment.kind` is
 *   'seat', not 'surface'). The honest control is the table's own chair model,
 *   which is what `strings.inspector.chairType` was seeded to say.
 * - a DECOR child is swappable one at a time, so it gets the same `ReplaceButton`
 *   the top-level inspector offers.
 */
function ChairInspector({ obj }: { obj: SceneObject }) {
  const entry = hasCatalogEntry(obj.catalogId) ? getCatalogEntry(obj.catalogId) : null
  const parent = useEditorStore((s) => (obj.parentId ? s.scene.objects[obj.parentId] : null))
  const locked = useEditorStore((s) => {
    const o = s.scene.objects[obj.id]
    return !!o && isEffectivelyLocked(s.scene, o)
  })
  if (!entry) return null
  const world = parent ? composeTransform(parent.transform, obj.transform) : obj.transform
  const parentName = parent ? displayName(parent.name, parent.catalogId, parent.meta.number) : ''
  const isChair = obj.attachment?.kind === 'seat'
  // A child's transform is PARENT-RELATIVE while these fields read world cm, so a
  // typed X has to be converted back. `relativeTransform` is `composeTransform`'s
  // exact inverse — declared as such in space.ts, and space.test.ts round-trips it —
  // so this is the conversion the file already owns, not a new one written here.
  const setWorldPos = (position: { x: number; y: number }) =>
    setPosition(obj.id, parent ? relativeTransform(parent.transform, { ...world, position }).position : position)

  return (
    <>
      <Section title={T.name}>
        <p className="text-[15px] font-semibold text-ink">
          {displayName(obj.name, obj.catalogId, obj.meta.number)}
        </p>
      </Section>
      <Section title={T.transform}>
        <NumberField
          label={T.posX}
          value={world.position.x}
          unit="m"
          onCommit={(v) => setWorldPos({ x: v, y: world.position.y })}
        />
        <NumberField
          label={T.posY}
          value={world.position.y}
          unit="m"
          onCommit={(v) => setWorldPos({ x: world.position.x, y: v })}
        />
        <NumberField
          label={T.rotation}
          value={obj.transform.rotation}
          unit="deg"
          onCommit={(v) => setRotation(obj.id, v)}
        />
        {!locked && isChair && parent?.seating && (
          <FieldRow label={T.chairType}>
            <select
              className="min-h-9 w-36 rounded-md border border-line bg-panel px-2 py-1.5 text-[14px] focus:border-accent focus:outline-none"
              value={parent.seating.chairCatalogId}
              onChange={(e) => setSeatingConfig(parent.id, { chairCatalogId: e.target.value })}
            >
              {listByCategory('seating').map((c) => (
                <option key={c.id} value={c.id}>
                  {strings.catalog.items[c.labelKey as keyof typeof strings.catalog.items]}
                </option>
              ))}
            </select>
          </FieldRow>
        )}
        {!locked && !isChair && <ReplaceButton id={obj.id} />}
      </Section>
      <AppearanceSection obj={obj} entry={entry} />
      <Section title={obj.attachment?.kind === 'surface' ? strings.drill.decor : strings.drill.chair}>
        <p className="text-[14px] text-ink-soft">
          {T.belongsTo} <span className="font-semibold text-ink">{parentName}</span>
        </p>
      </Section>
    </>
  )
}

/**
 * The Appearance section: one colour palette, and one texture picker beside it,
 * per slot the catalogue lets the user restyle.
 *
 * ONE COMPONENT, rendered from BOTH inspectors. The top-level inspector and the
 * drilled-in child inspector each carried their own copy of this block, character
 * for character, and each read a single `entry.editableColorSlot`. Round 4 turned
 * that field into a LIST and added a second control to every row, so two copies
 * would have been two places to forget the picker — and the child inspector is the
 * one a napkin is edited from, which is where the defaults live.
 *
 * The slot label falls back to the raw slot name: `strings.catalog.slots` is
 * indexed by `labelKey`, and a new slot whose key has no Hebrew string yet must
 * show something rather than `undefined`.
 */
function AppearanceSection({ obj, entry }: { obj: SceneObject; entry: CatalogEntry }) {
  const slots = editableSlotsOf(entry)
  if (slots.length === 0) return null
  return (
    <Section title={T.appearance}>
      {slots.map((editable) => {
        const def = entry.materialSlots.find((s) => s.name === editable.slot)
        const label =
          strings.catalog.slots[def?.labelKey as keyof typeof strings.catalog.slots] ?? editable.slot
        return (
          <div key={editable.slot} className="flex flex-col gap-2.5">
            <ColorField
              label={label}
              value={slotColor(entry, obj.appearance, editable.slot)}
              allowCustom={def?.allowCustomColor}
              onChange={(c) => setAppearance([obj.id], editable.slot, c)}
            />
            {editable.texture && (
              <TextureField
                label={T.texture}
                options={FABRIC_TEXTURE_IDS}
                value={slotTextureId(entry, obj.appearance, editable.slot)}
                noneLabel={T.textureNone}
                onChange={(id) => setSlotTexture([obj.id], editable.slot, id)}
              />
            )}
          </div>
        )
      })}
    </Section>
  )
}

/**
 * "Replace this item" — the same armed mode the library button drives, offered
 * here and in the canvas context menu so it is reachable from wherever the user
 * already is (source doc §24). The library is what disarms it, by being clicked.
 */
function ReplaceButton({ id }: { id: string }) {
  const armed = useOverlayStore((s) => s.replaceTarget === id)
  return (
    <button
      type="button"
      aria-pressed={armed}
      onClick={() => overlay.setReplaceTarget(armed ? null : id)}
      className={
        'flex min-h-9 w-full items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[14px] transition-colors ' +
        (armed
          ? 'border-accent bg-accent text-white'
          : 'border-line text-ink-soft hover:border-accent hover:text-accent')
      }
    >
      <RefreshCw size={14} />
      {armed ? T.replaceItemActive : T.replaceItem}
    </button>
  )
}

/**
 * Drop height for a ceiling fixture (source doc §13). The top of the range is the
 * truss line itself; the bottom is 4 m below it. The 3D view draws a cord across
 * whatever gap the drop opens up.
 */
export function HangingSection({ obj }: { obj: SceneObject }) {
  const venue = useEditorStore((s) => s.scene.venue)
  const range = hangRange(getVenuePack(venue.venuePackId), venue.wallHeight, obj.size.height)
  return (
    <Section title={T.hanging}>
      <SliderField
        label={T.hangHeight}
        value={Math.round(obj.transform.elevation) / 100}
        min={Math.round(range.min) / 100}
        max={Math.round(range.max) / 100}
        step={0.05}
        onChange={(v) => setElevation(obj.id, v * 100)}
      />
      <p className="text-[13px] text-ink-soft">{T.hangHint}</p>
    </Section>
  )
}

/**
 * A baked venue fixture (source doc §16): read-only by construction. No name
 * field, no transform fields and above all no unlock button — `frozen` is the
 * flag the user cannot clear, which is what "לא יהיה אפשרות להסיר או להזיז"
 * actually requires.
 */
function FrozenInspector({ obj }: { obj: SceneObject }) {
  return (
    <Section title={displayName(obj.name, obj.catalogId, obj.meta.number)}>
      <div className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-[14px] text-warning">
        <Lock size={12} className="mt-1 shrink-0" />
        <span>{strings.presets.frozenNotice}</span>
      </div>
    </Section>
  )
}

function SingleInspector({ obj }: { obj: SceneObject }) {
  // layer lock has no per-object unlock button — reachable via 3D click or lock-while-selected
  const layerLocked = useEditorStore((s) => {
    const o = s.scene.objects[obj.id]
    return !!o && !o.flags.locked && !isFrozen(o) && isEffectivelyLocked(s.scene, o)
  })
  if (isFrozen(obj)) return <FrozenInspector obj={obj} />
  if (obj.parentId) return <ChairInspector obj={obj} />
  const entry = hasCatalogEntry(obj.catalogId) ? getCatalogEntry(obj.catalogId) : null
  if (!entry) return null
  const canW = entry.resizable.includes('width')
  const canD = entry.resizable.includes('depth') && !entry.linkWidthDepth
  const canH = entry.resizable.includes('height')

  return (
    <>
      <Section title={T.name}>
        {/* Source doc §51: an item's name is the catalog entry it came from, and
            that is all it will ever be — so it is printed, not typed. `setName`
            stays in actions.ts: the project name and JSON import still use it. */}
        <p className="text-[15px] font-semibold text-ink">
          {displayName(obj.name, obj.catalogId, obj.meta.number)}
        </p>
        {obj.flags.locked && (
          <div className="flex items-center justify-between rounded-md bg-warning/10 px-2 py-1.5 text-[14px] text-warning">
            <span className="flex items-center gap-1">
              <Lock size={12} /> {T.lockedNotice}
            </span>
            <button className="font-semibold hover:underline" onClick={() => setLocked([obj.id], false)}>
              {T.unlock}
            </button>
          </div>
        )}
        {layerLocked && (
          <div className="flex items-center gap-1 rounded-md bg-warning/10 px-2 py-1.5 text-[14px] text-warning">
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
        {!obj.flags.locked && !layerLocked && <ReplaceButton id={obj.id} />}
      </Section>
      {entry.placement === 'ceiling' && <HangingSection obj={obj} />}
      <SeatingSection obj={obj} />
      <PlaceSettingsSection obj={obj} />
      <TableDesignSection obj={obj} />
      <AppearanceSection obj={obj} entry={entry} />
    </>
  )
}

/**
 * Selection ids that carry no catalog entry at all. Not a `Category`, so it can
 * never collide with one.
 */
const UNCATEGORISED = '__uncategorised'

/**
 * How many of `ids` fall in each catalog category.
 *
 * An object whose `catalogId` is missing from the registry has NO category
 * (`categoryOf` → null) and is counted under `UNCATEGORISED`, which deliberately
 * gets no row: `strings.ts` has no label for it, and an unnamed checkbox is worse
 * than no checkbox. Such objects are therefore always KEPT by the filter — it must
 * never drop something the user was never shown a control for.
 *
 * Flat `Record<string, number>` on purpose: it is read through `useShallow`, and a
 * nested snapshot would fail the shallow compare on every render and loop (same
 * trap `PlaceSettingsSection` above documents).
 */
function countSelectionByCategory(
  objects: Record<string, SceneObject>,
  ids: string[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id of ids) {
    const obj = objects[id]
    if (!obj) continue // selection can outlive an object for a render after a delete
    const key = categoryOf(obj) ?? UNCATEGORISED
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

/**
 * Source doc §25 — Ctrl+A selects everything visible, which is almost never the set
 * the user meant to act on. This narrows that selection by catalog CATEGORY: the
 * same categorisation `LayersSection` shows, so the two panels can never disagree
 * about what "a category" is.
 *
 * Rows come from the SELECTION, not from `CATEGORY_ORDER` whole — offering twelve
 * categories to narrow a selection of three chairs is noise. Ticked means KEPT,
 * which is what the seeded hint ("סמנו קטגוריות כדי לצמצם את הבחירה") describes,
 * so the resting state is nothing ticked and Apply disabled.
 *
 * The ticked set is transient UI state: it is not part of the scene, so it is
 * neither stored nor undoable. It resets by REMOUNT — `MultiInspector` keys this
 * component off the selection — rather than by a `useEffect` synchronising a set
 * against a prop.
 */
function SelectionFilter({ ids }: { ids: string[] }) {
  const counts = useEditorStore(useShallow((s) => countSelectionByCategory(s.scene.objects, ids)))
  const objects = useEditorStore((s) => s.scene.objects)
  const [checked, setChecked] = useState<Set<Category>>(new Set())

  const rows = CATEGORY_ORDER.filter((c) => (counts[c] ?? 0) > 0)
  // Under two rows the filter is provably a no-op: uncategorised items are always
  // kept, so ticking the single row yields the selection it started from.
  if (rows.length < 2) return null

  const toggle = (cat: Category) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (!next.delete(cat)) next.add(cat)
      return next
    })

  const kept = ids.filter((id) => {
    const obj = objects[id]
    if (!obj) return false
    const cat = categoryOf(obj)
    return cat ? checked.has(cat) : true // uncategorised: kept, see countSelectionByCategory
  })
  // Two separate reasons, both of which would make the click pointless or harmful:
  // nothing ticked is the resting state (and would empty the selection, unmounting
  // this panel mid-click), and a selection that survives whole is a no-op.
  const disabled = checked.size === 0 || kept.length === ids.length

  const chip =
    'min-h-9 flex-1 rounded-md border border-line px-2 py-1.5 text-[14px] text-ink-soft transition-colors hover:border-accent hover:text-accent'

  return (
    <Section title={T.selectionFilter}>
      <div data-testid="selection-filter" className="flex flex-col gap-2.5">
        <p className="text-[13px] text-ink-soft">{T.selectionFilterHint}</p>
        <div className="flex flex-col gap-1.5">
          {rows.map((cat) => (
            <label
              key={cat}
              data-testid={`selection-filter-row-${cat}`}
              className={
                'flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-[14px] transition-colors ' +
                (checked.has(cat)
                  ? 'border-accent text-accent'
                  : 'border-line text-ink-soft hover:border-accent hover:text-accent')
              }
            >
              <input
                type="checkbox"
                data-testid={`selection-filter-check-${cat}`}
                className="accent-accent"
                checked={checked.has(cat)}
                onChange={() => toggle(cat)}
              />
              <span>
                {strings.catalog.categories[cat]}{' '}
                <span className="ltr-nums text-[13px] text-ink-soft">({counts[cat]})</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            data-testid="selection-filter-all"
            className={chip}
            onClick={() => setChecked(new Set(rows))}
          >
            {T.selectionFilterAll}
          </button>
          <button
            type="button"
            data-testid="selection-filter-none"
            className={chip}
            onClick={() => setChecked(new Set())}
          >
            {T.selectionFilterNone}
          </button>
        </div>
        <button
          type="button"
          data-testid="selection-filter-apply"
          disabled={disabled}
          className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[14px] font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink"
          onClick={() => select(kept)}
        >
          <Filter size={13} />
          {T.selectionFilterApply}
        </button>
      </div>
    </Section>
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
      {/* keyed off the selection so a narrowed (or otherwise changed) selection
          remounts it, which resets the ticked set for free */}
      <SelectionFilter key={ids.join(',')} ids={ids} />
      <Section title={T.selectedCount(ids.length)}>
        <div>
          <span className="mb-1.5 block text-[14px] text-ink-soft">{T.align}</span>
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
          <span className="mb-1.5 block text-[14px] text-ink-soft">{T.distribute}</span>
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
          className="mt-1 flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-danger/40 px-3 py-1.5 text-[14px] text-danger hover:bg-danger/10"
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
  // a fixture is venue, not event — saving it as a personal layout is meaningless
  const savable = useEditorStore((s) =>
    s.selection.some((id) => s.scene.objects[id] && !isFrozen(s.scene.objects[id])),
  )

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-e border-line bg-panel 2xl:w-96">
      {savable && <SaveSelectionSection />}
      {selection.length === 0 && <ProjectInspector />}
      {selection.length === 1 && first && <SingleInspector obj={first} />}
      {selection.length > 1 && <MultiInspector ids={selection} />}
    </aside>
  )
}
