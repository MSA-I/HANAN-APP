import { Layer } from 'react-konva'
import { useShallow } from 'zustand/react/shallow'
import { isPointInZone } from '../core/layout/zoneOccupancy'
import { getVenuePack } from '../core/venuePacks'
import { visibleTopLevelIds } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { ObjectNode } from './ObjectNode'
import { useOverlayStore } from './overlayStore'

export function ObjectsLayer() {
  const order = useEditorStore(useShallow((s) => visibleTopLevelIds(s.scene)))
  const interactive = useOverlayStore((s) => !s.spacePan && !s.handTool && !s.placing)
  // display preference, deliberately outside the undo zone (BRIEF §8) — read only
  const activeZone = useEditorStore((s) => s.activeZone)
  const deck = useEditorStore((s) =>
    getVenuePack(s.scene.venue.venuePackId)?.restricted?.find((z) => z.kind === 'kabalatPanim'),
  )
  // Source doc §18: the reception area has to go WITH what stands on it. The two
  // sides used to dim rather than disappear; the user's verdict after two goes at
  // the number was that a ghost of the other building on the same sheet is
  // confusing, so now the far side is not drawn at all. Without this half, the
  // deck would vanish and its chairs would stay behind standing on nothing.
  const onDeck = useEditorStore(
    useShallow((s) => {
      if (!deck) return [] as string[]
      return visibleTopLevelIds(s.scene).filter((id) =>
        isPointInZone(s.scene.objects[id].transform.position, deck),
      )
    }),
  )
  const deckIds = new Set(onDeck)
  const showHall = activeZone !== 'kabalatPanim'
  const showDeck = activeZone !== 'hall'

  // ⚠ This split is GEOMETRIC on purpose — which side of the plan the piece is
  // drawn on. It is NOT the `zoneKind` rule that decides 3D elevation
  // (ObjectGroup.tsx, BRIEF §8): that one asks what an object IS, this one asks
  // where it is. Two questions, two rules; do not "unify" them.
  return (
    <Layer listening={interactive}>
      {showHall
        ? order
            .filter((id) => !deckIds.has(id))
            .map((id) => <ObjectNode key={id} id={id} />)
        : null}
      {showDeck
        ? order
            .filter((id) => deckIds.has(id))
            .map((id) => <ObjectNode key={id} id={id} />)
        : null}
    </Layer>
  )
}
