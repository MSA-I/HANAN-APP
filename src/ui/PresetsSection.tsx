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
import { Pencil, Pin, Save, Trash2 } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { layoutStats, layoutsForVenue } from '../core/hallLayouts'
import { hangRange } from '../core/layout/beams'
import type { Id, SceneObject, SceneState } from '../core/model/types'
import { HALL_DESIGNS, TABLE_DESIGNS, TABLE_PRESETS, getHallDesign } from '../core/presets'
import { getVenuePack } from '../core/venuePacks'
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
  beginGesture,
  captureTableDesign,
  designItems,
  endGesture,
  fillHallWithTables,
  hasHallDesign,
  removeHallDesign,
  removeHallLayout,
  removeLightingLayout,
  removeTableDesign,
  setElevation,
  tableDesignBlock,
} from '../state/actions'
import { notify } from '../state/notice'
import { isEffectivelyLocked } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { Section, SliderField } from './fields'
import { LayoutThumbnail, SavedLayoutThumbnail } from './LayoutThumbnail'
import { strings } from './strings'

const T = strings.presets
const repo = indexedDbRepository

/**
 * A registry entry's Hebrew name. `pending` is what a TableDesign carries in
 * `pendingLabel` until its key is seeded in `strings.presets.items` — the
 * dictionary is not this plan's file (BRIEF §1.2), and without the fallback a new
 * design would show the user its raw camelCase key.
 */
const label = (key: string, pending?: string) =>
  T.items[key as keyof typeof T.items] ?? pending ?? key

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
  options: { id: string; labelKey: string; pendingLabel?: string; thumbnail?: string }[]
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
          <ThumbImage src={o.thumbnail} alt={label(o.labelKey, o.pendingLabel)} />
          <span className="text-[13px] font-medium leading-tight text-ink">
            {label(o.labelKey, o.pendingLabel)}
          </span>
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

/**
 * The fixtures a hall design put in the scene, read back from the tag
 * `applyHallDesign` writes. The action returns its ids at apply time, but the
 * height control has to reach them again afterwards, and after an undo the ids
 * the component remembered would be stale. `objectOrder` is top-level only, and
 * the ceiling test keeps a table's design-tagged DECOR out of the list —
 * `setElevation` refuses those anyway (it is ceiling-placement only), so this is
 * belt and braces on a read.
 */
function hallFixtureIds(scene: SceneState): Id[] {
  return scene.objectOrder.filter((id) => {
    const obj = scene.objects[id]
    return (
      !!obj &&
      obj.meta.design !== undefined &&
      hasCatalogEntry(obj.catalogId) &&
      getCatalogEntry(obj.catalogId).placement === 'ceiling'
    )
  })
}

/**
 * The design actually hanging and the height it hangs at, read off the scene
 * rather than remembered in component state. The inspector unmounts on every trip
 * through the 3D view, so a `useState` pick is forgotten while the fixtures stay —
 * and the height control would then be showing ANOTHER fixture's legal band,
 * offering the user metres that `clampHang` would silently discard.
 *
 * ⚠ Two selectors returning PRIMITIVES, not one returning `{id, elevation}`: a
 * store selector that builds a fresh object every call fails
 * `useSyncExternalStore`'s cache check and spins ("The result of getSnapshot
 * should be cached to avoid an infinite loop"). Found by running the app, not by
 * the tests.
 */
function appliedHallId(scene: SceneState): string | null {
  const first = hallFixtureIds(scene)[0]
  const tag = first ? scene.objects[first].meta.design : undefined
  return typeof tag === 'string' ? tag : null
}

