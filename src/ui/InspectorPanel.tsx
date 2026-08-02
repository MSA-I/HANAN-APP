import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  Copy,
  Filter,
  FlipHorizontal2,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
  Unlock,
} from 'lucide-react'
import { useMemo, useState } from 'react'
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
import type { LightingMode, SceneObject, ShadowSharpness } from '../core/model/types'
import { composeTransform, relativeTransform } from '../core/space'
import { displayName } from '../editor2d/ObjectNode'
import { overlay, useOverlayStore } from '../editor2d/overlayStore'
import { getVenuePack } from '../core/venuePacks'
import { hangRange } from '../core/layout/beams'
import { ROTATION_SNAP_DEG } from '../core/rotation'
import {
  addSeatItemsToTable,
  addSeatItemsToTables,
  addSeatsBy,
  alignObjects,
  distributeObjects,
  duplicateObjects,
  mirrorCopyObjects,
  mirrorObjects,
  removeObjects,
  removeSeatItems,
  removeSeatItemsFrom,
  rotateObjectsBy,
  seatItems,
  select,
  setAppearance,
  setChairModel,
  setElevation,
  setLocked,
  setLighting,
  setObjectsRotation,
  setPosition,
  setProjectName,
  setRotation,
  setSeatCount,
  setSeatingConfig,
  setSize,
  setSlotTexture,
} from '../state/actions'
import {
  categoryOf,
  isEffectivelyLocked,
  isFrozen,
  lightingOf,
  seatBounds,
  selectionEditing,
  type SelectionEditing,
  type SelectionSlot,
} from '../state/selectors'
import { useEditorStore } from '../state/store'
import { useShallow } from 'zustand/react/shallow'
import { LIGHTING_MODES } from '../viewer3d/lightingModes'
import {
  ColorField,
  CollapsibleSection,
  FieldRow,
  INSPECTOR_SECTION,
  NumberField,
  Section,
  SliderField,
  Stepper,
  SubHeading,
  TextureField,
} from './fields'
import { LayersSection } from './LayersSection'
import {
  BakeFixturesSection,
  HallDesignBlock,
  HallLayoutsSection,
  LightingLayoutsBlock,
  MultiTableDesignBlock,
  SaveSelectionSection,
  TableDesignBlock,
  TableDesignHintSection,
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
 * PLAN-05 C2 — "הצל לא עובד לטובתנו צריך לעשות כפתור שמכבה או מדליק את הצל".
 *
 * It carries `L.shadows` ('צללים') as its heading, which moved up here off
 * `ShadowSharpnessField`: the two controls are one block about one subject, and
 * a block wants one title. On/off comes first because sharpness is a refinement
 * of a thing that has to exist.
 *
 * Same `<input type="checkbox" className="accent-accent">` inside a `<label>` as
 * the selection filter further down this file — the panel's one checkbox idiom.
 */
function ShadowsToggleField({
  value,
  onChange,
}: {
  value: boolean
  onChange: (v: boolean) => void
}) {
  const L = strings.lighting
  return (
    <div>
      <span className="mb-1.5 block text-[14px] text-ink-soft">{L.shadows}</span>
      <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[14px] text-ink">
        <input
          type="checkbox"
          data-testid="shadows-enabled"
          className="accent-accent"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{L.shadowsOn}</span>
      </label>
      <p className="mt-1 text-[13px] text-ink-soft">{L.shadowsHint}</p>
    </div>
  )
}

/**
 * Shadow sharpness — a three-stop slider, since each stop is one shadow-map size
 * (viewer3d/LightingRig SHADOW_MAP_SIZES) and nothing in between exists.
 *
 * Local rather than `SliderField` because that one prints the raw number where
 * this needs the stop's name: the readout would otherwise read "0 / 1 / 2",
 * which means nothing to the user. Same markup and classes as `SliderField`
 * apart from that one span, so it sits flush with the three sun sliders — minus
 * `ltr-nums`, which forces LTR + mono and would mangle a Hebrew word.
 *
 * ⚠ `disabled` is not decoration. With the shadows toggle off this slider steers
 * the resolution of a map nothing samples, and a live control that changes
 * nothing reads as a broken one. The heading now lives on `ShadowsToggleField`.
 */
function ShadowSharpnessField({
  value,
  disabled,
  onChange,
}: {
  value: ShadowSharpness
  disabled?: boolean
  onChange: (v: ShadowSharpness) => void
}) {
  const L = strings.lighting
  const stopLabels: Record<ShadowSharpness, string> = {
    soft: L.shadowSharpnessLow,
    medium: L.shadowSharpnessMedium,
    sharp: L.shadowSharpnessHigh,
  }
  return (
    <div className={disabled ? 'opacity-45' : undefined}>
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
        disabled={disabled}
        value={SHARPNESS_STEPS.indexOf(value)}
        onChange={(e) => onChange(SHARPNESS_STEPS[Number(e.target.value)])}
        className="w-full accent-accent disabled:cursor-not-allowed"
        aria-label={L.shadowSharpness}
      />
      <p className="mt-1 text-[13px] text-ink-soft">{L.shadowSharpnessHint}</p>
    </div>
  )
}

/**
 * Every light in the hall, in one section instead of three.
 *
 * It used to be `תאורה חיצונית` (sun), then `פריסות תאורה` (ceiling fixtures)
 * two bands below it, then `פריסות תאורה אישיות` (saved fixture layouts) below
 * that — three separate places to look, two of them near-identically named.
 *
 * Inside, in the order someone actually reaches for them: the three mode chips
 * answer "make it look like evening" in one click, then the fixtures, then the
 * saved lighting layouts. The four expert sliders are NOT cut — each was a
 * specific request in an earlier round — they are demoted behind `כוונון עדין`,
 * closed, below the control that answers the question they were being used to
 * answer by hand.
 *
 * ⚠ The section's title is `lighting.title` = "תאורה חיצונית", which now names
 * only its first block. `strings.ts` is not this plan's file and has no plain
 * "תאורה"; logged in handoff/FOUND-X3.md.
 */
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
    <CollapsibleSection id={INSPECTOR_SECTION.lighting} title={L.title}>
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
      <SubHeading>{strings.presets.hallDesign}</SubHeading>
      <HallDesignBlock />
      <SubHeading>{strings.presets.lightingLayouts}</SubHeading>
      <LightingLayoutsBlock />
      <CollapsibleSection id={INSPECTOR_SECTION.lightingFine} title={T.lightingFine} nested>
        <SliderField label={L.sunAzimuth} value={lighting.sunAzimuth} min={0} max={360} unit="°" onChange={(v) => setLighting({ sunAzimuth: v })} />
        <SliderField label={L.sunElevation} value={lighting.sunElevation} min={10} max={90} unit="°" onChange={(v) => setLighting({ sunElevation: v })} />
        <SliderField label={L.sunIntensity} value={lighting.sunIntensity} min={0} max={2} step={0.05} onChange={(v) => setLighting({ sunIntensity: v })} />
        {/* Read with a fallback and never written on mount: absent already renders
            as 'medium' (= the 4096 the rig always used) and as shadows-on, so
            materialising either here would dirty every project that opens
            without changing a pixel. */}
        <ShadowsToggleField
          value={lighting.shadowsEnabled ?? true}
          onChange={(v) => setLighting({ shadowsEnabled: v })}
        />
        <ShadowSharpnessField
          value={lighting.shadowSharpness ?? 'medium'}
          disabled={!(lighting.shadowsEnabled ?? true)}
          onChange={(v) => setLighting({ shadowSharpness: v })}
        />
      </CollapsibleSection>
    </CollapsibleSection>
  )
}

