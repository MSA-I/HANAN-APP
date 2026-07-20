/**
 * The room shell. Either a real venue pack (a prepped GLB the user modelled) or,
 * when no pack is set, the procedural shell: a calm field, the venue floor, and
 * four perimeter walls. Sized from scene.venue (cm → meters). The venue occupies
 * plan x∈[0,width], y∈[0,depth], which maps to three x∈[0,W], z∈[0,D].
 */
import { Component, Suspense, type ReactNode } from 'react'
import { cmToM } from '../core/space'
import { getVenuePack } from '../core/venuePacks'
import { useEditorStore } from '../state/store'
import { VenuePackModel } from './VenuePackModel'

const WALL_COLOR = '#d9d4cb'
const WALL_THICKNESS_CM = 12

function Wall({
  position,
  size,
}: {
  position: [number, number, number]
  size: [number, number, number]
}) {
  return (
    <mesh position={position} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={WALL_COLOR} roughness={0.9} metalness={0} />
    </mesh>
  )
}

/** Soft neutral ground so the venue never floats in the void. */
function Field({ w, d }: { w: number; d: number }) {
  const cx = w / 2
  const cz = d / 2
  const field = Math.max(w, d) * 3 + 40
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.03, cz]} receiveShadow>
      <planeGeometry args={[field, field]} />
      <meshStandardMaterial color="#f6f5f2" roughness={1} metalness={0} />
    </mesh>
  )
}

function ProceduralRoom() {
  const width = useEditorStore((s) => s.scene.venue.size.width)
  const depth = useEditorStore((s) => s.scene.venue.size.depth)
  const wallHeight = useEditorStore((s) => s.scene.venue.wallHeight)
  const floorColor = useEditorStore((s) => s.scene.venue.floor.color)

  const W = cmToM(width)
  const D = cmToM(depth)
  const H = cmToM(wallHeight)
  const t = cmToM(WALL_THICKNESS_CM)
  const cx = W / 2
  const cz = D / 2

  return (
    <group>
      <Field w={W} d={D} />
      {/* venue floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color={floorColor} roughness={0.96} metalness={0} />
      </mesh>
      {/* perimeter walls (end walls run long to cover the corners) */}
      <Wall position={[cx, H / 2, -t / 2]} size={[W + 2 * t, H, t]} />
      <Wall position={[cx, H / 2, D + t / 2]} size={[W + 2 * t, H, t]} />
      <Wall position={[-t / 2, H / 2, cz]} size={[t, H, D]} />
      <Wall position={[W + t / 2, H / 2, cz]} size={[t, H, D]} />
    </group>
  )
}

/** Falls back to the procedural room if the pack GLB fails to load. */
class PackErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function VenueMesh() {
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const pack = getVenuePack(venuePackId)

  if (!pack) return <ProceduralRoom />

  return (
    <group>
      {/* No <Field> here on purpose. The pack ships its own ground (the resort's
          spans 84×33 m, wider than the venue), and Field sits at y = −0.03 — which
          is ABOVE the pool: its water plane is at −0.25 and the basin floor at
          −1.45. Rendering it lidded the pool with an off-white sheet. */}
      <PackErrorBoundary fallback={<ProceduralRoom />}>
        <Suspense fallback={<ProceduralRoom />}>
          <VenuePackModel pack={pack} />
        </Suspense>
      </PackErrorBoundary>
    </group>
  )
}
