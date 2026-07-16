/**
 * Project dashboard — the launch surface shown when no project is open. Lists
 * saved events as preview cards, creates new ones (blank or from a sample
 * layout), and deletes with confirmation. All persistence goes through the
 * IndexedDB repository; opening hands a fully-formed Project up to the app.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { createObject, createProject } from '../core/model/factory'
import { reconcileSeats } from '../core/model/seatingReconciler'
import type { Project, SceneObject } from '../core/model/types'
import { VENUE_PACKS } from '../core/venuePacks'
import { makeProjectFile } from '../persistence/autosave'
import { indexedDbRepository } from '../persistence/indexedDbRepository'
import { stringsPersist as S } from '../persistence/stringsPersist'
import type { ProjectSummary } from '../persistence/types'

const repo = indexedDbRepository

// --- helpers ---------------------------------------------------------------

function parseDateInput(value: string): Date {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return new Date(value)
}

function formatEventDate(value?: string): string {
  if (!value) return S.dashboard.noDate
  const d = parseDateInput(value)
  if (Number.isNaN(d.getTime())) return S.dashboard.noDate
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

/** Small Hebrew relative-time formatter ("עודכן לפני…"). */
function formatRelativeTime(iso: string): string {
  const rt = S.relativeTime
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (sec < 45) return rt.justNow
  const min = Math.floor(sec / 60)
  if (min <= 1) return rt.minuteOne
  if (min < 60) return rt.minutes(min)
  const hr = Math.floor(min / 60)
  if (hr === 1) return rt.hourOne
  if (hr < 24) return rt.hours(hr)
  const day = Math.floor(hr / 24)
  if (day === 1) return rt.dayOne
  if (day < 7) return rt.days(day)
  const week = Math.floor(day / 7)
  if (day < 30) return week === 1 ? rt.weekOne : rt.weeks(week)
  const month = Math.floor(day / 30)
  if (day < 365) return month === 1 ? rt.monthOne : rt.months(month)
  const year = Math.floor(day / 365)
  return year === 1 ? rt.yearOne : rt.years(year)
}

/** Populate a project with a tasteful demo layout (built directly, no store). */
function buildSampleScene(project: Project): void {
  const scene = project.scene
  const vw = scene.venue.size.width
  const vd = scene.venue.size.depth
  const place = (catalogId: string, x: number, y: number): SceneObject => {
    const obj = createObject(catalogId, { x, y })
    scene.objects[obj.id] = obj
    scene.objectOrder.push(obj.id)
    return obj
  }
  // stage centered near the top wall, dance floor directly in front of it
  place('stage.platform', vw / 2, vd * 0.14)
  place('dancefloor.rect', vw / 2, vd * 0.36)
  // bar tucked against a side
  place('bar.straight', vw * 0.16, vd * 0.5)
  // greenery framing the stage
  place('plant.potted', vw * 0.08, vd * 0.09)
  place('plant.potted', vw * 0.92, vd * 0.09)
  // six round tables, two columns of three, each fully seated
  const columns = [vw * 0.35, vw * 0.65]
  const rows = [vd * 0.58, vd * 0.74, vd * 0.9]
  let number = 1
  for (const y of rows) {
    for (const x of columns) {
      const table = place('table.round', x, y)
      table.meta.number = number++
      if (table.seating) table.seating.count = 8
      reconcileSeats(scene, table.id)
    }
  }
}

interface NewProjectResult {
  name: string
  eventName?: string
  eventDate?: string
  widthM: number
  depthM: number
  sample: boolean
  venuePackId: string | null
}

// --- preview card ----------------------------------------------------------

function CardPreview({ id, name }: { id: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let created: string | null = null
    void repo.loadPreviewUrl(id).then((u) => {
      if (!active) {
        if (u) URL.revokeObjectURL(u)
        return
      }
      created = u
      setUrl(u)
    })
    return () => {
      active = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [id])

  if (url) {
    return <img src={url} alt="" className="h-full w-full object-cover" />
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas">
      <span className="text-4xl font-semibold text-ink-soft/50 select-none">
        {name.trim().charAt(0) || '·'}
      </span>
    </div>
  )
}

function KebabMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={S.dashboard.moreActions}
        className="rounded-md bg-panel/80 p-1.5 text-ink-soft backdrop-blur hover:bg-panel hover:text-ink"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="absolute end-0 top-full z-10 mt-1 min-w-[140px] overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-lg">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-danger hover:bg-danger/10"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
              onDelete()
            }}
          >
            <Trash2 size={15} />
            {S.dashboard.menuDelete}
          </button>
        </div>
      )}
    </div>
  )
}

