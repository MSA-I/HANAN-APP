/**
 * The two inspector surfaces for presets.
 *
 * Table designs live on the SELECTED table (that is the object the design is
 * applied to), hall-wide operations live in the project inspector next to the
 * layers panel (they are scene-level, so there is nothing to select first).
 * Dropping a table+chairs unit is a library gesture and lives there instead.
 */
import { Save, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { getCatalogEntry } from '../core/catalog/registry'
import { layoutStats, layoutsForVenue } from '../core/hallLayouts'
import type { SceneObject } from '../core/model/types'
import { HALL_DESIGNS, TABLE_DESIGNS, TABLE_PRESETS } from '../core/presets'
import {
  createSavedLayout,
  venueSignature,
  type SavedLayout,
  type SavedLayoutMode,
} from '../core/savedLayouts'
import { indexedDbRepository } from '../persistence/indexedDbRepository'
import {
  appliedHallLayoutId,
  applyHallDesign,
  applyHallLayout,
  applySavedLayout,
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
import { LayoutThumbnail, SavedLayoutThumbnail } from './LayoutThumbnail'
import { strings } from './strings'

const T = strings.presets
const repo = indexedDbRepository

const label = (key: string) => T.items[key as keyof typeof T.items] ?? key

const selectClass =
  'min-h-9 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[14px] focus:border-accent focus:outline-none'

const buttonClass =
  'min-h-9 rounded-md border border-line px-3 py-1.5 text-[14px] font-medium text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:border-line disabled:text-ink-soft/40 disabled:hover:text-ink-soft/40'

const dangerClass =
  'min-h-9 rounded-md border border-line px-3 py-1.5 text-[14px] text-ink-soft hover:border-danger hover:text-danger'

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
      <div className="flex h-16 w-full items-center justify-center rounded bg-canvas text-[13px] text-ink-soft">
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
      className="h-16 w-full rounded object-cover"
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
          <span className="text-[13px] font-medium leading-tight text-ink">{label(o.labelKey)}</span>
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
  const venueWidth = useEditorStore((s) => s.scene.venue.size.width)
  const venueDepth = useEditorStore((s) => s.scene.venue.size.depth)
  const applied = useEditorStore((s) => appliedHallLayoutId(s.scene))
  const layouts = layoutsForVenue(venuePackId)
  const [saved, setSaved] = useState<SavedLayout[]>([])
  const [savedError, setSavedError] = useState('')

  useEffect(() => {
    let active = true
    setSavedError('')
    void repo
      .listLayouts(
        venueSignature({
          venuePackId,
          size: { width: venueWidth, depth: venueDepth },
        }),
      )
      .then((items) => {
        if (active) setSaved(items)
      })
      .catch((error: unknown) => {
        console.error('saved layouts failed to load', error)
        if (active) setSavedError(strings.status.loadFailed)
      })
    return () => {
      active = false
    }
  }, [venueDepth, venuePackId, venueWidth])

  if (!layouts.length && !saved.length) return null

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
              <span className="text-[13px] font-medium leading-tight text-ink">{label(layout.labelKey)}</span>
              <span className="ltr-nums text-[13px] text-ink-soft">
                {stats.tables} {T.tablesSuffix} · {stats.seats} {T.seatsSuffix}
              </span>
            </button>
          )
        })}
      </div>
      {saved.length > 0 && (
        <>
          <h4 className="pt-1 text-[13px] font-semibold text-ink-soft">{T.savedLayouts}</h4>
          <div className="grid grid-cols-2 gap-1.5">
            {saved.map((layout) => {
              const active = applied === layout.id
              return (
                <div key={layout.id} className="relative">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => applySavedLayout(layout)}
                    className={
                      'flex h-full w-full flex-col gap-1 rounded-md border p-1.5 pe-8 text-start transition-colors ' +
                      (active ? 'border-accent bg-accent-tint' : 'border-line hover:border-accent')
                    }
                  >
                    <SavedLayoutThumbnail layout={layout} />
                    <span className="line-clamp-2 text-[13px] font-medium leading-tight text-ink">
                      {layout.name}
                    </span>
                    <span className="text-[13px] text-ink-soft">
                      {layout.mode === 'layout-design' ? T.layoutWithDesign : T.layoutOnly}
                    </span>
                  </button>
                  <button
                    type="button"
                    title={T.deleteSavedLayout}
                    aria-label={`${T.deleteSavedLayout}: ${layout.name}`}
                    className="absolute end-1.5 top-1.5 rounded-md bg-panel/90 p-1.5 text-ink-soft shadow-sm hover:bg-danger/10 hover:text-danger"
                    onClick={() => {
                      if (!window.confirm(T.confirmDeleteSavedLayout(layout.name))) return
                      void repo
                        .removeLayout(layout.id)
                        .then(() => {
                          setSaved((items) => items.filter((item) => item.id !== layout.id))
                        })
                        .catch((error: unknown) => {
                          console.error('saved layout failed to delete', error)
                          setSavedError(strings.status.saveFailed)
                        })
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
      {savedError && (
        <p role="alert" className="text-[13px] text-danger">
          {savedError}
        </p>
      )}
      {applied && (
        <button className={dangerClass} onClick={() => removeHallLayout()}>
          {T.removeLayout}
        </button>
      )}
    </Section>
  )
}

function SaveLayoutDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<SavedLayoutMode>('layout-design')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const { scene, selection } = useEditorStore.getState()
    const layout = createSavedLayout(name, scene, selection, mode)
    if (!layout) return
    setSaving(true)
    setError('')
    try {
      await repo.saveLayout(layout)
      onClose()
    } catch (err) {
      console.error('saved layout failed', err)
      setError(strings.status.saveFailed)
      setSaving(false)
    }
  }

  const choices: { id: SavedLayoutMode; label: string; hint: string }[] = [
    { id: 'layout-design', label: T.layoutWithDesign, hint: T.layoutWithDesignHint },
    { id: 'layout', label: T.layoutOnly, hint: T.layoutOnlyHint },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-layout-title"
        className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <h2 id="save-layout-title" className="mb-4 text-[18px] font-semibold text-ink">
          {T.saveTitle}
        </h2>
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-medium text-ink-soft">{T.layoutName}</span>
          <input
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={T.layoutNamePlaceholder}
            className="min-h-10 w-full rounded-md border border-line bg-panel px-3 py-2 text-[15px] text-ink outline-none focus:border-accent"
          />
        </label>
        <div className="mt-4 grid gap-2">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              aria-pressed={mode === choice.id}
              onClick={() => setMode(choice.id)}
              className={
                'rounded-lg border px-3 py-2.5 text-start transition-colors ' +
                (mode === choice.id
                  ? 'border-accent bg-accent-tint'
                  : 'border-line hover:border-accent/60')
              }
            >
              <span className="block text-[15px] font-semibold text-ink">{choice.label}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">{choice.hint}</span>
            </button>
          ))}
        </div>
        {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-md px-4 py-2 text-[14px] font-medium text-ink-soft hover:bg-canvas"
          >
            {T.cancelSave}
          </button>
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="min-h-10 rounded-md bg-accent px-4 py-2 text-[14px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            {T.saveLayout}
          </button>
        </div>
      </form>
    </div>
  )
}

export function SaveSelectionSection() {
  const selectionCount = useEditorStore((s) => s.selection.length)
  const [open, setOpen] = useState(false)
  if (!selectionCount) return null
  return (
    <Section title={T.savedLayouts}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-10 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-[14px] font-semibold text-white hover:bg-accent-hover"
      >
        <Save size={16} />
        {T.saveSelection}
      </button>
      {open && <SaveLayoutDialog onClose={() => setOpen(false)} />}
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
