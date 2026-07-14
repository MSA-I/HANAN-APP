import type Konva from 'konva'
import { useEffect, useRef } from 'react'
import { Layer, Transformer } from 'react-konva'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { beginGesture, endGesture, setPosition, setRotation, setSize } from '../state/actions'
import { useEditorStore } from '../state/store'
import { useOverlayStore } from './overlayStore'

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
const SNAP_15 = Array.from({ length: 24 }, (_, i) => i * 15)

interface Props {
  stageRef: React.RefObject<Konva.Stage | null>
}

export function SelectionTransformer({ stageRef }: Props) {
  const trRef = useRef<Konva.Transformer>(null)
  const selection = useEditorStore((s) => s.selection)
  const objects = useEditorStore((s) => s.scene.objects)
  const shiftHeld = useOverlayStore((s) => s.shiftHeld)

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
        rotateEnabled
        rotationSnaps={shiftHeld ? SNAP_15 : []}
        rotationSnapTolerance={6}
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
        onTransformStart={() => beginGesture()}
        onTransform={() => {
          // live-commit position + rotation (3D follows); size only at the end
          for (const node of trRef.current?.nodes() ?? []) {
            const id = node.id()
            setPosition(id, { x: node.x(), y: node.y() })
            setRotation(id, node.rotation())
          }
        }}
        onTransformEnd={() => {
          for (const node of trRef.current?.nodes() ?? []) {
            const id = node.id()
            const obj = useEditorStore.getState().scene.objects[id]
            if (!obj) continue
            const scaleX = node.scaleX()
            const scaleY = node.scaleY()
            node.scale({ x: 1, y: 1 })
            setPosition(id, { x: node.x(), y: node.y() })
            setRotation(id, node.rotation())
            if (scaleX !== 1 || scaleY !== 1) {
              setSize(id, {
                width: obj.size.width * Math.abs(scaleX),
                depth: obj.size.depth * Math.abs(scaleY),
              })
            }
          }
          endGesture()
        }}
      />
    </Layer>
  )
}
