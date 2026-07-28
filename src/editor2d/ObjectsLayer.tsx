import { Group, Layer } from 'react-konva'
import { useShallow } from 'zustand/react/shallow'
import { isPointInZone } from '../core/layout/zoneOccupancy'
import { getVenuePack } from '../core/venuePacks'
import { visibleTopLevelIds } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { ObjectNode } from './ObjectNode'
import { useOverlayStore } from './overlayStore'
import { ZONE_OFF_OPACITY } from './VenueLayer'

export function ObjectsLayer() {
  const order = useEditorStore(useShallow((s) => visibleTopLevelIds(s.scene)))
  const interactive = useOverlayStore((s) => !s.spacePan && !s.handTool && !s.placing)
  // display preference, deliberately outside the undo zone (BRIEF §8) — read only
  const activeZone = useEditorStore((s) => s.activeZone)
  const deck = useEditorStore((s) =>
    getVenuePack(s.scene.venue.venuePackId)?.restricted?.find((z) => z.kind === 'kabalatPanim'),
  )
  // Source doc §18: the reception area has to go dark WITH what stands on it.
  // VenueLayer dims the envelope; without this the deck fades and its chairs
  // stay at full strength, which reads as a rendering fault rather than a mode.
  const onDeck = useEditorStore(
    useShallow((s) => {
      if (!deck) return [] as string[]
      return visibleTopLevelIds(s.scene).filter((id) =>
        isPointInZone(s.scene.objects[id].transform.position, deck),
      )
    }),
  )
  const deckIds = new Set(onDeck)
  const hallOpacity = activeZone === 'kabalatPanim' ? ZONE_OFF_OPACITY : 1
  const deckOpacity = activeZone === 'hall' ? ZONE_OFF_OPACITY : 1

  // ⚠ This split is GEOMETRIC on purpose — which side of the plan the piece is
  // drawn on. It is NOT the `zoneKind` rule that decides 3D elevation
  // (ObjectGroup.tsx, BRIEF §8): that one asks what an object IS, this one asks
  // where it is. Two questions, two rules; do not "unify" them.
  return (
    <Layer listening={interactive}>
      <Group opacity={hallOpacity}>
        {order
          .filter((id) => !deckIds.has(id))
          .map((id) => (
            <ObjectNode key={id} id={id} />
          ))}
      </Group>
      <Group opacity={deckOpacity}>
        {order
          .filter((id) => deckIds.has(id))
          .map((id) => (
            <ObjectNode key={id} id={id} />
          ))}
      </Group>
    </Layer>
  )
}