function ProjectCard({
  summary,
  onOpen,
  onDelete,
}: {
  summary: ProjectSummary
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      role="button"
      tabIndex={0}
      aria-label={`${S.dashboard.openProject}: ${summary.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="group cursor-pointer overflow-hidden rounded-xl border border-line bg-panel shadow-sm outline-none hover:border-accent/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-line">
        <CardPreview id={summary.id} name={summary.name} />
        <div className="absolute end-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <KebabMenu onDelete={onDelete} />
        </div>
      </div>
      <div className="p-3">
        <div className="truncate text-[14px] font-semibold text-ink">{summary.name}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-soft">
          <CalendarDays size={13} className="shrink-0" />
          <span className="truncate">{formatEventDate(summary.eventDate)}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-ink-soft/80">
          {formatRelativeTime(summary.updatedAt)}
        </div>
      </div>
    </motion.div>
  )
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="aspect-[16/10] w-full animate-pulse bg-canvas" />
      <div className="space-y-2 p-3">
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-canvas" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-canvas" />
      </div>
    </div>
  )
}

// --- empty state -----------------------------------------------------------

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <svg width="132" height="96" viewBox="0 0 132 96" fill="none" className="mb-6 text-line">
        <rect x="1" y="1" width="130" height="94" rx="6" stroke="currentColor" strokeWidth="2" />
        <rect x="49" y="10" width="34" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
        <circle cx="34" cy="52" r="9" stroke="currentColor" strokeWidth="2" />
        <circle cx="66" cy="52" r="9" stroke="currentColor" strokeWidth="2" />
        <circle cx="98" cy="52" r="9" stroke="currentColor" strokeWidth="2" />
        <circle cx="34" cy="78" r="9" stroke="currentColor" strokeWidth="2" />
        <circle cx="66" cy="78" r="9" stroke="currentColor" strokeWidth="2" />
        <circle cx="98" cy="78" r="9" stroke="currentColor" strokeWidth="2" />
      </svg>
      <h2 className="text-lg font-semibold text-ink">{S.dashboard.emptyTitle}</h2>
      <p className="mt-2 max-w-sm text-[13px] text-ink-soft">{S.dashboard.emptyBody}</p>
      <button
        type="button"
        onClick={onNew}
        className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-hover"
      >
        <Plus size={16} />
        {S.dashboard.newEvent}
      </button>
    </div>
  )
}

// --- modals ----------------------------------------------------------------

function ModalShell({
  onClose,
  labelledBy,
  children,
}: {
  onClose: () => void
  labelledBy: string
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function fieldLabel(text: string) {
  return <span className="mb-1 block text-[12px] font-medium text-ink-soft">{text}</span>
}

const inputClass =
  'w-full rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-ink outline-none focus:border-accent'

function NewProjectModal({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (r: NewProjectResult) => void
}) {
  const [name, setName] = useState('')
  const [eventName, setEventName] = useState('')
  const [date, setDate] = useState('')
  const [width, setWidth] = useState('24')
  const [depth, setDepth] = useState('16')
  const [sample, setSample] = useState(false)
  const [venuePackId, setVenuePackId] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const trimmedName = name.trim()
  const nameValid = trimmedName.length > 0

  const toMeters = (v: string, fallback: number) => {
    const n = Number.parseFloat(v)
    return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : fallback
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (!nameValid) {
      nameRef.current?.focus()
      return
    }
    onCreate({
      name: trimmedName,
      eventName: eventName.trim() || undefined,
      eventDate: date || undefined,
      widthM: toMeters(width, 24),
      depthM: toMeters(depth, 16),
      sample,
      venuePackId,
    })
  }

  return (
    <ModalShell onClose={onCancel} labelledBy="new-project-title">
      <h2 id="new-project-title" className="mb-4 text-[15px] font-semibold text-ink">
        {S.newModal.title}
      </h2>
      <form onSubmit={submit} className="space-y-3.5">
        <label className="block">
          {fieldLabel(S.newModal.projectName)}
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={S.newModal.projectNamePlaceholder}
            className={inputClass}
            aria-invalid={submitted && !nameValid}
            style={submitted && !nameValid ? { borderColor: 'var(--color-danger)' } : undefined}
          />
        </label>
        <label className="block">
          {fieldLabel(S.newModal.eventName)}
          <input
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder={S.newModal.eventNamePlaceholder}
            className={inputClass}
          />
        </label>
        <label className="block">
          {fieldLabel(S.newModal.date)}
          <input
            type="date"
            dir="ltr"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </label>
        <div>
          {fieldLabel('אולם')}
          <div className="grid grid-cols-2 gap-2">
            {[{ id: null, name: 'ריק (מידות ידניות)' }, ...VENUE_PACKS].map((opt) => (
              <button
                key={opt.id ?? 'blank'}
                type="button"
                onClick={() => setVenuePackId(opt.id)}
                className={`rounded-md border px-3 py-2 text-[13px] transition-colors ${
                  venuePackId === opt.id
                    ? 'border-accent bg-accent-tint text-accent'
                    : 'border-line bg-panel text-ink-soft hover:border-accent/40'
                }`}
              >
                {opt.name}
              </button>
            ))}
          </div>
        </div>
        {venuePackId === null && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              {fieldLabel(S.newModal.venueWidth)}
              <input
                type="number"
                dir="ltr"
                min={2}
                step={0.5}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className={`${inputClass} ltr-nums`}
              />
            </label>
            <label className="block">
              {fieldLabel(S.newModal.venueDepth)}
              <input
                type="number"
                dir="ltr"
                min={2}
                step={0.5}
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
                className={`${inputClass} ltr-nums`}
              />
            </label>
          </div>
        )}
        <div>
          {fieldLabel(S.newModal.layoutLabel)}
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: false, label: S.newModal.startBlank },
              { value: true, label: S.newModal.startSample },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => setSample(opt.value)}
                className={`rounded-md border px-3 py-2 text-[13px] transition-colors ${
                  sample === opt.value
                    ? 'border-accent bg-accent-tint text-accent'
                    : 'border-line bg-panel text-ink-soft hover:border-accent/40'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-[13px] font-medium text-ink-soft hover:bg-canvas"
          >
            {S.newModal.cancel}
          </button>
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-hover"
          >
            {S.newModal.create}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

function DeleteConfirmModal({
  summary,
  onCancel,
  onConfirm,
}: {
  summary: ProjectSummary
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])
  return (
    <ModalShell onClose={onCancel} labelledBy="delete-title">
      <h2 id="delete-title" className="mb-2 text-[15px] font-semibold text-ink">
        {S.deleteModal.title}
      </h2>
      <p className="text-[13px] text-ink-soft">{S.deleteModal.body(summary.name)}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-[13px] font-medium text-ink-soft hover:bg-canvas"
        >
          {S.deleteModal.cancel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-danger px-4 py-2 text-[13px] font-medium text-white hover:brightness-95"
        >
          {S.deleteModal.confirm}
        </button>
      </div>
    </ModalShell>
  )
}

// --- dashboard -------------------------------------------------------------

export function Dashboard({ onOpen }: { onOpen: (project: Project) => void }) {
  const [summaries, setSummaries] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)

  const refresh = useCallback(async () => {
    setError(false)
    setSummaries(null)
    try {
      setSummaries(await repo.list())
    } catch (err) {
      console.error('failed to list projects', err)
      setError(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleOpen = useCallback(
    async (id: string) => {
      try {
        const file = await repo.load(id)
        if (file) onOpen(file.project)
      } catch (err) {
        console.error('failed to open project', err)
      }
    },
    [onOpen],
  )

  const handleCreate = useCallback(
    async (r: NewProjectResult) => {
      const project = createProject({
        name: r.name,
        eventName: r.eventName,
        eventDate: r.eventDate,
        venueWidth: Math.round(r.widthM * 100),
        venueDepth: Math.round(r.depthM * 100),
        venuePackId: r.venuePackId,
      })
      if (r.sample) buildSampleScene(project)
      await repo.save(makeProjectFile(project))
      setShowNew(false)
      onOpen(project)
    },
    [onOpen],
  )

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    try {
      await repo.remove(id)
    } catch (err) {
      console.error('failed to delete project', err)
    }
    void refresh()
  }, [deleteTarget, refresh])

  return (
    <div className="h-full overflow-y-auto bg-chrome">
      <header className="sticky top-0 z-20 flex h-[60px] items-center justify-between border-b border-line bg-chrome/90 px-6 backdrop-blur">
        <h1 className="text-[17px] font-semibold text-ink">{S.dashboard.wordmark}</h1>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-hover"
        >
          <Plus size={16} />
          {S.dashboard.newEvent}
        </button>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {error ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[14px] text-ink">{S.dashboard.loadError}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-4 rounded-md border border-line bg-panel px-4 py-2 text-[13px] font-medium text-ink hover:border-accent"
            >
              {S.dashboard.retry}
            </button>
          </div>
        ) : summaries === null ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : summaries.length === 0 ? (
          <EmptyState onNew={() => setShowNew(true)} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
            {summaries.map((s) => (
              <ProjectCard
                key={s.id}
                summary={s}
                onOpen={() => void handleOpen(s.id)}
                onDelete={() => setDeleteTarget(s)}
              />
            ))}
          </div>
        )}
      </main>

      {showNew && (
        <NewProjectModal onCancel={() => setShowNew(false)} onCreate={(r) => void handleCreate(r)} />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          summary={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}
    </div>
  )
}
