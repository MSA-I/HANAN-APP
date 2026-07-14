/**
 * The room shell: a large calm field, the venue floor, and four perimeter
 * walls. Sized from scene.venue (cm → meters). The venue occupies plan
 * x∈[0,width], y∈[0,depth], which maps to three x∈[0,W], z∈[0,D].
 */
import { cmToM } from '../core/space'
import { useEditorStore } from '../state/store'

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

export function VenueMesh() {
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
  const field = Math.max(W, D) * 3 + 40

  return (
    <group>
      {/* calm field so the room sits in a soft neutral ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.02, cz]} receiveShadow>
        <planeGeometry args={[field, field]} />
        <meshStandardMaterial color="#f6f5f2" roughness={1} metalness={0} />
      </mesh>

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
