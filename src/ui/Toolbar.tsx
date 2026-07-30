import {
  Download,
  FileJson,
  FileUp,
  Grid3x3,
  Hand,
  HelpCircle,
  Home,
  Image,
  Lightbulb,
  Magnet,
  MousePointer2,
  PartyPopper,
  Redo2,
  Tag,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { indexedDbRepository } from '../persistence/indexedDbRepository'
import { makeProjectFile, saveNow } from '../persistence/autosave'
import { downloadProjectJson, exportFloorPlanPng, importProjectJson } from '../persistence/export'
import { clearAllObjects, closeProject, loadProject, redo, setActiveZone, setMode, setProjectName, undo, updateSettings } from '../state/actions'
import { notify } from '../state/notice'
import { isFrozen } from '../state/selectors'
import { temporalStore, useEditorStore, type ViewMode } from '../state/store'
import { chordFor } from '../core/shortcuts'
import { getVenuePack } from '../core/venuePacks'
import { isLightingPlanOn, overlay, useOverlayStore } from '../editor2d/overlayStore'
import { Tooltip } from './Tooltip'
import { strings } from './strings'

type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'title'> & {
  /** What the control IS. Its accessible name, and its native tooltip when it has no `Tooltip`. */
  title: string
  active?: boolean
}

function IconButton({ title, active = false, disabled = false, children, ...rest }: IconButtonProps) {
  return (
    <button
      // ⚠ The derived attributes come FIRST and `...rest` overrides them, which
      // is what makes this wrappable in `Tooltip`. Tooltip clones its child with
      // `title: undefined`, `aria-label` and `aria-describedby`; written the
      // other way round — spread first, `aria-label={title}` after — the clone's
      // `title: undefined` lands in the destructure, the derived `aria-label`
      // then resolves to undefined and OVERWRITES the real one, and an icon-only
      // button ends up with no accessible name at all. (FOUND-X2 §1 asked for
      // the spread first; that ordering reintroduces the very bug it reports.)
      title={title}
      aria-label={title}
      disabled={disabled}
      {...rest}
      className={`rounded-md p-2 transition-colors ${
        active
          ? 'bg-accent-tint text-accent'
          : disabled
            ? 'text-ink-soft/40'
            : 'text-ink-soft hover:bg-accent-tint hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * A mode toggle that says what it is: icon AND label, filled while it is on.
 *
 * Source doc §18 — the kabalat-panim toggle used to be a bare icon and nothing
 * told the user what pressing it would do. The two working MODES on this bar get
 * this treatment; the plain on/off canvas switches stay `IconButton`s.
 */
type ToggleChipProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
  label: string
  icon: React.ReactNode
  active: boolean
}

function ToggleChip({ label, icon, active, ...rest }: ToggleChipProps) {
  return (
    <button
      {...rest}
      title={label}
      aria-pressed={active}
      className={`flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] font-semibold transition-colors ${
        active
          ? 'border-accent bg-accent text-white'
          : 'border-line text-ink-soft hover:bg-accent-tint hover:text-ink'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}

const Divider = () => <div className="mx-1.5 h-7 border-s border-line" />

/**
 * Warm the 3D chunk while the pointer is still travelling to the button.
 *
 * The built `Scene3D` chunk is ~1.16 MB (321 kB gzipped) and must download and
 * parse before anything can render — a phase `useProgress` cannot see, so the
 * pane sits blank through all of it. Hover-to-click is 200–800 ms of otherwise
 * dead time.
 *
 * ⚠ The specifier must resolve to the SAME module `App.tsx:18` lazy-imports or
 * Vite emits a second chunk and this warms the wrong one. That import is
 * `'../viewer3d/Scene3D'` from `src/app/`; this file is `src/ui/`, so the same
 * text resolves to the same file. Idempotent — a module already in flight or
 * evaluated comes straight back out of the registry.
 */
function prefetchScene3D(): void {
  void import('../viewer3d/Scene3D')
}

export function Toolbar() {
  const projectName = useEditorStore((s) => s.projectName)
  const mode = useEditorStore((s) => s.mode)
  const settings = useEditorStore((s) => s.scene.settings)
  const handTool = useOverlayStore((s) => s.handTool)
  const canUndo = useStore(temporalStore, (s) => s.pastStates.length > 0)
  const canRedo = useStore(temporalStore, (s) => s.futureStates.length > 0)
  const activeZone = useEditorStore((s) => s.activeZone)
  // derived, not stored: arming a `lighting` item turns the mode on too
  const lightingPlan = useOverlayStore(isLightingPlanOn)
  // only packs that actually mark a reception area get the toggle — the
  // procedural room and any future venue without one simply do not show it
  const hasKabalatPanim = useEditorStore((s) =>
    (getVenuePack(s.scene.venue.venuePackId)?.restricted ?? []).some((z) => z.kind === 'kabalatPanim'),
  )

  const modes: Array<{ id: ViewMode; label: string }> = [
    { id: '2d', label: strings.viewMode.d2 },
    { id: 'split', label: strings.viewMode.split },
    { id: '3d', label: strings.viewMode.d3 },
  ]

  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-line bg-chrome px-3">
      {/* start (right in RTL): navigation + project + history + tools */}
      <div className="flex min-w-0 items-center gap-1">
        <Tooltip label={strings.toolbar.backToDashboard}>
          <IconButton
            title={strings.toolbar.backToDashboard}
            onClick={() => {
              void saveNow(indexedDbRepository).finally(closeProject)
            }}
          >
            <Home size={18} />
          </IconButton>
        </Tooltip>
        <input
          className="min-h-9 min-w-0 max-w-48 truncate rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[15px] font-semibold hover:border-line focus:border-accent focus:outline-none"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label={strings.inspector.projectName}
        />
        <Divider />
        {/* The chord comes from the catalog, never from a literal here — that is
            the whole point of `core/shortcuts.ts`, and it is what stops a
            tooltip and the help table from ever disagreeing. `undoRedo` is ONE
            catalog entry covering both directions, so both buttons print its
            pair; see the report. */}
        <Tooltip label={strings.toolbar.undo} chord={chordFor('undoRedo')}>
          <IconButton title={strings.toolbar.undo} disabled={!canUndo} onClick={undo}>
            <Undo2 size={18} className="rtl:-scale-x-100" />
          </IconButton>
        </Tooltip>
        <Tooltip label={strings.toolbar.redo} chord={chordFor('undoRedo')}>
          <IconButton title={strings.toolbar.redo} disabled={!canRedo} onClick={redo}>
            <Redo2 size={18} className="rtl:-scale-x-100" />
          </IconButton>
        </Tooltip>
        <ClearAllControl />
        <Divider />
        <Tooltip label={strings.toolbar.selectTool} chord={chordFor('selectTool')}>
          <IconButton
            title={strings.toolbar.selectTool}
            active={!handTool}
            onClick={() => overlay.setHandTool(false)}
          >
            <MousePointer2 size={18} />
          </IconButton>
        </Tooltip>
        <Tooltip label={strings.toolbar.handTool} chord={chordFor('handTool')}>
          <IconButton
            title={strings.toolbar.handTool}
            active={handTool}
            onClick={() => overlay.setHandTool(true)}
          >
            <Hand size={18} />
          </IconButton>
        </Tooltip>
      </div>

      {/* center: view mode switch */}
      <div className="flex items-center rounded-lg border border-line bg-panel p-0.5">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            // both panes that show 3D warm the chunk; '2d' has nothing to warm
            onPointerEnter={m.id === '2d' ? undefined : prefetchScene3D}
            className={`min-h-9 rounded-md px-3.5 py-1.5 text-[14px] font-semibold transition-colors ${
              mode === m.id ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* end (left in RTL): canvas toggles · working modes · help · export */}
      <div className="flex items-center gap-1">
        <Tooltip label={strings.toolbar.grid} chord={chordFor('toggleGrid')}>
          <IconButton
            title={strings.toolbar.grid}
            active={settings.showGrid}
            onClick={() => updateSettings({ showGrid: !settings.showGrid })}
          >
            <Grid3x3 size={18} />
          </IconButton>
        </Tooltip>
        <Tooltip label={strings.toolbar.snap} chord={chordFor('toggleSnap')}>
          <IconButton
            title={strings.toolbar.snap}
            active={settings.snapEnabled}
            onClick={() => updateSettings({ snapEnabled: !settings.snapEnabled })}
          >
            <Magnet size={18} />
          </IconButton>
        </Tooltip>
        <Tooltip label={strings.toolbar.labels}>
          <IconButton
            title={strings.toolbar.labels}
            active={settings.showLabels}
            onClick={() => updateSettings({ showLabels: !settings.showLabels })}
          >
            <Tag size={18} />
          </IconButton>
        </Tooltip>
        <Divider />
        <ToggleChip
          data-lighting-plan
          label={strings.toolbar.lightingPlan}
          icon={<Lightbulb size={16} />}
          active={lightingPlan}
          onClick={() => overlay.toggleLightingPlan()}
        />
        {hasKabalatPanim && (
          // the label is what pressing DOES, so it swaps with the zone; `active`
          // is what the plan is showing right now (handoff/04-plan-style.md §7)
          <ToggleChip
            data-zone-toggle
            label={
              activeZone === 'kabalatPanim'
                ? strings.toolbar.kabalatPanimOn
                : strings.toolbar.kabalatPanimOff
            }
            icon={<PartyPopper size={16} />}
            active={activeZone === 'kabalatPanim'}
            onClick={() => setActiveZone(activeZone === 'kabalatPanim' ? 'hall' : 'kabalatPanim')}
          />
        )}
        {/* The one visible way in to the help panel. Until now `/` opened it and
            the only place that fact was written down was INSIDE it. One button
            here covers 2D, split and 3D, because this bar renders above the
            split — 3D's own `?` sits on its hint chip and belongs to that view. */}
        <Tooltip label={strings.toolbar.help} chord={chordFor('help')}>
          <IconButton title={strings.toolbar.help} onClick={() => overlay.toggleHelp()}>
            <HelpCircle size={18} />
          </IconButton>
        </Tooltip>
        <Divider />
        <ExportMenu />
      </div>
    </header>
  )
}

/** How long the armed state survives without a second press. */
const ARM_MS = 3500

/**
 * `ניקוי כל האלמנטים` — armed, then executed. Two presses, no dialog.
 *
 * It used to empty the plan on ONE click of an unlabelled bin, with no
 * confirmation of any kind, while deleting a single saved layout did ask. But a
 * modal is the wrong correction: `clearAllObjects` goes through `mutateScene`,
 * so the whole wipe is a SINGLE undo entry and `zundo` keeps 100 of them — this
 * round confirms only what undo cannot reach. What was missing is not a guard
 * but a beat, and a name on the thing being spent.
 *
 * So the first press swaps the icon for the labelled `ToggleChip` this bar
 * already uses for its modes, and the control names its own magnitude before
 * the press that spends it — the cheapest de-risking there is, at zero
 * interruptions. Blur, Escape or 3.5 s disarm it. The toast that follows carries
 * a real undo BUTTON, which is the one moment the user needs to know undo is
 * there.
 */
function ClearAllControl() {
  // exactly what `clearAllObjects` will remove: everything but the baked venue
  // fixtures, which are part of the hall and not of the event. The old
  // `disabled={!hasObjects}` counted those too, so a plan holding nothing but
  // fixtures offered a live button that would clear nothing.
  const count = useEditorStore(
    (s) => Object.values(s.scene.objects).filter((obj) => !isFrozen(obj)).length,
  )
  const [armed, setArmed] = useState(false)

  // The timeout lives with the state it expires, so disarming by any other
  // route — the second press, blur, Escape, or the toolbar unmounting — clears
  // it through the same cleanup instead of four callers remembering to.
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), ARM_MS)
    return () => window.clearTimeout(timer)
  }, [armed])

  if (!armed) {
    const label = strings.toolbar.clearAllWithCount(count)
    return (
      <Tooltip label={label}>
        <IconButton title={label} disabled={count === 0} onClick={() => setArmed(true)}>
          <Trash2 size={18} />
        </IconButton>
      </Tooltip>
    )
  }

  return (
    <ToggleChip
      // React mounts a DIFFERENT element here, so the click that armed it loses
      // focus. Handing it back is what makes Escape and blur reachable at all —
      // and the focus lands on the control the user just pressed, which is where
      // it already was.
      autoFocus
      label={strings.toolbar.clearAllArmed}
      icon={<Trash2 size={16} />}
      active
      onClick={() => {
        setArmed(false)
        clearAllObjects()
        // AFTER the mutation: `notify` captures the undo depth at this instant,
        // and the button disables itself the moment that depth moves. `count`
        // is the pre-clear number, i.e. how many objects just went.
        notify(strings.notice.cleared(count), { undo: true })
      }}
      onBlur={() => setArmed(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setArmed(false)
      }}
    />
  )
}

function ExportMenu() {
  const [open, setOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleImport = async (file: File) => {
    try {
      const project = await importProjectJson(file)
      loadProject(project)
      await indexedDbRepository.save(makeProjectFile(project))
    } catch (err) {
      console.error('import failed', err)
      // was `alert(status.saveFailed)` — the wrong message on the wrong
      // mechanism: this is an IMPORT that failed, and a modal alert for it
      // blocks the thread to say something the toast stack says better.
      notify(strings.notice.importFailed, { tone: 'error' })
    }
  }

  const items = [
    {
      label: strings.toolbar.exportPng,
      icon: <Image size={14} />,
      run: () => {
        // `exportFloorPlanPng` returns false when there is no capture source,
        // and its boolean used to be discarded. That is not a theoretical
        // branch: in full 3D, `SplitView` gives the 2D pane `display:none`, so
        // `useElementSize` reports 0×0, so `Stage2D` unrenders the `<Stage>`,
        // so `stageRef.current` is null and the capture returns null — the
        // export did nothing at all, forever, without a word. The refusal names
        // both the cause and the way round it.
        if (exportFloorPlanPng(useEditorStore.getState().projectName)) {
          notify(strings.notice.exportPngDone, { tone: 'info' })
        } else {
          notify(strings.notice.exportPngFailed)
        }
      },
    },
    {
      label: strings.toolbar.exportJson,
      icon: <FileJson size={14} />,
      run: () => void downloadProjectJson(useEditorStore.getState()),
    },
    {
      label: strings.toolbar.importJson,
      icon: <FileUp size={14} />,
      run: () => fileRef.current?.click(),
    },
  ]

  return (
    <div className="relative">
      <button
        className="flex min-h-9 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[14px] font-semibold text-white hover:bg-accent-hover"
        onClick={() => setOpen((v) => !v)}
        title={strings.toolbar.export}
      >
        <Download size={15} />
        {strings.toolbar.export}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute end-0 top-full z-50 mt-1 min-w-52 rounded-lg border border-line bg-panel py-1 shadow-lg">
            {items.map((item) => (
              <button
                key={item.label}
                className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-start text-[14px] text-ink hover:bg-accent-tint"
                onClick={() => {
                  setOpen(false)
                  item.run()
                }}
              >
                <span className="text-ink-soft">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleImport(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
