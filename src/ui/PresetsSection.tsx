/**
 * The two inspector surfaces for presets.
 *
 * Table designs live on the SELECTED table (that is the object the design is
 * applied to), hall-wide operations live in the project inspector next to the
 * layers panel (they are scene-level, so there is nothing to select first).
 * Dropping a table+chairs unit is a library gesture and lives there instead.
 */
import { useState } from 'react'
import { getCatalogEntry } from '../core/catalog/registry'
import { layoutStats, layoutsForVenue } from '../core/hallLayouts'
import type { SceneObject } from '../core/model/types'
import { HALL_DESIGNS, TABLE_DESIGNS, TABLE_PRESETS } from '../core/presets'
import {
  appliedHallLayoutId,
  applyHallDesign,
  applyHallLayout,
  applyTableDesign,
  applyTableDesignToAll,
  designItems,
  fillHallWithTables,
  hasHallDesign,
  removeHallDesign,
  removeHallLayout,
  removeTableDesign,
} from '../state/actions'
import { isEffectivelyLocked } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { Section } from './fields'
import { LayoutThumbnail } from './LayoutThumbnail'
import { strings } from './strings'

const T = strings.presets

const label = (key: string) => T.items[key as keyof typeof T.items] ?? key

const selectClass =
  'w-full rounded-md border border-line bg-panel px-1.5 py-1 text-[12px] focus:border-accent focus:outline-none'

const buttonClass =
  'rounded-md border border-line px-2 py-1.5 text-[12px] text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:border-line disabled:text-ink-soft/40 disabled:hover:text-ink-soft/40'

const dangerClass =
  'rounded-md border border-line px-2 py-1.5 text-[12px] text-ink-soft hover:border-danger hover:text-danger'

function Picker({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { id: string; labelKey: string }[]
}) {
  return (
    <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {label(o.labelKey)}
        </option>
      ))}
    </select>
  )
}

/** Picker image with the library's fallback behaviour: text-only card on error. */
function ThumbImage({ src, alt }: { src?: string; alt: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    return (
      <div className="flex h-14 w-full items-center justify-center rounded bg-canvas text-[10px] text-ink-soft">
        {alt}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setBroken(true)}
      className="h-14 w-full rounded object-cover"
    />
  )
}

/**
 * Visual replacement for the text-only <select> pickers: a 2-col card grid,
 * each card = image + label, selection via aria-pressed. The image comes from
 * the option itself (design capture) or its catalog entry's thumbnail.
 */
function ThumbGrid({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { id: string; labelKey: string; thumbnail?: string }[]
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={
            'flex flex-col gap-1 rounded-md border p-1.5 text-start transition-colors ' +
            (value === o.id ? 'border-accent bg-accent-tint' : 'border-line hover:border-accent')
          }
        >
          <ThumbImage src={o.thumbnail} alt={label(o.labelKey)} />
          <span className="text-[11px] font-medium text-ink">{label(o.labelKey)}</span>
        </button>
      ))}
    </div>
  )
}

/** A table design's picker image: its own capture, else its centerpiece photo. */
const designThumb = (design: (typeof TABLE_DESIGNS)[number]) =>
  design.thumbnail ?? getCatalogEntry(design.items[0].catalogId).thumbnail

const hallThumb = (design: (typeof HALL_DESIGNS)[number]) =>
  getCatalogEntry(design.catalogId).thumbnail

/** Apply a ready-made decor set to this table — or to every table at once. */
export function TableDesignSection({ obj }: { obj: SceneObject }) {
  const [designId, setDesignId] = useState(TABLE_DESIGNS[0].id)
  const applied = useEditorStore((s) => designItems(s.scene, obj.id).length > 0)
  // apply-to-all is a dead no-op when every table is locked — say so by disabling
  const anyTableFree = useEditorStore((s) =>
    Object.values(s.scene.objects).some(
      (o) =>
        !o.parentId &&
        o.seating &&
        getCatalogEntry(o.catalogId).category === 'tables' &&
        !isEffectivelyLocked(s.scene, o),
    ),
  )
  if (!obj.seating) return null

  return (
    <Section title={T.tableDesign}>
      <ThumbGrid
        value={designId}
        onChange={setDesignId}
        options={TABLE_DESIGNS.map((d) => ({ ...d, thumbnail: designThumb(d) }))}
      />
      <div className="flex gap-1.5">
        <button className={`${buttonClass} flex-1`} onClick={() => applyTableDesign(designId, obj.id)}>
          {T.apply}
        </button>
        <button
          className={`${buttonClass} flex-1`}
          disabled={!anyTableFree}
          onClick={() => applyTableDesignToAll(designId)}
        >
          {T.applyAll}
        </button>
      </div>
      {applied && (
        <button className={dangerClass} onClick={() => removeTableDesign(obj.id)}>
          {T.remove}
        </button>
      )}
    </Section>
  )
}

/**
 * Named layout picker: a visual grid of top-view schematics, one card per
 * authored layout for the current venue. Clicking applies (replace semantics —
 * see applyHallLayout); the active card is marked via aria-pressed.
 */
export function HallLayoutsSection() {
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const applied = useEditorStore((s) => appliedHallLayoutId(s.scene))
  const layouts = layoutsForVenue(venuePackId)
  if (!layouts.length) return null

  return (
    <Section title={T.layouts}>
      <div className="grid grid-cols-2 gap-1.5">
        {layouts.map((layout) => {
          const stats = layoutStats(layout)
          const active = applied === layout.id
          return (
            <button
              key={layout.id}
              type="button"
              aria-pressed={active}
              onClick={() => applyHallLayout(layout.id)}
              className={
                'flex flex-col gap-1 rounded-md border p-1.5 text-start transition-colors ' +
                (active ? 'border-accent bg-accent-tint' : 'border-line hover:border-accent')
              }
            >
              <LayoutThumbnail layout={layout} />
              <span className="text-[11px] font-medium text-ink">{label(layout.labelKey)}</span>
              <span className="ltr-nums text-[10px] text-ink-soft">
                {stats.tables} {T.tablesSuffix} · {stats.seats} {T.seatsSuffix}
              </span>
            </button>
          )
        })}
      </div>
      {applied && (
        <button className={dangerClass} onClick={() => removeHallLayout()}>
          {T.removeLayout}
        </button>
      )}
    </Section>
  )
}

/** Hall-wide operations: fill the floor with tables, hang a ceiling design. */
export function ScenePresetsSection() {
  const [presetId, setPresetId] = useState(TABLE_PRESETS[0].id)
  const [hallId, setHallId] = useState(HALL_DESIGNS[0].id)
  const hallApplied = useEditorStore((s) => hasHallDesign(s.scene))

  return (
    <>
      <Section title={T.autoFill}>
        <Picker value={presetId} onChange={setPresetId} options={TABLE_PRESETS} />
        <button
          className={buttonClass}
          title={T.fillHint}
          onClick={() => fillHallWithTables(presetId)}
        >
          {T.fillHall}
        </button>
      </Section>
      <Section title={T.hallDesign}>
        <ThumbGrid
          value={hallId}
          onChange={setHallId}
          options={HALL_DESIGNS.map((d) => ({ ...d, thumbnail: hallThumb(d) }))}
        />
        <div className="flex gap-1.5">
          <button className={`${buttonClass} flex-1`} onClick={() => applyHallDesign(hallId)}>
            {T.apply}
          </button>
          {hallApplied && (
            <button className={`${dangerClass} flex-1`} onClick={() => removeHallDesign()}>
              {T.remove}
            </button>
          )}
        </div>
      </Section>
    </>
  )
}