/**
 * The panel with nothing selected.
 *
 * Order is the argument: whoever opens this app is seating 300 guests, so the
 * hall layouts come second, straight after the project's own identity. Placing
 * one chair by hand is not the entry point, and neither is a sun azimuth.
 *
 * WHAT WAS CUT: the `סיכום` section. It printed tables · chairs · seats from
 * `sceneCounts`, which is byte for byte what `StatusBar.tsx:114-120` prints from
 * the same selector, permanently, on every screen. One of the two was noise.
 */
function ProjectInspector() {
  const projectName = useEditorStore((s) => s.projectName)
  const venue = useEditorStore((s) => s.scene.venue)
  const pack = getVenuePack(venue.venuePackId)
  const m = (cm: number) => String(Math.round(cm) / 100)

  return (
    <>
      {/* project and venue were two sections and one border apart, and between
          them they are four read-mostly lines — its own title already said both */}
      <Section title={T.projectTitle}>
        <FieldRow label={T.projectName}>
          <input
            className="min-h-9 w-40 rounded-md border border-line bg-panel px-2 py-1.5 text-[14px] focus:border-accent focus:outline-none"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </FieldRow>
        {pack && <InfoRow label={T.venueName} value={pack.name} />}
        <InfoRow label={T.venueDims} value={`${m(venue.size.width)} × ${m(venue.size.depth)} מ׳`} />
        <InfoRow label={T.wallHeightInfo} value={`${m(venue.wallHeight)} מ׳`} />
      </Section>
      <HallLayoutsSection />
      {/* stays directly under the layout pickers — see BakeFixturesSection */}
      <BakeFixturesSection />
      <LightingSection />
      <TableDesignHintSection />
      <LayersSection />
    </>
  )
}

