import {
  Download,
  FileJson,
  FileUp,
  Grid3x3,
  Hand,
  Home,
  Image,
  Magnet,
  MousePointer2,
  Redo2,
  Tag,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useStore } from 'zustand'
import { indexedDbRepository } from '../persistence/indexedDbRepository'
import { makeProjectFile, saveNow } from '../persistence/autosave'
import { downloadProjectJson, exportFloorPlanPng, importProjectJson } from '../persistence/export'
import { clearAllObjects, closeProject, loadProject, redo, setMode, setProjectName, undo, updateSettings } from '../state/actions'
import { temporalStore, useEditorStore, type ViewMode } from '../state/store'
import { overlay, useOverlayStore } from '../editor2d/overlayStore'
import { strings } from './strings'

function IconButton({
  title,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md p-1.5 transition-colors ${
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

const Divider = () => <div className="mx-1.5 h-6 border-s border-line" />

export function Toolbar() {
  const projectName = useEditorStore((s) => s.projectName)
  const mode = useEditorStore((s) => s.mode)
  const settings = useEditorStore((s) => s.scene.settings)
  const handTool = useOverlayStore((s) => s.handTool)
  const canUndo = useStore(temporalStore, (s) => s.pastStates.length > 0)
  const canRedo = useStore(temporalStore, (s) => s.futureStates.length > 0)
  const hasObjects = useEditorStore((s) => Object.keys(s.scene.objects).length > 0)

  const modes: Array<{ id: ViewMode; label: string }> = [
    { id: '2d', label: strings.viewMode.d2 },
    { id: 'split', label: strings.viewMode.split },
    { id: '3d', label: strings.viewMode.d3 },
  ]

  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-line bg-chrome px-3">
      {/* start (right in RTL): navigation + project + history + tools */}
      <div className="flex min-w-0 items-center gap-1">
        <IconButton
          title={strings.toolbar.backToDashboard}
          onClick={() => {
            void saveNow(indexedDbRepository).finally(closeProject)
          }}
        >
          <Home size={18} />
        </IconButton>
        <input
          className="min-w-0 max-w-48 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-[14px] font-semibold hover:border-line focus:border-accent focus:outline-none"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label={strings.inspector.projectName}
        />
        <Divider />
        <IconButton title={`${strings.toolbar.undo} · Ctrl+Z`} disabled={!canUndo} onClick={undo}>
          <Undo2 size={18} className="rtl:-scale-x-100" />
        </IconButton>
        <IconButton title={`${strings.toolbar.redo} · Ctrl+Y`} disabled={!canRedo} onClick={redo}>
          <Redo2 size={18} className="rtl:-scale-x-100" />
        </IconButton>
        <IconButton title={strings.toolbar.clearAll} disabled={!hasObjects} onClick={clearAllObjects}>
          <Trash2 size={18} />
        </IconButton>
        <Divider />
        <IconButton title="בחירה · V" active={!handTool} onClick={() => overlay.setHandTool(false)}>
          <MousePointer2 size={18} />
        </IconButton>
        <IconButton title="יד · H" active={handTool} onClick={() => overlay.setHandTool(true)}>
          <Hand size={18} />
        </IconButton>
      </div>

      {/* center: view mode switch */}
      <div className="flex items-center rounded-lg border border-line bg-panel p-0.5">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`rounded-md px-3.5 py-1 text-[12px] font-semibold transition-colors ${
              mode === m.id ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* end (left in RTL): canvas toggles + export */}
      <div className="flex items-center gap-1">
        <IconButton
          title={`${strings.toolbar.grid} · G`}
          active={settings.showGrid}
          onClick={() => updateSettings({ showGrid: !settings.showGrid })}
        >
          <Grid3x3 size={18} />
        </IconButton>
        <IconButton
          title={`${strings.toolbar.snap} · Shift+G`}
          active={settings.snapEnabled}
          onClick={() => updateSettings({ snapEnabled: !settings.snapEnabled })}
        >
          <Magnet size={18} />
        </IconButton>
        <IconButton
          title={strings.toolbar.labels}
          active={settings.showLabels}
          onClick={() => updateSettings({ showLabels: !settings.showLabels })}
        >
          <Tag size={18} />
        </IconButton>
        <Divider />
        <ExportMenu />
      </div>
    </header>
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
      window.alert(strings.status.saveFailed)
    }
  }

  const items = [
    {
      label: strings.toolbar.exportPng,
      icon: <Image size={14} />,
      run: () => exportFloorPlanPng(useEditorStore.getState().projectName),
    },
    {
      label: strings.toolbar.exportJson,
      icon: <FileJson size={14} />,
      run: () => downloadProjectJson(useEditorStore.getState()),
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
        className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-hover"
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-[13px] text-ink hover:bg-accent-tint"
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
