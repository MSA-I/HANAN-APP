import type Konva from 'konva'
import { useEffect, useRef } from 'react'
import { Layer, Transformer } from 'react-konva'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { beginGesture, endGesture, setPosition, setRotation, setSize } from '../state/actions'
import { useEditorStore } from '../state/store'

const ACCENT = '#3056d3'

const ALL_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]
const CORNER_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

/**
 * True when the gesture is a single object's rotation, which must NOT write a
 * position.
 *
 * Konva rotates around the transformer's bounding-box centre, so for any object
 * whose origin is not that centre — the serpentine table, whose arcs are centred
 * at (116.9, -116.1) while its outline is centred at the origin — committing
 * `node.x()/y()` turns "rotate" into "rotate and slide". The model rotates around
 * the object's own origin, so dropping the position write is what makes the two
 * agree. A multi-selection is the opposite case: orbiting around the group centre
 * IS the wanted behaviour, and a resize genuinely moves the origin.
 */
function spinsInPlace(anchor: string | null, nodeCount: number): boolean {
  return anchor === 'rotater' && nodeCount === 1
}

interface Props {
  stageRef: React.RefObject<Konva.Stage | null>
}

export function SelectionTransformer({ stageRef }: Props) {
  const trRef = useRef<Konva.Transformer>(null)
  /** which anchor started the gesture — `getActiveAnchor` is already cleared by transformend */
  const anchorRef = useRef<string | null>(null)
  const selection = useEditorStore((s) => s.selection)
  const objects = useEditorStore((s) => s.scene.objects)

  const single = selection.length === 1 ? objects[selection[0]] : null
  const entry = single && hasCatalogEntry(single.catalogId) ? getCatalogEntry(single.catalogId) : null

  let anchors: string[] = []
  let keepRatio = false
  if (entry && single && !single.parentId) {
    const canW = entry.resizable.includes('width')
    const canD = entry.resizable.includes('depth')
    if (canW && canD) anchors = ALL_ANCHORS
    else if (canW && entry.linkWidthDepth) {
      anchors = CORNER_ANCHORS
      keepRatio = true
    } else if (canW) anchors = ['middle-left', 'middle-right']
  }

  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    const nodes = selection
      .map((id) => stage.findOne(`#${id}`))
      .filter((n): n is Konva.Group => !!n && n.name() === 'scene-object')
    tr.nodes(nodes)
  }, [selection, objects, stageRef])

  return (
    <Layer>
      <Transformer
        ref={trRef}
        enabledAnchors={anchors}
        keepRatio={keepRatio}
        // Free at EVERY angle, with or without Shift (PLAN-09/G1). Shift used to
        // engage 5° detents; the user asked for the snap to go altogether, so the
        // only quantised rotation left is the exact 90° of `R`. No `rotationSnaps`
        // is the same rule Konva applies when the array is empty, but stating it
        // by absence keeps it from being half-restored by one prop.
        // Must mirror viewer3d/ObjectGroup.tsx `RotationHandle`.
        rotateEnabled
        rotateAnchorOffset={26}
        borderStroke={ACCENT}
        anchorStroke={ACCENT}
        anchorFill="#ffffff"
        anchorSize={8}
        anchorCornerRadius={1}
        ignoreStroke
        shouldOverdrawWholeArea={false}
        boundBoxFunc={(oldBox, newBox) => {
          if (Math.abs(newBox.width) < 12 || Math.abs(newBox.height) < 12) return oldBox
          return newBox
        }}
        onTransformStart={() => {
          anchorRef.current = trRef.current?.getActiveAnchor() ?? null
          beginGesture()
        }}
        onTransform={() => {
          // live-commit position + rotation (3D follows); size only at the end
          const nodes = trRef.current?.nodes() ?? []
          const spin = spinsInPlace(anchorRef.current, nodes.length)
          for (const node of nodes) {
            const id = node.id()
            if (!spin) setPosition(id, { x: node.x(), y: node.y() })
            setRotation(id, node.rotation())
          }
        }}
        onTransformEnd={() => {
          const nodes = trRef.current?.nodes() ?? []
          const spin = spinsInPlace(anchorRef.current, nodes.length)
          for (const node of nodes) {
            const id = node.id()
            const obj = useEditorStore.getState().scene.objects[id]
            if (!obj) continue
            const scaleX = node.scaleX()
            const scaleY = node.scaleY()
            node.scale({ x: 1, y: 1 })
            if (!spin) setPosition(id, { x: node.x(), y: node.y() })
            setRotation(id, node.rotation())
            if (scaleX !== 1 || scaleY !== 1) {
              setSize(id, {
                width: obj.size.width * Math.abs(scaleX),
                depth: obj.size.depth * Math.abs(scaleY),
              })
            }
          }
          anchorRef.current = null
          endGesture()
        }}
      />
    </Layer>
  )
}
