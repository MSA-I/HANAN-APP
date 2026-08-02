/**
 * The two inspector surfaces for presets.
 *
 * Table designs live on the SELECTED table (that is the object the design is
 * applied to), hall-wide operations live in the project inspector next to the
 * layers panel (they are scene-level, so there is nothing to select first).
 * Dropping a table+chairs unit is a library gesture and lives there instead.
 *
 * The interaction rule, and its ONE exception.
 *
 * DESIGN cards — table designs, hall designs — apply on click. They used to be
 * select-then-press-החל, which is why "nothing happens when I click a design"
 * (source doc §23) was the report, and the rule has held since.
 *
 * HALL LAYOUT cards no longer do (source doc §22): *"אם אני לוחץ על פריסות אולם
 * צריך שייפתח תפריט … שמשם אני יכול לשנות עיצובים וסוג כסאות לאותה פריסה"*. A
 * layout replaces every table in the hall, so the choices belong BEFORE the
 * click lands, not after it — the card opens `HallLayoutOptions` and applying is
 * a second, explicit step. The one-click path is not gone: it is the ⚡ button in
 * the card's own corner, which applies the layout exactly as before.
 */
import { ChevronRight, Pencil, Pin, Save, Trash2, Zap } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react'
import { getCatalogEntry, hasCatalogEntry, listByCategory } from '../core/catalog/registry'
import { isFloorTable } from '../core/catalog/types'
import { layoutStats, layoutsForVenue, type HallLayout } from '../core/hallLayouts'
import { hangRange, maxHangSpread } from '../core/layout/beams'
import type { Id, SceneObject, SceneState } from '../core/model/types'
import { HALL_DESIGNS, TABLE_DESIGNS, TABLE_PRESETS, getHallDesign } from '../core/presets'
import { getVenuePack } from '../core/venuePacks'
import {
  createHallTablesLayout,
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
  hallFixtureIds,
  hasHallDesign,
  isGestureActive,
  removeHallDesign,
  removeHallLayout,
  removeLightingLayout,
  removeTableDesign,
  reshuffleHallHeights,
  setHallHeights,
  tableDesignBlock,
  type HallLayoutOptions,
} from '../state/actions'
import { notify } from '../state/notice'
import { isEffectivelyLocked } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { ConfirmDialog, Dialog } from './Dialog'
import { CollapsibleSection, INSPECTOR_SECTION, Section, SliderField, SubHeading } from './fields'
import { LayoutThumbnail, SavedLayoutThumbnail } from './LayoutThumbnail'
import { strings } from './strings'

const T = strings.presets
const N = strings.notice
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
 * The design actually hanging, the height it hangs at and how far its fixtures
 * are spread — read off the scene rather than remembered in component state. The
 * inspector unmounts on every trip through the 3D view, so a `useState` pick is
 * forgotten while the fixtures stay — and the height control would then be
 * showing ANOTHER fixture's legal band, offering the user metres that `clampHang`
 * would silently discard.
 *
 * ⚠ THREE selectors returning PRIMITIVES, not one returning
 * `{id, elevation, spread}`: a store selector that builds a fresh object every
 * call fails `useSyncExternalStore`'s cache check and spins ("The result of
 * getSnapshot should be cached to avoid an infinite loop"). Found by running the
 * app, not by the tests.
 *
 * `hallFixtureIds` itself now lives in `state/actions.ts` — the height WRITE
 * needs the same set, and two definitions of one idea is how they drift.
 */
function appliedHallId(scene: SceneState): string | null {
  const first = hallFixtureIds(scene)[0]
  const tag = first ? scene.objects[first].meta.design : undefined
  return typeof tag === 'string' ? tag : null
}

/**
 * ⚠ The fallback to `transform.elevation` IS the backward compatibility, and it
 * is there INSTEAD of a migration: a project saved before the scatter existed has
 * no `meta.hangBase`, and its elevation is precisely the base it was trimmed to.
 * A missing `hangSpread` reads as 0, i.e. the old flat plane. That is why
 * `SCHEMA_VERSION` did not move (PLAN-06 §4.7) — do not "tidy" this away.
 */
function appliedHallBase(scene: SceneState): number | null {
  const first = hallFixtureIds(scene)[0]
  if (!first) return null
  const obj = scene.objects[first]
  return typeof obj.meta.hangBase === 'number' ? obj.meta.hangBase : obj.transform.elevation
}

function appliedHallSpread(scene: SceneState): number | null {
  const first = hallFixtureIds(scene)[0]
  if (!first) return null
  const raw = scene.objects[first].meta.hangSpread
  return typeof raw === 'number' ? raw : null
}

interface ConfirmRequest {
  title: string
  body?: ReactNode
  confirmLabel: string
  danger?: boolean
}

type ConfirmFn = (request: ConfirmRequest) => Promise<boolean>

/**
 * `window.confirm` in the app's own chrome, and the reason it returns a PROMISE:
 * `saveOrOverwrite` discovers the clash halfway through an async save, and a
 * callback-shaped dialog would force that one flow to be turned inside out into
 * a state machine. Awaiting the answer lets the question be asked where it
 * arises.
 *
 * The only four confirmations left in this file are the ones undo cannot reach —
 * saved layouts live in IndexedDB and the bake writes a source file. Everything
 * inside `scene` is 100 steps of `zundo` away and gets no dialog: confirmation
 * fatigue teaches people to click through the one that mattered.
 */
