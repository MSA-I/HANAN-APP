import { lazy, Suspense, useEffect, useState } from 'react'
import { Stage2D } from '../editor2d/Stage2D'
import { startAutosave } from '../persistence/autosave'
import { indexedDbRepository } from '../persistence/indexedDbRepository'
import { loadProject } from '../state/actions'
import { useEditorStore } from '../state/store'
import { DesignEditMode } from '../ui/DesignEditMode'
import { InspectorPanel } from '../ui/InspectorPanel'
import { LibraryPanel } from '../ui/LibraryPanel'
import { NoticeStack } from '../ui/NoticeStack'
import { ShortcutsHelp } from '../ui/ShortcutsHelp'
import { SplitView } from '../ui/SplitView'
import { StatusBar } from '../ui/StatusBar'
import { Toolbar } from '../ui/Toolbar'
import { Loading3D, useModuleLoadPhase } from '../viewer3d/Loading3D'
import { warmVenueModel } from '../viewer3d/warmVenue'
import { Dashboard } from './Dashboard'

const Scene3D = lazy(() => import('../viewer3d/Scene3D'))

/**
 * ⚠ `Loading3D` and `warmVenue` are imported STATICALLY on purpose, and both are
 * deliberately free of three/drei/R3F. They live under `viewer3d/` by subject,
 * not by bundle: `App.tsx` is in the main chunk, so anything it imports is
 * downloaded on every visit. A card that pulled in drei would cause the very
 * wait it exists to apologise for.
 */
function Loading3dPane() {
  return <Loading3D {...useModuleLoadPhase()} />
}

function View3D() {
  return (
    <Suspense fallback={<Loading3dPane />}>
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

  // Warm the hall GLB (5.4 MB) on idle, so a switch to 3D is not the first time
  // the network hears about it. `warmVenue` imports only `core/venuePacks`, and
  // it returns its own cancel function.
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  useEffect(() => warmVenueModel(venuePackId), [venuePackId])

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
            end={ever3d ? <View3D /> : <Loading3dPane />}
          />
          {/* PLAN-07: over the panes rather than inside one of them. Design-edit
              mode is a mode of BOTH views (plan G3), and its Esc handler is the
              only way out of the 3D one — mounting it in Stage2D would hide the
              chip behind `display:none` the moment the user switched to 3D. */}
          <DesignEditMode />
        </main>
        <InspectorPanel />
      </div>
      <StatusBar />
      {/* A sibling of the status bar, not a child of either pane: a refusal
          raised in 3D has to survive a switch to 2D, and the stack is fixed-
          positioned anyway (see NoticeStack for why it clears the footer). */}
      <NoticeStack />
      <ShortcutsHelp />
    </div>
  )
}

export function App() {
  const projectId = useEditorStore((s) => s.projectId)
  if (!projectId) return <Dashboard onOpen={loadProject} />
  return <Editor />
}
