import { Layer } from 'react-konva'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../state/store'
import { ObjectNode } from './ObjectNode'
import { useOverlayStore } from './overlayStore'

export function ObjectsLayer() {
  const order = useEditorStore(useShallow((s) => s.scene.objectOrder))
  const interactive = useOverlayStore((s) => !s.spacePan && !s.handTool && !s.placing)

  return (
    <Layer listening={interactive}>
      {order.map((id) => (
        <ObjectNode key={id} id={id} />
      ))}
    </Layer>
  )
}
