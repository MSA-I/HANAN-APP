/**
 * The two inspector surfaces for presets.
 *
 * Table designs live on the SELECTED table (that is the object the design is
 * applied to), hall-wide operations live in the project inspector next to the
 * layers panel (they are scene-level, so there is nothing to select first).
 * Dropping a table+chairs unit is a library gesture and lives there instead.
 *
 * One interaction rule throughout: CLICKING A CARD APPLIES IT. Table designs
 * used to be select-then-press-החל while hall layouts applied on click, which is
 * why "nothing happens when I click a design" (source doc §23) was the report.
 */
import { Pencil, Save, Trash2 } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { layoutStats, layoutsForVenue } from '../core/hallLayouts'
import type { SceneObject } from '../core/model/types'
import { HALL_DESIGNS, TABLE_DESIGNS, TABLE_PRESETS } from '../core/presets'
import {
  createLightingLayout,
  createSavedLayout,
  missingCatalogIds,
  venueSignature,
  type SavedLayout,
  type SavedLayoutMode,
} from '../core/savedLayouts'
import {
  indexedDbRepository,
  layoutsRevision,
  subscribeLayouts,
} from '../persistence/indexedDbRepository'
import {
  appliedHallLayoutId,
  appliedLightingLayoutId,
  applyHallDesign,
  applyHallLayout,
  applySavedLayout,
  applySavedTableDesign,
  applySavedTableDesignToAll,
  applyTableDesign,
  applyTableDesignToAll,
  captureTableDesign,
  designItems,
  fillHallWithTables,
  hasHallDesign,
  removeHallDesign,
  removeHallLayout,
  removeLightingLayout,
  removeTableDesign,
  tableDesignBlock,
} from '../state/actions'
import { notify } from '../state/notice'
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

const cardClass = (active: boolean) =>
  'flex h-full w-full flex-col gap-1 rounded-md border p-1.5 text-start transition-colors ' +
  (active ? 'border-accent bg-accent-tint' : 'border-line hover:border-accent')

/**
 * The picker lists re-read IndexedDB whenever a layout is WRITTEN, not only when
 * the venue changes — saving used to leave the grid stale until a remount.
 */
const useLayoutsRevision = () =>
  useSyncExternalStore(subscribeLayouts, layoutsRevision, layoutsRevision)

function useVenueLayouts(
  venuePackId: string | null | undefined,
  width: number,
  depth: number,
): { layouts: SavedLayout[]; error: string } {
  const revision = useLayoutsRevision()
  const [layouts, setLayouts] = useState<SavedLayout[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setError('')
    void repo
      .listLayouts(venueSignature({ venuePackId, size: { width, depth } }))
      .then((items) => {
        if (active) setLayouts(items)
      })
      .catch((err: unknown) => {
        console.error('saved layouts failed to load', err)
        if (active) setError(strings.status.loadFailed)
      })
    return () => {
      active = false
    }
  }, [revision, venuePackId, width, depth])

  return { layouts, error }
}

/** Table designs are not venue-shaped — a dressed table travels between halls. */
function useTableDesigns(): SavedLayout[] {
  const revision = useLayoutsRevision()
  const [layouts, setLayouts] = useState<SavedLayout[]>([])

  useEffect(() => {
    let active = true
    void repo
      .listTableDesigns()
      .then((items) => {
        if (active) setLayouts(items)
      })
      .catch((err: unknown) => console.error('table designs failed to load', err))
    return () => {
      active = false
    }
  }, [revision])

  return layouts
}

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
  disabled = false,
}: {
  value: string
  onChange: (v: string) => void
  options: { id: string; labelKey: string; thumbnail?: string }[]
  disabled?: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cardClass(value === o.id) + (disabled ? ' opacity-50' : '')}
        >
          <ThumbImage src={o.thumbnail} alt={label(o.labelKey)} />
          <span className="text-[13px] font-medium leading-tight text-ink">{label(o.labelKey)}</span>
        </button>
      ))}
    </div>
  )
}

/** A table design's picker image: its own capture, else its centerpiece photo. */
const designThumb = (design: (typeof TABLE_DESIGNS)[number]) => {
  const first = design.items[0]?.catalogId
  return design.thumbnail ?? (first && hasCatalogEntry(first) ? getCatalogEntry(first).thumbnail : undefined)
}