/**
 * ⚠ NAME, EXPORT AND `{ obj }` PROPS ARE A CONTRACT — `viewer3d/SelectionBar3D`
 * renders this component verbatim inside a 3D popover so that the seat caps
 * cannot differ between the two views.
 *
 * The caps come from `seatBounds` rather than being recomputed here. Same two
 * numbers, one implementation, and one guard this file did not have: an unknown
 * `seating.chairCatalogId` used to throw out of `getCatalogEntry` and take the
 * whole inspector down with it. Now the section simply does not render.
 */
export function SeatingSection({ obj }: { obj: SceneObject }) {
  // shallow: `seatBounds` builds a fresh record every call, and a snapshot whose
  // identity changes on every render loops forever
  const bounds = useEditorStore(useShallow((s) => seatBounds(s.scene, obj.id)))
  if (!obj.seating || !bounds) return null
  const chairModels = listByCategory('seating')

  return (
    <Section title={T.seating}>
      <Stepper
        label={T.seats}
        value={obj.seating.count}
        min={bounds.min}
        max={bounds.max}
        hint={`${T.maxSeats} ${bounds.max} לשולחן בגודל זה`}
        onChange={(v) => setSeatCount(obj.id, v)}
      />
      {/* Capacity is a step function of gap with narrow steps (the 160 square
          seats 12 at gap 8 and 8 at gap 9), so a free 0–60 field could delete
          four chairs on one nudge — hence `bounds.gapMax`. */}
      <NumberField
        label={T.spacing}
        value={obj.seating.gap}
        unit="cm"
        min={0}
        max={bounds.gapMax}
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

/**
 * The kinds of COVER the `סוג הערכה` dropdown may offer: the six place settings —
 * the original and the five that carry a napkin of their own.
 *
 * `!requiresHost` is what keeps the three loose napkins out. They are 'seat' items
 * too, so the filter used to be `placement === 'seat'` alone and the dropdown
 * listed eleven options of which six could never work: a napkin needs a cover
 * under it, and the button beside it answered `missingHost` every time it was
 * picked (R5 PLAN-01 §2.6/§5.8). A napkin is dressing FOR a cover, not a kind of
 * one, and it is still dropped from the library the way it always was.
 *
 * The same predicate decides replacement in `laySeatItems` — laying a cover
 * sweeps the other covers away, laying a napkin sweeps only napkins — so the two
 * places that ask "is this a cover?" ask it the same way.
 */
const seatItemEntries = () =>
  listCatalog().filter((entry) => entry.placement === 'seat' && !entry.requiresHost)

/**
 * Whether there is anything to lay and anywhere to lay it. Shared by the
 * exported section and by the merged `עיצוב השולחן` block, which has to know
 * whether to print the sub-heading at all — a heading with nothing under it is
 * worse than no heading.
 */
const canLayPlaceSettings = (obj: SceneObject) => !!obj.seating && seatItemEntries().length > 0

/**
 * Source doc §17 — direct control over the place settings on a table. Until now
 * the only way to lay them was to drop the item from the library onto the table
 * and the only way to see how many were laid was to count them.
 *
 * ⚠ NAME, EXPORT AND `{ obj }` PROPS ARE A CONTRACT — `viewer3d/SelectionBar3D`
 * renders this component verbatim inside a 3D popover. The inspector renders
 * `PlaceSettingsBlock`, the same body without the `Section` chrome, so the two
 * views cannot drift.
 */
export function PlaceSettingsSection({ obj }: { obj: SceneObject }) {
  if (!canLayPlaceSettings(obj)) return null
  return (
    <Section title={strings.presets.placeSettings}>
      <PlaceSettingsBlock obj={obj} />
    </Section>
  )
}

function PlaceSettingsBlock({ obj }: { obj: SceneObject }) {
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
    <>
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
    </>
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
      {/* ONE section for dressing the table. `ערכת סכו״ם` used to sit directly
          above `עיצוב שולחן` as two siblings doing the same job, with nothing to
          say which of them lays the plates. Both bodies are the ones the 3D
          popovers render, so the merge is a wrapper and not a fork. */}
      {obj.seating && (
        <Section title={T.tableStyling}>
          {canLayPlaceSettings(obj) && (
            <>
              <SubHeading>{strings.presets.placeSettings}</SubHeading>
              <PlaceSettingsBlock obj={obj} />
            </>
          )}
          <SubHeading>{strings.presets.tableDesign}</SubHeading>
          <TableDesignBlock obj={obj} />
        </Section>
      )}
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

/**
 * Round 5 — the multi-selection inspector. The report, in the user's words: *"גם
 * בעורך הדו מימד כשאני בוחר מספר פריטים התפריט השמאלי לא מאפשר לי לערוך אותם, אין
 * לי אפשרות להחיל על מה שנבחר עיצובים או החלפת עיצובים סיבוב וכל שאר הפעולות"*.
 *
 * THE ONE RULE THE WHOLE GROUP OBEYS: a section renders when it has something to
 * act on, and states in its own heading HOW MANY of the selection that is. On a
 * mixed selection — six tables, three chairs and a plant — most controls address a
 * subset, and which subset has to be answerable BEFORE the click, not after it.
 *
 * `SelectionFilter` is not the answer to that and stays exactly as it is: it
 * CHANGES the selection (`select(kept)`), which is how one arrives at a
 * homogeneous set. Ctrl+A followed by "turn everything" is a legitimate gesture
 * and the panel has to behave on a heterogeneous selection without the user being
 * narrowed down first. The two are complements — the filter reshapes the
 * selection, these counts describe it.
 *
 * ⚠ WHAT IS DELIBERATELY ABSENT, so nobody "completes" it later by accident:
 *
 *  · ABSOLUTE X/Y — `setPosition` over eight ids is eight tables on one point.
 *    "Position, for many" already exists above as align and distribute.
 *  · SIZE — `resizable`, `linkWidthDepth` and the min/max pair are per catalog
 *    entry, and `setSize` can refuse; one field over mixed entries either trims
 *    silently or half-applies.
 *  · REPLACE — `overlay.setReplaceTarget` holds ONE id and `menuCapabilities`
 *    already defines `canReplace` as `ids.length === 1`. Group replacement is a
 *    feature with its own questions (what happens to the dressing), not a widening.
 *  · CHAIR SPACING — capacity is a step function of the gap with narrow steps
 *    (the 160 square seats 12 at gap 8 and 8 at gap 9), so one shared field is
 *    the exact gesture that deletes four chairs from eight tables behind a single
 *    undo. `seatBounds.gapMax` exists because of it.
 *  · A SHARED HANGING SLIDER — `hangRange` depends on each fixture's own height,
 *    so one track over mixed fixtures offers heights `clampHang` discards for
 *    most of them (`HallDesignBlock` argues the same point at hall scale).
 */
function MultiTransformSection({ edit }: { edit: SelectionEditing }) {
  const ids = edit.editableIds
  const turn = (deg: number) => rotateObjectsBy(ids, deg)
  const step = ROTATION_SNAP_DEG
  // −90 · −45 · +45 · +90 — 45 is the app's own snap (core/rotation.ts) and 90 is
  // what the ⋯ menu already offers, so the panel introduces no third vocabulary
  const turns = [-90, -step, step, 90]
  return (
    <Section title={T.rotationSection}>
      {edit.canRotate && (
        <>
          <div className="flex gap-1">
            {turns.map((deg) => (
              <button
                key={deg}
                title={T.rotateBy(deg)}
                className="ltr-nums min-h-9 flex-1 rounded-md border border-line px-1 py-1.5 text-[14px] text-ink-soft hover:border-accent hover:text-accent"
                onClick={() => turn(deg)}
              >
                {deg > 0 ? `+${deg}°` : `${deg}°`}
              </button>
            ))}
          </div>
          {/* The absolute field is SECONDARY and the relative buttons come first,
              because "turn them all a notch" is the common gesture and needs no
              agreed starting angle. This one answers "make them all face 45°",
              which relative turns cannot express. Empty when they disagree — see
              `NumberField.mixed`. */}
          <NumberField
            label={T.rotation}
            value={edit.sharedRotation ?? 0}
            mixed={edit.sharedRotation === null}
            unit="deg"
            onCommit={(v) => setObjectsRotation(ids, v)}
          />
          <p className="text-[13px] text-ink-soft">{T.rotateHint}</p>
        </>
      )}
      <div className="flex gap-1.5">
        <button
          className={multiButton}
          disabled={!edit.canMirror}
          onClick={() => mirrorObjects(ids)}
        >
          <FlipHorizontal2 size={14} />
          {T.mirrorSelected}
        </button>
        <button
          className={multiButton}
          disabled={!edit.canDuplicate}
          onClick={() => mirrorCopyObjects(edit.ids)}
        >
          <FlipHorizontal2 size={14} />
          {T.mirrorCopySelected}
        </button>
      </div>
      <button
        className={multiButton}
        disabled={!edit.canDuplicate}
        onClick={() => duplicateObjects(edit.ids)}
      >
        <Copy size={14} />
        {T.duplicateSelected}
      </button>
    </Section>
  )
}

/** The dressing controls, scoped to the tables in the selection and saying so. */
function MultiTableSection({ edit }: { edit: SelectionEditing }) {
  const targets = edit.editableTableIds
  return (
    <Section title={T.tableStyling}>
      <p className="text-[13px] text-ink-soft">{T.scopeTables(edit.tableIds.length)}</p>
      {targets.length === 0 ? (
        <p className="text-[13px] text-warning">{strings.presets.designLocked}</p>
      ) : (
        <>
          <SubHeading>{T.chairModel}</SubHeading>
          <FieldRow label={T.chairType}>
            <select
              className="min-h-9 w-36 rounded-md border border-line bg-panel px-2 py-1.5 text-[14px] focus:border-accent focus:outline-none"
              // '' shows an empty option when the tables disagree, rather than
              // claiming they all wear whichever chair happens to be first
              value={edit.sharedChairCatalogId ?? ''}
              onChange={(e) => setChairModel(targets, e.target.value)}
            >
              {edit.sharedChairCatalogId === null && <option value="">{T.mixedValue}</option>}
              {listByCategory('seating').map((c) => (
                <option key={c.id} value={c.id}>
                  {strings.catalog.items[c.labelKey as keyof typeof strings.catalog.items]}
                </option>
              ))}
            </select>
          </FieldRow>
          {/* Relative, and only relative. `seatBounds` is a fact about ONE table's
              geometry — the ⌀180 tops out where the ⌀380 has room to spare — so a
              shared "seats = 12" would hand four tables something other than what
              it says. ± means the same thing on every table and clamps per table. */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[14px] text-ink-soft">{T.seatsStep}</span>
            <div className="flex items-center gap-1">
              <button
                className="rounded-md border border-line p-1.5 hover:border-accent hover:text-accent"
                title={T.seatsRemove}
                aria-label={T.seatsRemove}
                onClick={() => addSeatsBy(targets, -1)}
              >
                <Minus size={15} />
              </button>
              <button
                className="rounded-md border border-line p-1.5 hover:border-accent hover:text-accent"
                title={T.seatsAdd}
                aria-label={T.seatsAdd}
                onClick={() => addSeatsBy(targets, 1)}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
          <p className="text-[13px] text-ink-soft">{T.seatsHint}</p>
          <SubHeading>{strings.presets.placeSettings}</SubHeading>
          <MultiPlaceSettingsBlock tableIds={targets} />
          <SubHeading>{strings.presets.tableDesign}</SubHeading>
          <MultiTableDesignBlock tableIds={targets} />
        </>
      )}
    </Section>
  )
}

/**
 * Lay (or clear) the covers on every selected table at once — `PlaceSettingsBlock`
 * one scope up. The single-table block's `laid מתוך seats` line is a sentence
 * about ONE table and is replaced by a count of tables; everything else is the
 * same two controls, driving the same actions.
 */
function MultiPlaceSettingsBlock({ tableIds }: { tableIds: string[] }) {
  const entries = seatItemEntries()
  const [catalogId, setCatalogId] = useState(entries[0]?.id ?? '')
  const laidOn = useEditorStore(
    (s) => tableIds.filter((id) => seatItems(s.scene, id).length > 0).length,
  )
  const P = strings.presets
  if (!entries.length) return null

  return (
    <>
      <p className="text-[13px] text-ink-soft">
        {laidOn > 0 ? P.placeSettingsOnTables(laidOn) : P.placeSettingsOff}
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
          className="min-h-9 flex-1 rounded-md border border-line px-3 py-1.5 text-[14px] font-medium text-ink hover:border-accent hover:text-accent"
          onClick={() => addSeatItemsToTables(catalogId, tableIds)}
        >
          {P.placeSettingsAdd}
        </button>
        {laidOn > 0 && (
          <button
            className="min-h-9 flex-1 rounded-md border border-line px-3 py-1.5 text-[14px] text-ink-soft hover:border-danger hover:text-danger"
            onClick={() => removeSeatItemsFrom(tableIds)}
          >
            {P.placeSettingsRemove}
          </button>
        )}
      </div>
    </>
  )
}

/**
 * Appearance over a selection: the UNION of the restyleable slots, each row
 * labelled with how many items wear it.
 *
 * Union rather than intersection, and that is the whole point — on six tables
 * plus three chairs the intersection is empty, which IS the complaint. A row
 * writes only to `slot.ids`, and `setAppearance` re-checks `isEditableSlot` per
 * object, so a row can never reach an item that does not have the slot.
 *
 * When the selection disagrees NOTHING is marked (no ring on a swatch, no pressed
 * tile) rather than the first item's value being shown as if it were everyone's.
 */
function MultiAppearanceSection({ slots }: { slots: SelectionSlot[] }) {
  return (
    <Section title={T.appearance}>
      {slots.map((row) => {
        const label =
          strings.catalog.slots[row.labelKey as keyof typeof strings.catalog.slots] ?? row.slot
        return (
          <div key={row.slot} className="flex flex-col gap-2.5">
            <ColorField
              label={`${label} ${T.scopeItems(row.ids.length)}`}
              value={row.sharedColor ?? ''}
              mixed={row.sharedColor === null}
              allowCustom={row.allowCustomColor}
              onChange={(c) => setAppearance(row.ids, row.slot, c)}
            />
            {row.texture && (
              <TextureField
                label={T.texture}
                options={FABRIC_TEXTURE_IDS}
                value={row.sharedTextureId}
                mixed={row.mixedTexture}
                noneLabel={T.textureNone}
                onChange={(id) => setSlotTexture(row.ids, row.slot, id)}
              />
            )}
          </div>
        )
      })}
    </Section>
  )
}

const multiButton =
  'flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[14px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-soft'

function MultiInspector({ ids }: { ids: string[] }) {
  /**
   * ⚠ SELECT THE SLICES, THEN COMPUTE. `selectionEditing` builds fresh arrays on
   * every call, and a store selector whose snapshot changes identity every time
   * never settles under `useSyncExternalStore` — React re-renders, re-selects and
   * bails out with a WHITE SCREEN. That already shipped once in this app, on the
   * 3D `⋯` menu, and the fix there is the pattern copied here. `scene` and
   * `selection` are Immer-stable, so this recomputes only on a real change.
   */
  const scene = useEditorStore((s) => s.scene)
  const selection = useEditorStore((s) => s.selection)
  const edit = useMemo(() => selectionEditing(scene, selection), [scene, selection])
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
      <Section title={T.selectedCount(ids.length)}>
        {/* ONE line for the whole selection, not N warnings. Without it, "delete
            the selected" on ten items of which four are locked removes six in
            silence — every action filters through `editable()` anyway, so the
            panel's job is to say so once, up front. */}
        {edit.lockedCount > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-md bg-warning/10 px-2 py-1.5 text-[14px] text-warning">
            <span className="flex items-center gap-1">
              <Lock size={12} /> {T.someLocked(edit.lockedCount)}
            </span>
            {edit.unlockableIds.length > 0 && (
              <button
                className="font-semibold hover:underline"
                onClick={() => setLocked(edit.unlockableIds, false)}
              >
                {T.unlock}
              </button>
            )}
          </div>
        )}
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
        <div className="flex gap-1.5">
          <button
            className={multiButton}
            disabled={!edit.canLock}
            onClick={() => setLocked(edit.ids, !edit.anyLocked)}
          >
            {edit.anyLocked ? <Unlock size={14} /> : <Lock size={14} />}
            {edit.anyLocked ? T.unlockSelected : T.lockSelected}
          </button>
          <button
            className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-danger/40 px-3 py-1.5 text-[14px] text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            disabled={!edit.canDelete}
            onClick={() => removeObjects(ids)}
          >
            <Trash2 size={13} />
            {T.deleteSelected}
          </button>
        </div>
      </Section>
      <MultiTransformSection edit={edit} />
      {/* Keyed off the tables it addresses: both blocks below hold a picked design
          / cover type in local state, and a pick remembered from the PREVIOUS
          selection would be applied to this one. Same remount trick, same reason,
          as `SelectionFilter` below. */}
      {edit.tableIds.length > 0 && (
        <MultiTableSection key={edit.tableIds.join(',')} edit={edit} />
      )}
      {edit.slots.length > 0 && <MultiAppearanceSection slots={edit.slots} />}
      {/* LAST, and it moved down one place to get there. The reasoning it was
          given — "the count is the context and the filter is a tool applied to
          that context" — is unchanged; what that note could not foresee is five
          editing sections growing between the two, with a selection-reshaping
          tool sitting in the middle of them. Keyed off the selection so a narrowed
          (or otherwise changed) selection remounts it, which resets the ticked
          set for free. */}
      <SelectionFilter key={ids.join(',')} ids={ids} />
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
      {selection.length === 0 && <ProjectInspector />}
      {selection.length === 1 && first && <SingleInspector obj={first} />}
      {selection.length > 1 && <MultiInspector ids={selection} />}
      {/* LAST. It rendered at the very top — above the selected object's own
          name — so the first thing the panel said after clicking one chair was
          "save this as a personal layout", which is nobody's next move. */}
      {savable && <SaveSelectionSection />}
    </aside>
  )
}