function useConfirm(): { ask: ConfirmFn; dialog: ReactNode; open: boolean } {
  const [pending, setPending] = useState<
    (ConfirmRequest & { resolve: (ok: boolean) => void }) | null
  >(null)

  const ask = useCallback<ConfirmFn>(
    (request) => new Promise<boolean>((resolve) => setPending({ ...request, resolve })),
    [],
  )

  const answer = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  return {
    ask,
    open: pending !== null,
    dialog: pending && (
      <ConfirmDialog
        title={pending.title}
        body={pending.body}
        danger={pending.danger}
        cancelLabel={strings.dialog.cancel}
        confirmLabel={pending.confirmLabel}
        onCancel={() => answer(false)}
        onConfirm={() => answer(true)}
      />
    ),
  }
}

/**
 * Name-a-thing modal, shared by the three "save this arrangement" buttons and by
 * rename. Built on `Dialog`, so it gains the focus trap and the focus restore it
 * never had; everything else — the form, the required field, Enter to submit —
 * is what it already was.
 */
function NameDialog({
  title,
  fieldLabel,
  placeholder,
  initialName = '',
  confirmLabel = T.saveLayout,
  /** true while a confirm sits on top of this one: Escape belongs to that one. */
  escapeDisabled = false,
  onClose,
  onSubmit,
  children,
}: {
  title: string
  fieldLabel: string
  placeholder?: string
  initialName?: string
  confirmLabel?: string
  escapeDisabled?: boolean
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
  children?: ReactNode
}) {
  const titleId = useId()
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
    <Dialog onClose={() => !escapeDisabled && onClose()} labelledBy={titleId}>
      <form onSubmit={(event) => void submit(event)}>
        <h2 id={titleId} className="mb-4 text-[18px] font-semibold text-ink">
          {title}
        </h2>
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-medium text-ink-soft">{fieldLabel}</span>
          <input
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
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/**
 * "Positions only" vs "positions + how it looks", inside a `NameDialog`. Shared
 * by the two table-layout save buttons so the choice cannot drift between the
 * selection one and the hall one.
 */
function ModeChoice({
  mode,
  onChange,
}: {
  mode: SavedLayoutMode
  onChange: (mode: SavedLayoutMode) => void
}) {
  const choices: { id: SavedLayoutMode; label: string; hint: string }[] = [
    { id: 'layout-design', label: T.layoutWithDesign, hint: T.layoutWithDesignHint },
    { id: 'layout', label: T.layoutOnly, hint: T.layoutOnlyHint },
  ]
  return (
    <div className="mt-4 grid gap-2">
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          aria-pressed={mode === choice.id}
          onClick={() => onChange(choice.id)}
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
  )
}

/**
 * Reuse the id of a same-named layout instead of piling up duplicates — the
 * "overwrite" half of rename/overwrite, asked for once and then honoured.
 *
 * `ask` is threaded in rather than imported: the dialog has to be MOUNTED by a
 * component, and this is a plain async function.
 */
async function saveOrOverwrite(
  layout: SavedLayout,
  existing: SavedLayout[],
  ask: ConfirmFn,
): Promise<void> {
  const clash = existing.find((item) => item.name === layout.name && item.kind === layout.kind)
  if (clash) {
    const ok = await ask({
      title: strings.dialog.overwriteTitle,
      body: T.confirmOverwrite(layout.name),
      confirmLabel: strings.dialog.overwriteConfirm,
    })
    if (!ok) return
    await repo.saveLayout({ ...layout, id: clash.id, createdAt: clash.createdAt })
    return
  }
  await repo.saveLayout(layout)
}

/**
 * Rename / delete affordances shared by every saved-layout card.
 *
 * Both dialogs are in-app now. Delete keeps its confirmation because a saved
 * layout lives in IndexedDB, outside the 100 undo steps `zundo` holds over
 * `scene` — there is nothing to take it back with. Rename does not confirm; it
 * needs a text field, which `ConfirmDialog` deliberately does not offer.
 */
function CardActions({ layout }: { layout: SavedLayout }) {
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
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
        onClick={() => setRenaming(true)}
      >
        <Pencil size={14} />
      </button>
      <button
        type="button"
        title={T.deleteSavedLayout}
        aria-label={`${T.deleteSavedLayout}: ${layout.name}`}
        className="rounded-md bg-panel/90 p-1.5 text-ink-soft shadow-sm hover:bg-danger/10 hover:text-danger"
        onClick={() => setDeleting(true)}
      >
        <Trash2 size={15} />
      </button>
      {renaming && (
        <NameDialog
          title={strings.dialog.renameTitle}
          fieldLabel={T.renamePrompt}
          initialName={layout.name}
          confirmLabel={strings.dialog.renameConfirm}
          onClose={() => setRenaming(false)}
          onSubmit={async (next) => {
            await repo.renameLayout(layout.id, next)
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          danger
          title={strings.dialog.deleteLayoutTitle}
          body={T.confirmDeleteSavedLayout(layout.name)}
          cancelLabel={strings.dialog.cancel}
          confirmLabel={strings.dialog.deleteLayoutConfirm}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false)
            void repo.removeLayout(layout.id).catch(fail)
          }}
        />
      )}
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

/**
 * Apply a ready-made decor set to this table — or to every table at once.
 *
 * ⚠ NAME, EXPORT AND `{ obj }` PROPS ARE A CONTRACT. `viewer3d/SelectionBar3D`
 * imports this component and renders it verbatim inside a 3D popover, which is
 * what makes a 2D/3D divergence in table dressing structurally impossible. The
 * inspector's merged "עיצוב השולחן" section renders `TableDesignBlock` — the
 * same body without the `Section` chrome — for the same reason.
 */
export function TableDesignSection({ obj }: { obj: SceneObject }) {
  if (!obj.seating) return null
  return (
    <Section title={T.tableDesign}>
      <TableDesignBlock obj={obj} />
    </Section>
  )
}

export function TableDesignBlock({ obj }: { obj: SceneObject }) {
  const [designId, setDesignId] = useState(TABLE_DESIGNS[0].id)
  const [saving, setSaving] = useState(false)
  const confirm = useConfirm()
  const applied = useEditorStore((s) => designItems(s.scene, obj.id).length > 0)
  const block = useEditorStore((s) => tableDesignBlock(s.scene, obj.id))
  // apply-to-all is a dead no-op when every table is locked — say so by disabling
  const anyTableFree = useEditorStore((s) =>
    Object.values(s.scene.objects).some(
      (o) =>
        !o.parentId &&
        o.seating &&
        // defensive: `!o.parentId && o.seating` already excludes both v13 arrivals
        isFloorTable(getCatalogEntry(o.catalogId)) &&
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
  /**
   * No confirmation: every table's decor is one `mutateScene`, so this is one
   * Ctrl+Z away — but it used to complete in total silence on a panel the user
   * cannot see all of, which is the actual defect. The RESULT is what gets
   * announced.
   */
  const applyAll = () => {
    const savedDesign = saved.find((item) => item.id === designId)
    const ids = savedDesign ? applySavedTableDesignToAll(savedDesign) : applyTableDesignToAll(designId)
    // `layAll` raises its own refusal when nothing landed — one toast, not two
    if (!ids.length) return
    // the ids are the DECOR that was laid; what the user counts is TABLES, which
    // is how many distinct parents that decor hangs off
    const { objects } = useEditorStore.getState().scene
    const tables = new Set<Id>()
    for (const id of ids) {
      const parent = objects[id]?.parentId
      if (parent) tables.add(parent)
    }
    notify(N.designAppliedAll(tables.size), { tone: 'info' })
  }

  return (
    <>
      {blocked && <p className="text-[13px] text-warning">{T.designLocked}</p>}
      <ThumbGrid
        value={designId}
        onChange={apply}
        disabled={blocked}
        options={TABLE_DESIGNS.map((d) => ({ ...d, thumbnail: designThumb(d) }))}
      />
      {saved.length > 0 && (
        <>
          <SubHeading>{T.savedDesigns}</SubHeading>
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
          escapeDisabled={confirm.open}
          onClose={() => setSaving(false)}
          onSubmit={async (name) => {
            const layout = captureTableDesign(obj.id, name)
            if (!layout) {
              notify(T.noDesignToSave)
              return
            }
            await saveOrOverwrite(layout, saved, confirm.ask)
          }}
        />
      )}
      {confirm.dialog}
    </>
  )
}

/**
 * The same grid in the project inspector, disabled, with the reason. Without a
 * selection the whole section used to be absent, so the designs were invisible
 * until you happened to click a table (source doc §23).
 *
 * COLLAPSED by default, and that is the same fix rather than a retreat from it:
 * §23 needed the designs to be DISCOVERABLE, and a titled section says "table
 * designs live here" in one line. What it costs otherwise is ~200px of four
 * permanently disabled cards on the panel's first screen.
 */
export function TableDesignHintSection() {
  return (
    <CollapsibleSection id={INSPECTOR_SECTION.tableDesign} title={T.tableDesign}>
      <p className="text-[13px] text-ink-soft">{T.designPickHint}</p>
      <ThumbGrid
        value=""
        disabled
        onChange={() => {}}
        options={TABLE_DESIGNS.map((d) => ({ ...d, thumbnail: designThumb(d) }))}
      />
    </CollapsibleSection>
  )
}

/**
 * Apply a named layout and then say what landed.
 *
 * `applyHallLayout` returns the TABLE ids it placed — its own comment says so
 * (`actions.ts:1524`) — and the seats are read back off those tables rather than
 * taken from `layoutStats`: a placement whose preset the catalog no longer has
 * is skipped, and the authored figure would then over-report what is on the
 * floor.
 *
 * No confirmation in front of it. Replacing every table in the hall is one
 * `mutateScene`, so it is one Ctrl+Z away and `zundo` holds 100 of them; the
 * defect this fixes is that the operation completed in SILENCE. It is also
 * synchronous and blocks the main thread, so there is no spinner here either —
 * one would never paint, and a progress bar that cannot progress is a lie.
 */
function applyLayoutAndReport(layoutId: string, options?: HallLayoutOptions): void {
  const ids = applyHallLayout(layoutId, options)
  if (!ids.length) return
  const { objects } = useEditorStore.getState().scene
  const seats = ids.reduce((total, id) => total + (objects[id]?.seating?.count ?? 0), 0)
  notify(N.layoutApplied(ids.length, seats), { tone: 'info' })
}

/** The tables and seats a layout produces, the same line the card carries. */
function LayoutStats({ layout }: { layout: HallLayout }) {
  const stats = layoutStats(layout)
  return (
    <span className="ltr-nums text-[13px] text-ink-soft">
      {stats.tables} {T.tablesSuffix} · {stats.seats} {T.seatsSuffix}
    </span>
  )
}

/**
 * Source doc §22 — the submenu a hall-layout card opens, in place of applying on
 * the spot. Two choices, both handed to `applyHallLayout` and both consumed
 * INSIDE its single mutateScene, so a layout plus its chairs plus its decor is
 * still ONE undo entry (BRIEF §1.5).
 *
 * ⚠ Neither choice is remembered. It changes what THIS apply produces; a chair
 * stored ON the layout would be a new field on SavedLayout and a model change,
 * which PLAN-04 gate 2 puts out of scope.
 *
 * Both pickers are the ones that already exist: `ThumbGrid` is the very grid the
 * table-design section renders, and the chair list is `listByCategory('seating')`
 * — the same source the inspector's per-table chair <select> reads. Nothing here
 * is a second implementation of either.
 *
 * State is local on purpose: the app has no panel registry and no open/closed
 * flag in the store, and which picker a user is looking at is not project data.
 */
function HallLayoutOptions({ layout, onBack }: { layout: HallLayout; onBack: () => void }) {
  const [designId, setDesignId] = useState('')
  const [chairId, setChairId] = useState('')

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-0.5 justify-self-start text-[13px] text-ink-soft hover:text-accent"
      >
        {/* RTL: back is towards the start of the line, i.e. rightwards */}
        <ChevronRight size={14} />
        {T.layoutBack}
      </button>

      <div className="rounded-md border border-accent bg-accent-tint p-1.5">
        <LayoutThumbnail layout={layout} />
        <span className="mt-1 block text-[13px] font-medium leading-tight text-ink">
          {label(layout.labelKey)}
        </span>
        <LayoutStats layout={layout} />
      </div>

      <h4 className="pt-1 text-[13px] font-semibold text-ink-soft">{T.layoutOptions}</h4>
      <p className="text-[13px] text-ink-soft">{T.layoutOptionsHint}</p>

      <span className="pt-1 text-[13px] font-medium text-ink-soft">{T.layoutDesign}</span>
      <ThumbGrid
        value={designId}
        onChange={setDesignId}
        // "no design" is a card like any other: without it there is no way to
        // UNPICK one. It carries pendingLabel because it is not a design and so
        // has no key in strings.presets.items to look up.
        options={[
          { id: '', labelKey: 'layoutDesignNone', pendingLabel: T.layoutDesignNone },
          ...TABLE_DESIGNS.map((d) => ({ ...d, thumbnail: designThumb(d) })),
        ]}
      />

      <label className="grid gap-1 pt-1">
        <span className="text-[13px] font-medium text-ink-soft">{T.layoutChairType}</span>
        <select
          className={selectClass}
          value={chairId}
          onChange={(event) => setChairId(event.target.value)}
        >
          {/* the empty value means "leave each preset's own chair alone" — the
              chair is baked into the preset id (presets.ts TABLE_PRESETS) */}
          <option value="">{T.layoutChairDefault}</option>
          {listByCategory('seating').map((chair) => (
            <option key={chair.id} value={chair.id}>
              {strings.catalog.items[chair.labelKey as keyof typeof strings.catalog.items]}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        data-apply-layout
        className="min-h-10 rounded-md bg-accent px-3 py-2 text-[14px] font-semibold text-white hover:bg-accent-hover"
        onClick={() => {
          applyLayoutAndReport(layout.id, {
            ...(chairId && { chairCatalogId: chairId }),
            ...(designId && { designId }),
          })
          onBack()
        }}
      >
        {T.layoutApply}
      </button>
    </div>
  )
}

/**
 * "Save the hall exactly as it stands now."
 *
 * The counterpart `SaveSelectionSection` was not: it needs tables ticked first
 * and renders at the BOTTOM of the inspector, so with nothing selected — the
 * state you are in when you have just finished arranging the hall — there was no
 * way to save a layout at all, only to apply one. Same NameDialog, same
 * overwrite-by-name rule, same two modes; the snapshot is just the whole floor.
 */
function SaveHallLayoutButton({ existing }: { existing: SavedLayout[] }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<SavedLayoutMode>('layout-design')
  const confirm = useConfirm()

  return (
    <>
      <button className={buttonClass} onClick={() => setOpen(true)}>
        {T.saveHall}
      </button>
      {open && (
        <NameDialog
          title={T.saveHallTitle}
          fieldLabel={T.layoutName}
          placeholder={T.layoutNamePlaceholder}
          escapeDisabled={confirm.open}
          onClose={() => setOpen(false)}
          onSubmit={async (name) => {
            const layout = createHallTablesLayout(name, useEditorStore.getState().scene, mode)
            if (!layout) {
              notify(T.noTables, { tone: 'warn' })
              return
            }
            await saveOrOverwrite(layout, existing, confirm.ask)
          }}
        >
          <ModeChoice mode={mode} onChange={setMode} />
        </NameDialog>
      )}
      {confirm.dialog}
    </>
  )
}

/**
 * Named layout picker: a visual grid of top-view schematics, one card per
 * authored layout for the current venue. A card OPENS ITS OPTIONS (see the file
 * header); the ⚡ in its corner applies it straight away, which is what the card
 * itself used to do. The active card is marked via aria-pressed.
 *
 * "פריסות אישיות" — the user's own saved layouts — stay one-click and stay
 * visible while the options panel is open: they are separate snapshots, not
 * authored layouts, and there is no preset for the panel to re-chair.
 */
export function HallLayoutsSection() {
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const venueWidth = useEditorStore((s) => s.scene.venue.size.width)
  const venueDepth = useEditorStore((s) => s.scene.venue.size.depth)
  const applied = useEditorStore((s) => appliedHallLayoutId(s.scene))
  const layouts = layoutsForVenue(venuePackId)
  const { layouts: all, error } = useVenueLayouts(venuePackId, venueWidth, venueDepth)
  const saved = all.filter((layout) => layout.kind === 'tables')
  // the ID, not the layout: switching venue re-lists the layouts, and a
  // remembered object would leave the panel showing another hall's arrangement
  const [optionsFor, setOptionsFor] = useState<string | null>(null)
  const pending = layouts.find((layout) => layout.id === optionsFor) ?? null

  // No early return any more: the auto-fill footer below is always available,
  // and it used to be a section of its own that rendered whatever this one did.
  return (
    <CollapsibleSection id={INSPECTOR_SECTION.hallLayouts} title={T.layouts} defaultOpen>
      {pending ? (
        <HallLayoutOptions layout={pending} onBack={() => setOptionsFor(null)} />
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {layouts.map((layout) => {
            const active = applied === layout.id
            return (
              <div key={layout.id} className="relative">
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setOptionsFor(layout.id)}
                  className={cardClass(active) + ' pe-8'}
                >
                  <LayoutThumbnail layout={layout} />
                  <span className="text-[13px] font-medium leading-tight text-ink">
                    {label(layout.labelKey)}
                  </span>
                  <LayoutStats layout={layout} />
                </button>
                <button
                  type="button"
                  data-apply-now
                  title={T.layoutApplyNow}
                  aria-label={`${T.layoutApplyNow}: ${label(layout.labelKey)}`}
                  onClick={() => applyLayoutAndReport(layout.id)}
                  className="absolute end-1.5 top-1.5 rounded-md bg-panel/90 p-1.5 text-ink-soft shadow-sm hover:bg-accent-tint hover:text-accent"
                >
                  <Zap size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {/* heading and save button render even with nothing saved yet: an empty
          list is exactly when someone is looking for how to save the first one */}
      <SubHeading>{T.savedLayouts}</SubHeading>
      {saved.length > 0 && (
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
      )}
      <SaveHallLayoutButton existing={saved} />
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
      <AutoFillFooter />
    </CollapsibleSection>
  )
}

/**
 * "Fill the hall with tables" IS a hall layout — an unnamed one, computed rather
 * than authored — so it is this section's footer instead of the section of its
 * own it used to have. Nothing about it changed but where it sits and the fact
 * that it now says what it did.
 */
function AutoFillFooter() {
  const [presetId, setPresetId] = useState(TABLE_PRESETS[0].id)
  const fill = () => {
    const ids = fillHallWithTables(presetId)
    // "no room left" is a refusal, not a result — it keeps the warning colour
    notify(ids.length ? N.filled(ids.length) : N.fillNone, { tone: ids.length ? 'info' : 'warn' })
  }
  return (
    <>
      <SubHeading>{T.autoFill}</SubHeading>
      <Picker value={presetId} onChange={setPresetId} options={TABLE_PRESETS} />
      <button className={buttonClass} title={T.fillHint} onClick={fill}>
        {T.fillHall}
      </button>
    </>
  )
}

/**
 * Source doc §32 — the lighting counterpart of the hall-layout picker. Its own
 * `meta` tag means a saved lighting layout and a saved table layout are applied
 * side by side instead of replacing each other.
 *
 * A BLOCK, not a section: it is the third thing inside the one merged lighting
 * section. It used to be its own band titled "פריסות תאורה אישיות", one below
 * "פריסות תאורה", one below "תאורה חיצונית" — three places to look for the
 * lights, two of them near-identically named.
 */
export function LightingLayoutsBlock() {
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const venueWidth = useEditorStore((s) => s.scene.venue.size.width)
  const venueDepth = useEditorStore((s) => s.scene.venue.size.depth)
  const applied = useEditorStore((s) => appliedLightingLayoutId(s.scene))
  const [saving, setSaving] = useState(false)
  const confirm = useConfirm()
  const { layouts: all } = useVenueLayouts(venuePackId, venueWidth, venueDepth)
  const saved = all.filter((layout) => layout.kind === 'lighting')

  return (
    <>
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
          escapeDisabled={confirm.open}
          onClose={() => setSaving(false)}
          onSubmit={async (name) => {
            const layout = createLightingLayout(name, useEditorStore.getState().scene)
            if (!layout) {
              notify(T.noLighting)
              return
            }
            await saveOrOverwrite(layout, saved, confirm.ask)
          }}
        />
      )}
      {confirm.dialog}
    </>
  )
}

/**
 * "Save this selection as a personal layout." Rendered at the BOTTOM of the
 * inspector: it used to sit above even the selected object's own name, which
 * made the first thing the panel offered after clicking one chair a question
 * about saving a layout.
 */
export function SaveSelectionSection() {
  const selectionCount = useEditorStore((s) => s.selection.length)
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const venueWidth = useEditorStore((s) => s.scene.venue.size.width)
  const venueDepth = useEditorStore((s) => s.scene.venue.size.depth)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<SavedLayoutMode>('layout-design')
  const confirm = useConfirm()
  const { layouts: existing } = useVenueLayouts(venuePackId, venueWidth, venueDepth)
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
      {open && (
        <NameDialog
          title={T.saveTitle}
          fieldLabel={T.layoutName}
          placeholder={T.layoutNamePlaceholder}
          escapeDisabled={confirm.open}
          onClose={() => setOpen(false)}
          onSubmit={async (name) => {
            const { scene, selection } = useEditorStore.getState()
            const layout = createSavedLayout(name, scene, selection, mode)
            if (!layout) return
            await saveOrOverwrite(layout, existing, confirm.ask)
          }}
        >
          <ModeChoice mode={mode} onChange={setMode} />
        </NameDialog>
      )}
      {/* without this the overwrite confirm never mounts, so `ask`'s promise
          never resolves and the name dialog sticks on "saving" forever */}
      {confirm.dialog}
    </Section>
  )
}

/**
 * The ceiling-fixture picker and the one height every fixture hangs at.
 *
 * A BLOCK, not a section: it is the second thing inside the merged lighting
 * section. Its old title was "פריסות תאורה", which sat two bands below
 * "פריסות תאורה אישיות" and answered a different question from both.
 */
export function HallDesignBlock() {
  const [pickedId, setPickedId] = useState(HALL_DESIGNS[0].id)
  // cm above the floor, i.e. transform.elevation: the BOTTOM of the fixture.
  // Only consulted before anything hangs — once it does, the scene is the truth.
  const [hangCm, setHangCm] = useState(() => HALL_DESIGNS[0].floorDistance ?? 0)
  // likewise: the scatter the user last asked for, remembered only until a rig
  // exists to read it off
  const [spreadCm, setSpreadCm] = useState(0)
  const hallApplied = useEditorStore((s) => hasHallDesign(s.scene))
  const appliedId = useEditorStore((s) => appliedHallId(s.scene))
  const appliedCm = useEditorStore((s) => appliedHallBase(s.scene))
  const appliedSpread = useEditorStore((s) => appliedHallSpread(s.scene))
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const wallHeight = useEditorStore((s) => s.scene.venue.wallHeight)

  // The band belongs to the ACTIVE design's fixture, not to the hall: it is
  // `[hangHeight − height, …]`, so a slider ranged once for all five would offer
  // the user heights clampHang silently discards for four of them.
  const hallId = appliedId ?? pickedId
  const hallDesign = getHallDesign(hallId) ?? HALL_DESIGNS[0]
  const fixtureHeight = getCatalogEntry(hallDesign.catalogId).defaultSize.height
  const pack = getVenuePack(venuePackId)
  const range = hangRange(pack, wallHeight, fixtureHeight)
  const shown = Math.min(range.max, Math.max(range.min, appliedCm ?? hangCm))

  // Same reasoning one level down: the scatter is bounded by the headroom THIS
  // fixture has left either side of `shown`, so the user cannot ask for more than
  // fits and never watches a silent clamp eat his input. Lower the height slider
  // and this maximum grows in front of him — which is the answer to "I want more".
  const maxSpread = maxHangSpread(pack, wallHeight, fixtureHeight, shown)
  const shownSpread = Math.min(appliedSpread ?? spreadCm, maxSpread)
  const noRoom = maxSpread < 10

  /**
   * Nest safely inside an outer gesture instead of opening a second one.
   *
   * ⚠ `beginGesture` is idempotent, `endGesture` is NOT: without this guard the
   * inner `endGesture` of the FIRST tick closes the caller's bracket and the rest
   * of the drag records a step per tick again. No test can see it — it is DOM
   * behaviour — so it was measured in the browser instead: 20 undo entries for a
   * 40-move drag of `מרחק מהרצפה`, 38 for a 120-move one.
   */
  const inGesture = (fn: () => void) => {
    if (isGestureActive()) return fn()
    beginGesture()
    try {
      fn()
    } finally {
      endGesture()
    }
  }

  /**
   * Move fixtures already hanging. Re-applying the design instead would throw
   * away any fixture the user had slid along its beam since.
   *
   * One action, one mutation for the whole rig — the old loop of `setElevation`
   * produced N fresh scenes per slider tick.
   */
  const applyHeights = (cm: number, spread: number) => {
    if (!hallFixtureIds(useEditorStore.getState().scene).length) return
    inGesture(() => setHallHeights(cm, spread))
  }

  /**
   * Apply the design and trim its fixtures, as ONE undo entry (BRIEF §1.5) —
   * `applyHallDesign` is a separate mutation from the heights, so without the
   * gesture a single click would cost the user one Ctrl+Z per fixture.
   * `setHallHeights` clamps for itself, which is why the design can state a plain
   * plan-cm height and nothing here re-clamps it.
   */
  const applyHall = (id: string, cm: number, spread: number) => {
    beginGesture()
    try {
      applyHallDesign(id)
      setHallHeights(cm, spread)
    } finally {
      endGesture()
    }
  }

  return (
    <>
      <ThumbGrid
        value={hallId}
        onChange={(id) => {
          // each design carries its own authored height; absent one, the seeded
          // hang (top against the truss) is the top of that fixture's band
          const next = getHallDesign(id)
          const entry = next ? getCatalogEntry(next.catalogId) : null
          const band = entry ? hangRange(pack, wallHeight, entry.defaultSize.height) : range
          const cm = next?.floorDistance ?? band.max
          // the scatter SURVIVES the swap, shrunk to what the new fixture can take:
          // the user chose it, and changing the kind of lamp is not a reason to
          // throw that choice away (PLAN-06 §6ה — arguable, and argued there)
          const spread = entry
            ? Math.min(shownSpread, maxHangSpread(pack, wallHeight, entry.defaultSize.height, cm))
            : shownSpread
          setPickedId(id)
          setHangCm(cm)
          setSpreadCm(spread)
          applyHall(id, cm, spread)
        }}
        options={HALL_DESIGNS.map((d) => ({ ...d, thumbnail: hallThumb(d) }))}
      />
      <SliderField
        label={T.floorDistance}
        value={Math.round(shown) / 100}
        min={Math.round(range.min) / 100}
        max={Math.round(range.max) / 100}
        step={0.05}
        onGestureStart={beginGesture}
        onGestureEnd={endGesture}
        onChange={(v) => {
          setHangCm(v * 100)
          applyHeights(v * 100, shownSpread)
        }}
      />
      {/* Below the height and not above it: the scatter is symmetric ABOUT the
          base, so the base is the sentence's subject and reads first. Both sit
          under `ThumbGrid`, which decides the fixture and therefore the band that
          bounds them both. */}
      <SliderField
        label={T.heightScatter}
        hint={noRoom ? T.heightScatterNoRoom : T.heightScatterHint}
        disabled={noRoom}
        value={Math.round(shownSpread) / 100}
        min={0}
        max={Math.round(Math.max(maxSpread, 1)) / 100}
        step={0.05}
        onGestureStart={beginGesture}
        onGestureEnd={endGesture}
        onChange={(v) => {
          setSpreadCm(v * 100)
          applyHeights(shown, v * 100)
        }}
      />
      {hallApplied && (
        <>
          <button className={buttonClass} onClick={() => reshuffleHallHeights()}>
            {T.heightScatterShuffle}
          </button>
          <button className={dangerClass} onClick={() => removeHallDesign()}>
            {T.remove}
          </button>
        </>
      )}
    </>
  )
}

/**
 * Source doc §5 — the temporary development button that turns the arrangement
 * on screen into `src/core/venueFixtures.ts`, the file every new project is
 * seeded from.
 *
 * ── WHAT IT WRITES ────────────────────────────────────────────────────────────
 * POST /__bake → tools/bake-plugin.ts, which rewrites `src/core/venueFixtures.ts`
 * wholesale. Everything in that file is re-seeded into every NEW project and
 * carries `flags.frozen`, so it can no longer be moved or deleted from the UI.
 * A second bake rewrites the first — frozen fixtures are posted back rather than
 * skipped — so this is idempotent, not additive.
 *
 * ── WHY DEV ONLY ──────────────────────────────────────────────────────────────
 * Gated twice: `import.meta.env.DEV` here, and `apply: 'serve'` on the Vite
 * plugin, so in a production build it neither renders nor has an endpoint to
 * call. It writes to the SOURCE TREE — there is no such thing as doing that from
 * a deployed app ("זמנית … עבור הפיתוח"). Deleting it later needs no other
 * change: the baked file stays, the factory keeps seeding it, `flags.frozen`
 * keeps the roots put.
 *
 * ── WHY THE USER COULD NOT FIND IT (PLAN-04/G2) ───────────────────────────────
 * The button has existed since round 2 and the report was still *"אין כפתור
 * לשמירת אלמנטים כמו שביקשתי"*. Three causes, all fixed here, none of them a
 * missing feature:
 *   1. NAME — it said `'קיבוע האלמנטים'`; he searched for "שמירת מיקום אלמנטים".
 *      Now `strings.presets.bakeSaveElements`, his own words.
 *   2. PLACE — last child of the LAST section in the inspector, below auto-fill,
 *      hall design and lighting layouts. It is now the FIRST thing under the
 *      layout pickers, i.e. directly beneath "פריסות אישיות" — the section he
 *      said he could see while looking for this one.
 *      ⚠ ROUND 4 KEEPS THAT, AND KEEPS IT RELATIONALLY. "פריסות אולם" was
 *      promoted from fifth section to second, and this button moved with it so
 *      that it is still the first thing under the layout pickers. Pinning it to
 *      an absolute position instead would have detached it from the neighbour
 *      the whole fix is built on. It is not collapsed, not gated and not hidden.
 *   3. SILENCE — measured 2026-07-29: writing venueFixtures.ts makes Vite push an
 *      HMR update through every module that imports it, which is most of the app.
 *      Fast Refresh remounts this component and re-evaluates the notice store, so
 *      BOTH the StatusBar line and any useState of ours are gone within
 *      milliseconds of a SUCCESSFUL bake. Pressing the button looked like
 *      pressing a dead button. The result is therefore parked in sessionStorage
 *      and read back on mount — the only feedback here that survives its own
 *      side effect.
 * (The `venueId` gate was never the cause: it is set for every pack project.)
 */
const BAKE_RESULT_KEY = 'hanan.bakeResult'

export function BakeFixturesSection() {
  const venueId = useEditorStore((s) => s.scene.venue.venuePackId)
  const [status, setStatus] = useState(() => sessionStorage.getItem(BAKE_RESULT_KEY) ?? '')
  // what the confirm is about to write, collected before the question is asked
  // so the count in the dialog is the count that gets posted
  const [pending, setPending] = useState<SceneObject[] | null>(null)
  if (!import.meta.env.DEV || !venueId) return null

  const say = (message: string) => {
    sessionStorage.setItem(BAKE_RESULT_KEY, message)
    setStatus(message)
    notify(message)
  }

  const collect = (): SceneObject[] => {
    const { scene } = useEditorStore.getState()
    // `objectOrder` is top-level only, and the chairs and table decor the user
    // arranged are exactly what is NOT in it — walking it was why the button
    // saved a hall of bare tables. Roots keep their z-order, children follow
    // their root, and bakeSource re-parents both into its own id space.
    const roots = new Set(scene.objectOrder)
    // frozen fixtures are sent BACK rather than filtered out, so a second bake
    // rewrites the first one instead of deleting what it produced
    return [
      ...scene.objectOrder.map((id) => scene.objects[id]).filter((o): o is SceneObject => !!o),
      ...Object.values(scene.objects).filter((o) => !roots.has(o.id)),
    ]
  }

  /**
   * This one KEEPS its confirmation while the scene operations around it lose
   * theirs, and the line is the same line everywhere in this file: undo reaches
   * `scene`, and this writes a source file on disk. There is no Ctrl+Z for that.
   */
  const ask = () => {
    const objects = collect()
    if (!objects.length) {
      notify(T.bakeEmpty)
      return
    }
    setPending(objects)
  }

  const bake = async (objects: SceneObject[]) => {
    try {
      const res = await fetch('/__bake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ venueId, objects }),
      })
      if (!res.ok) throw new Error(`bake failed: ${res.status}`)
      say(T.bakeDone(objects.length))
    } catch (err) {
      console.error('bake failed', err)
      say(T.bakeFailed)
    }
  }

  // A titleless section: the button's own label already says what it does, so a
  // <Section> heading here would print the same sentence twice. The wrapper
  // carries Section's own padding and rule so it sits in the panel like one.
  return (
    <div className="grid gap-1.5 border-b border-line px-4 py-3.5">
      <button
        type="button"
        data-bake-fixtures
        className={`${buttonClass} flex w-full items-center justify-center gap-2`}
        onClick={ask}
      >
        <Pin size={15} />
        {T.bakeSaveElements}
      </button>
      <p className="text-[13px] text-ink-soft">{T.bakeHint}</p>
      {/*
        There is deliberately no "top-level objects only" caption here. One was
        seeded for this button against a limitation that no longer exists: the POST
        above sends roots AND every child. Measured on a real bake, 2026-07-29: the
        generated file held 336 chairs, 336 place settings and 84 candlesticks
        beside its 28 tables. Printing it would tell the user his chairs were
        dropped when they were not, so the string was deleted outright rather than
        left lying in wait (handoff/FOUND-04.md §1). What IS still true and unsaid:
        only the roots are frozen — the chairs and centrepieces bake and reload, but
        stay selectable and deletable.
      */}
      {status && (
        <p role="status" className="text-[13px] text-success">
          {status}
        </p>
      )}
      {pending && (
        <ConfirmDialog
          danger
          title={strings.dialog.bakeTitle}
          // the question carries the count, the second sentence says what the
          // write actually does — `window.confirm` could only run them together
          // with a `\n\n` between them
          body={`${T.bakeConfirm(pending.length)} ${T.bakeConfirmBody}`}
          cancelLabel={strings.dialog.cancel}
          confirmLabel={strings.dialog.bakeConfirmAction}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null)
            void bake(pending)
          }}
        />
      )}
    </div>
  )
}