const hallThumb = (design: (typeof HALL_DESIGNS)[number]) =>
  getCatalogEntry(design.catalogId).thumbnail

/** Name-a-thing modal, shared by the three "save this arrangement" buttons. */
function NameDialog({
  title,
  fieldLabel,
  placeholder,
  onClose,
  onSubmit,
  children,
}: {
  title: string
  fieldLabel: string
  placeholder: string
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
  children?: ReactNode
}) {
  const [name, setName] = useState('')
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
    setSaving(true)
    setError('')
    try {
      await onSubmit(name)
      onClose()
    } catch (err) {
      console.error('saved layout failed', err)
      setError(strings.status.saveFailed)
      setSaving(false)
    }
  }

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
          {title}
        </h2>
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-medium text-ink-soft">{fieldLabel}</span>
          <input
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={placeholder}
            className="min-h-10 w-full rounded-md border border-line bg-panel px-3 py-2 text-[15px] text-ink outline-none focus:border-accent"
          />
        </label>
        {children}
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

/**
 * Reuse the id of a same-named layout instead of piling up duplicates — the
 * "overwrite" half of rename/overwrite, asked for once and then honoured.
 */
async function saveOrOverwrite(layout: SavedLayout, existing: SavedLayout[]): Promise<void> {
  const clash = existing.find((item) => item.name === layout.name && item.kind === layout.kind)
  if (clash) {
    if (!window.confirm(T.confirmOverwrite(layout.name))) return
    await repo.saveLayout({ ...layout, id: clash.id, createdAt: clash.createdAt })
    return
  }
  await repo.saveLayout(layout)
}