function appliedHallElevation(scene: SceneState): number | null {
  const first = hallFixtureIds(scene)[0]
  return first ? scene.objects[first].transform.elevation : null
}

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
  const [pickedId, setPickedId] = useState(HALL_DESIGNS[0].id)
  // cm above the floor, i.e. transform.elevation: the BOTTOM of the fixture.
  // Only consulted before anything hangs — once it does, the scene is the truth.
  const [hangCm, setHangCm] = useState(() => HALL_DESIGNS[0].floorDistance ?? 0)
  const hallApplied = useEditorStore((s) => hasHallDesign(s.scene))
  const appliedId = useEditorStore((s) => appliedHallId(s.scene))
  const appliedCm = useEditorStore((s) => appliedHallElevation(s.scene))
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const wallHeight = useEditorStore((s) => s.scene.venue.wallHeight)

  // The band belongs to the ACTIVE design's fixture, not to the hall: it is
  // `[hangHeight − height, …]`, so a slider ranged once for all five would offer
  // the user heights clampHang silently discards for four of them.
  const hallId = appliedId ?? pickedId
  const hallDesign = getHallDesign(hallId) ?? HALL_DESIGNS[0]
  const fixtureHeight = getCatalogEntry(hallDesign.catalogId).defaultSize.height
  const range = hangRange(getVenuePack(venuePackId), wallHeight, fixtureHeight)
  const shown = Math.min(range.max, Math.max(range.min, appliedCm ?? hangCm))

  /**
   * Apply the design and trim its fixtures to one height, as ONE undo entry
   * (BRIEF §1.5) — `applyHallDesign` is a separate mutation from each
   * `setElevation`, so without the gesture a single click would cost the user
   * one Ctrl+Z per fixture. `setElevation` runs `clampHang` itself, which is why
   * the design can state a plain plan-cm height and nothing here re-clamps it.
   */
  const applyHall = (id: string, cm: number) => {
    beginGesture()
    try {
      for (const objId of applyHallDesign(id)) setElevation(objId, cm)
    } finally {
      endGesture()
    }
  }

  /** Move fixtures already hanging. Re-applying the design instead would throw
   *  away any fixture the user had slid along its beam since. */
  const retrim = (cm: number) => {
    const ids = hallFixtureIds(useEditorStore.getState().scene)
    if (!ids.length) return
    beginGesture()
    try {
      for (const id of ids) setElevation(id, cm)
    } finally {
      endGesture()
    }
  }

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
            // each design carries its own authored height; absent one, the seeded
            // hang (top against the truss) is the top of that fixture's band
            const next = getHallDesign(id)
            const entry = next ? getCatalogEntry(next.catalogId) : null
            const band = entry
              ? hangRange(getVenuePack(venuePackId), wallHeight, entry.defaultSize.height)
              : range
            const cm = next?.floorDistance ?? band.max
            setPickedId(id)
            setHangCm(cm)
            applyHall(id, cm)
          }}
          options={HALL_DESIGNS.map((d) => ({ ...d, thumbnail: hallThumb(d) }))}
        />
        <SliderField
          label={T.floorDistance}
          value={Math.round(shown) / 100}
          min={Math.round(range.min) / 100}
          max={Math.round(range.max) / 100}
          step={0.05}
          onChange={(v) => {
            setHangCm(v * 100)
            retrim(v * 100)
          }}
        />
        {hallApplied && (
          <button className={dangerClass} onClick={() => removeHallDesign()}>
            {T.remove}
          </button>
        )}
      </Section>
      <LightingLayoutsSection />
      <BakeFixturesSection />
    </>
  )
}

/**
 * Source doc §5 — the temporary development button that turns the arrangement
 * on screen into `src/core/venueFixtures.ts`, the file every new project is
 * seeded from.
 *
 * It lives HERE, under the layout pickers, because that is where the user went
 * looking for it: *"יש כפתור של פריסות אישיות אבל אין כפתור לשמירת אלמנטים כמו
 * שביקשתי"*. The button did exist — as an unlabelled pin between the select and
 * hand tools in the toolbar, which is not a place anyone would find it.
 *
 * DEV ONLY, twice over: `import.meta.env.DEV` here and `apply: 'serve'` in
 * tools/bake-plugin.ts, so it neither renders nor has an endpoint to call in a
 * production build ("זמנית … עבור הפיתוח"). Removing it later needs no other
 * change — the baked file stays, the factory keeps seeding it, and
 * `flags.frozen` keeps the roots put.
 */
function BakeFixturesSection() {
  const venueId = useEditorStore((s) => s.scene.venue.venuePackId)
  if (!import.meta.env.DEV || !venueId) return null

  const bake = async () => {
    const { scene } = useEditorStore.getState()
    // `objectOrder` is top-level only, and the chairs and table decor the user
    // arranged are exactly what is NOT in it — walking it was why the button
    // saved a hall of bare tables. Roots keep their z-order, children follow
    // their root, and bakeSource re-parents both into its own id space.
    const roots = new Set(scene.objectOrder)
    const objects: SceneObject[] = [
      ...scene.objectOrder.map((id) => scene.objects[id]).filter((o): o is SceneObject => !!o),
      ...Object.values(scene.objects).filter((o) => !roots.has(o.id)),
    ]
    // frozen fixtures are sent BACK rather than filtered out, so a second bake
    // rewrites the first one instead of deleting what it produced
    if (!objects.length) {
      notify(T.bakeEmpty)
      return
    }
    if (!window.confirm(T.bakeConfirm(objects.length))) return
    try {
      const res = await fetch('/__bake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ venueId, objects }),
      })
      if (!res.ok) throw new Error(`bake failed: ${res.status}`)
      notify(T.bakeDone(objects.length))
    } catch (err) {
      console.error('bake failed', err)
      notify(T.bakeFailed)
    }
  }

  // A titleless section: `strings.presets.bake` already says what the button
  // does, and `strings.ts` is not this plan's file to add a heading to (BRIEF
  // §1.2), so a <Section> here would print the same sentence twice. The wrapper
  // carries Section's own padding and rule so it sits in the panel like one.
  return (
    <div className="border-b border-line px-4 py-3.5">
      <button
        type="button"
        data-bake-fixtures
        className={`${buttonClass} flex w-full items-center justify-center gap-2`}
        onClick={() => void bake()}
      >
        <Pin size={15} />
        {T.bake}
      </button>
    </div>
  )
}
