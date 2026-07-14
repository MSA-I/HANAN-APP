import { lazy, Suspense, useEffect, useState } from 'react'
import { Stage2D } from '../editor2d/Stage2D'
import { startAutosave } from '../persistence/autosave'
import { indexedDbRepository } from '../persistence/indexedDbRepository'
import { loadProject } from '../state/actions'
import { useEditorStore } from '../state/store'
import { InspectorPanel } from '../ui/InspectorPanel'
import { LibraryPanel } from '../ui/LibraryPanel'
import { ShortcutsHelp } from '../ui/ShortcutsHelp'
import { SplitView } from '../ui/SplitView'
import { StatusBar } from '../ui/StatusBar'
import { Toolbar } from '../ui/Toolbar'
import { strings } from '../ui/strings'
import { Dashboard } from './Dashboard'

const Scene3D = lazy(() => import('../viewer3d/Scene3D'))

function Loading3d() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas text-[13px] text-ink-soft">
      <span className="animate-pulse">{strings.workspace.loading3d}</span>
    </div>
  )
}

function View3D() {
  return (
    <Suspense fallback={<Loading3d />}>
      <Scene3D />
    </Suspense>
  )
}

function Editor() {
  const mode = useEditorStore((s) => s.mode)
  // mount the 3D pane on first use, then KEEP it mounted (hidden via CSS) so
  // the WebGL context survives mode switches instead of being torn down
  const [ever3d, setEver3d] = useState(false)
  useEffect(() => {
    if (mode !== '2d') setEver3d(true)
  }, [mode])

  useEffect(() => startAutosave(indexedDbRepository), [])

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      {/* RTL: first child renders on the right — library · canvas · inspector */}
      <div className="flex min-h-0 flex-1">
        <LibraryPanel />
        <main className="relative min-w-0 flex-1">
          <SplitView
            layout={mode === 'split' ? 'both' : mode === '2d' ? 'start-only' : 'end-only'}
            start={<Stage2D />}
            end={ever3d ? <View3D /> : <Loading3d />}
          />
        </main>
        <InspectorPanel />
      </div>
      <StatusBar />
      <ShortcutsHelp />
    </div>
  )
}

export function App() {
  const projectId = useEditorStore((s) => s.projectId)
  if (!projectId) return <Dashboard onOpen={loadProject} />
  return <Editor />
}