/** Rename / delete affordances shared by every saved-layout card. */
function CardActions({ layout }: { layout: SavedLayout }) {
  const fail = (error: unknown) => {
    console.error('saved layout write failed', error)
    notify(strings.status.saveFailed)
  }
  return (
    <div className="absolute end-1.5 top-1.5 flex flex-col gap-1">
      <button
        type="button"
        title={T.renameSavedLayout}
        aria-label={`${T.renameSavedLayout}: ${layout.name}`}
        className="rounded-md bg-panel/90 p-1.5 text-ink-soft shadow-sm hover:bg-accent-tint hover:text-accent"
        onClick={() => {
          const next = window.prompt(T.renamePrompt, layout.name)
          if (next === null) return
          void repo.renameLayout(layout.id, next).catch(fail)
        }}
      >
        <Pencil size={14} />
      </button>
      <button
        type="button"
        title={T.deleteSavedLayout}
        aria-label={`${T.deleteSavedLayout}: ${layout.name}`}
        className="rounded-md bg-panel/90 p-1.5 text-ink-soft shadow-sm hover:bg-danger/10 hover:text-danger"
        onClick={() => {
          if (!window.confirm(T.confirmDeleteSavedLayout(layout.name))) return
          void repo.removeLayout(layout.id).catch(fail)
        }}
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

/**
 * A saved arrangement's card. A layout whose catalog items no longer exist is
 * marked and refuses the click rather than throwing out of `getCatalogEntry`.
 */
function SavedLayoutCard({
  layout,
  active,
  subtitle,
  onApply,
}: {
  layout: SavedLayout
  active: boolean
  subtitle?: string
  onApply: () => void
}) {
  const missing = missingCatalogIds(layout).length > 0
  // a venue schematic says nothing about ONE table's decor — show the decor instead
  const centrepiece =
    layout.kind === 'tableDesign'
      ? layout.subtrees[0]?.children.find(
          (c) => hasCatalogEntry(c.catalogId) && getCatalogEntry(c.catalogId).placement !== 'seat',
        )
      : undefined
  return (
    <div className="relative">
      <button
        type="button"
        aria-pressed={active}
        disabled={missing}
        onClick={onApply}
        className={cardClass(active) + ' pe-8' + (missing ? ' opacity-50' : '')}
      >
        {!missing &&
          (layout.kind === 'tableDesign' ? (
            <ThumbImage
              src={centrepiece ? getCatalogEntry(centrepiece.catalogId).thumbnail : undefined}
              alt={layout.name}
            />
          ) : (
            <SavedLayoutThumbnail layout={layout} />
          ))}
        <span className="line-clamp-2 text-[13px] font-medium leading-tight text-ink">{layout.name}</span>
        <span className="text-[13px] text-ink-soft">
          {missing ? T.unavailableBadge : (subtitle ?? (layout.mode === 'layout-design' ? T.layoutWithDesign : T.layoutOnly))}
        </span>
      </button>
      <CardActions layout={layout} />
    </div>
  )
}

/** Apply a ready-made decor set to this table — or to every table at once. */
export function TableDesignSection({ obj }: { obj: SceneObject }) {
  const [designId, setDesignId] = useState(TABLE_DESIGNS[0].id)
  const [saving, setSaving] = useState(false)
  const applied = useEditorStore((s) => designItems(s.scene, obj.id).length > 0)
  const block = useEditorStore((s) => tableDesignBlock(s.scene, obj.id))
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
  const saved = useTableDesigns()

  if (!obj.seating) return null
  const blocked = block !== null
  const apply = (id: string) => {
    setDesignId(id)
    const savedDesign = saved.find((item) => item.id === id)
    if (savedDesign) applySavedTableDesign(savedDesign, obj.id)
    else applyTableDesign(id, obj.id)
  }
  const applyAll = () => {
    const savedDesign = saved.find((item) => item.id === designId)
    if (savedDesign) applySavedTableDesignToAll(savedDesign)
    else applyTableDesignToAll(designId)
  }

  return (
    <Section title={T.tableDesign}>
      {blocked && <p className="text-[13px] text-warning">{T.designLocked}</p>}
      <ThumbGrid
        value={designId}
        onChange={apply}
        disabled={blocked}
        options={TABLE_DESIGNS.map((d) => ({ ...d, thumbnail: designThumb(d) }))}
      />
      {saved.length > 0 && (
        <>
          <h4 className="pt-1 text-[13px] font-semibold text-ink-soft">{T.savedDesigns}</h4>
          <div className="grid grid-cols-2 gap-1.5">
            {saved.map((layout) => (
              <SavedLayoutCard
                key={layout.id}
                layout={layout}
                active={designId === layout.id}
                subtitle={T.tableDesign}
                onApply={() => apply(layout.id)}
              />
            ))}
          </div>
        </>
      )}
      <div className="flex gap-1.5">
        <button
          className={`${buttonClass} flex-1`}
          disabled={!anyTableFree}
          title={anyTableFree ? undefined : T.designLocked}
          onClick={applyAll}
        >
          {T.applyAll}
        </button>
        {applied && (
          <button className={`${dangerClass} flex-1`} disabled={blocked} onClick={() => removeTableDesign(obj.id)}>
            {T.remove}
          </button>
        )}
      </div>
      <button className={buttonClass} onClick={() => setSaving(true)}>
        {T.saveDesign}
      </button>
      {saving && (
        <NameDialog
          title={T.saveDesignTitle}
          fieldLabel={T.designName}
          placeholder={T.designNamePlaceholder}
          onClose={() => setSaving(false)}
          onSubmit={async (name) => {
            const layout = captureTableDesign(obj.id, name)
            if (!layout) {
              notify(T.noDesignToSave)
              return
            }
            await saveOrOverwrite(layout, saved)
          }}
        />
      )}
    </Section>
  )
}

/**
 * The same grid in the project inspector, disabled, with the reason. Without a
 * selection the whole section used to be absent, so the designs were invisible
 * until you happened to click a table (source doc §23).
 */
export function TableDesignHintSection() {
  return (
    <Section title={T.tableDesign}>
      <p className="text-[13px] text-ink-soft">{T.designPickHint}</p>
      <ThumbGrid
        value=""
        disabled
        onChange={() => {}}
        options={TABLE_DESIGNS.map((d) => ({ ...d, thumbnail: designThumb(d) }))}
      />
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
  const { layouts: all, error } = useVenueLayouts(venuePackId, venueWidth, venueDepth)
  const saved = all.filter((layout) => layout.kind === 'tables')

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
              className={cardClass(active)}
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
            {saved.map((layout) => (
              <SavedLayoutCard
                key={layout.id}
                layout={layout}
                active={applied === layout.id}
                onApply={() => applySavedLayout(layout)}
              />
            ))}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
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

/**
 * Source doc §32 — the lighting counterpart of the hall-layout picker. Its own
 * `meta` tag means a saved lighting layout and a saved table layout are applied
 * side by side instead of replacing each other.
 */
export function LightingLayoutsSection() {
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const venueWidth = useEditorStore((s) => s.scene.venue.size.width)
  const venueDepth = useEditorStore((s) => s.scene.venue.size.depth)
  const applied = useEditorStore((s) => appliedLightingLayoutId(s.scene))
  const [saving, setSaving] = useState(false)
  const { layouts: all } = useVenueLayouts(venuePackId, venueWidth, venueDepth)
  const saved = all.filter((layout) => layout.kind === 'lighting')

  return (
    <Section title={T.lightingLayouts}>
      {saved.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {saved.map((layout) => (
            <SavedLayoutCard
              key={layout.id}
              layout={layout}
              active={applied === layout.id}
              subtitle={T.lightingLayouts}
              onApply={() => applySavedLayout(layout)}
            />
          ))}
        </div>
      )}
      <button className={buttonClass} onClick={() => setSaving(true)}>
        {T.saveLighting}
      </button>
      {applied && (
        <button className={dangerClass} onClick={() => removeLightingLayout()}>
          {T.removeLightingLayout}
        </button>
      )}
      {saving && (
        <NameDialog
          title={T.saveLightingTitle}
          fieldLabel={T.layoutName}
          placeholder={T.layoutNamePlaceholder}
          onClose={() => setSaving(false)}
          onSubmit={async (name) => {
            const layout = createLightingLayout(name, useEditorStore.getState().scene)
            if (!layout) {
              notify(T.noLighting)
              return
            }
            await saveOrOverwrite(layout, saved)
          }}
        />
      )}
    </Section>
  )
}

export function SaveSelectionSection() {
  const selectionCount = useEditorStore((s) => s.selection.length)
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const venueWidth = useEditorStore((s) => s.scene.venue.size.width)
  const venueDepth = useEditorStore((s) => s.scene.venue.size.depth)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<SavedLayoutMode>('layout-design')
  const { layouts: existing } = useVenueLayouts(venuePackId, venueWidth, venueDepth)
  if (!selectionCount) return null

  const choices: { id: SavedLayoutMode; label: string; hint: string }[] = [
    { id: 'layout-design', label: T.layoutWithDesign, hint: T.layoutWithDesignHint },
    { id: 'layout', label: T.layoutOnly, hint: T.layoutOnlyHint },
  ]

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
      {open && (
        <NameDialog
          title={T.saveTitle}
          fieldLabel={T.layoutName}
          placeholder={T.layoutNamePlaceholder}
          onClose={() => setOpen(false)}
          onSubmit={async (name) => {
            const { scene, selection } = useEditorStore.getState()
            const layout = createSavedLayout(name, scene, selection, mode)
            if (!layout) return
            await saveOrOverwrite(layout, existing)
          }}
        >
          <div className="mt-4 grid gap-2">
            {choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                aria-pressed={mode === choice.id}
                onClick={() => setMode(choice.id)}
                className={
                  'rounded-lg border px-3 py-2.5 text-start transition-colors ' +
                  (mode === choice.id ? 'border-accent bg-accent-tint' : 'border-line hover:border-accent/60')
                }
              >
                <span className="block text-[15px] font-semibold text-ink">{choice.label}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">{choice.hint}</span>
              </button>
            ))}
          </div>
        </NameDialog>
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
          onChange={(id) => {
            setHallId(id)
            applyHallDesign(id)
          }}
          options={HALL_DESIGNS.map((d) => ({ ...d, thumbnail: hallThumb(d) }))}
        />
        {hallApplied && (
          <button className={dangerClass} onClick={() => removeHallDesign()}>
            {T.remove}
          </button>
        )}
      </Section>
      <LightingLayoutsSection />
    </>
  )
}
