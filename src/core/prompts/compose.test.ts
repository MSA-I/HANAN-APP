import { describe, expect, it } from 'vitest'
import { listCatalog } from '../catalog/registry'
import { createDefaultScene, createObject } from '../model/factory'
import type { SceneObject, SceneState, Vec2 } from '../model/types'
import { getVenuePack, type SealedCamera } from '../venuePacks'
import { composeExport } from './compose'
import { colorPhrase, hexToColorName, MAX_DESIGN_REFS, pluralize, quantityWord } from './fragments'
import { HALL_MATERIAL_REF, objectsInFrame, selectRefs } from './refs'
import { listAngleTemplates, templateFor } from './templates'

const PACK = 'resort'
const cameras = getVenuePack(PACK)!.cameras!
const cam = (id: string): SealedCamera => cameras.find((c) => c.id === id)!

/**
 * A resort scene holding EXACTLY the objects passed in.
 *
 * `createDefaultScene` seeds the hall's baked fixtures (core/venueFixtures.ts —
 * the bar and its back wall), which is right for the app and wrong for these
 * assertions: every test below names the objects it expects by id, so a seeded
 * fixture is noise that would have to be spelled into each one. They are cleared
 * here instead, and the fact that fixtures DO reach a composed prompt is pinned by
 * its own test rather than smeared across thirteen.
 */
function sceneWith(...objects: SceneObject[]): SceneState {
  const scene = createDefaultScene(undefined, undefined, PACK)
  scene.objects = {}
  scene.objectOrder = []
  for (const obj of objects) {
    scene.objects[obj.id] = obj
    if (!obj.parentId) scene.objectOrder.push(obj.id)
  }
  return scene
}

/** The same scene WITH whatever the venue bakes in — used by the fixture test. */
function sceneWithFixtures(...objects: SceneObject[]): SceneState {
  const scene = createDefaultScene(undefined, undefined, PACK)
  for (const obj of objects) {
    scene.objects[obj.id] = obj
    if (!obj.parentId) scene.objectOrder.push(obj.id)
  }
  return scene
}

const at = (x: number, y: number): Vec2 => ({ x, y })
const venue = { wallHeight: 1160, venuePackId: PACK }

/** Mid-hall, well inside s1's view cone and inside s3's central axis. */
const MIDDLE = at(2100, 800)

describe('angle templates', () => {
  it('covers all seven sealed cameras of the resort pack', () => {
    expect(cameras).toHaveLength(7)
    for (const camera of cameras) {
      expect(templateFor(camera.id), `no template for ${camera.id}`).toBeDefined()
    }
  })

  it('has no template that does not belong to a camera', () => {
    const ids = new Set(cameras.map((c) => c.id))
    for (const t of listAngleTemplates()) expect(ids.has(t.cameraId)).toBe(true)
  })

  it('describes each angle differently — a copied description is a wrong prompt', () => {
    const bases = listAngleTemplates().map((t) => t.base)
    expect(new Set(bases).size).toBe(bases.length)
  })
})

describe('catalog prompt fragments', () => {
  it('every entry can describe itself to an image model', () => {
    const missing = listCatalog()
      .filter((e) => !e.promptFragment?.trim())
      .map((e) => e.id)
    expect(missing).toEqual([])
  })

  it('fragments are singular noun phrases, not Hebrew labels', () => {
    for (const entry of listCatalog()) {
      expect(entry.promptFragment).toMatch(/^[a-z0-9]/)
      expect(entry.promptFragment, entry.id).not.toMatch(/[֐-׿]/)
    }
  })
})

describe('baked venue fixtures reach the prompt', () => {
  it('names the resort bar even though the user placed nothing', () => {
    // The bar is a fitting of the hall, not event furniture, so it is in every
    // render whether or not the event has a single table — and the prompt has to
    // say so or the image model will leave the bar out of a photo of the bar wall.
    const scene = sceneWithFixtures()
    const fixtures = Object.values(scene.objects).filter((o) => o.flags.frozen)
    expect(fixtures.length).toBeGreaterThan(0)
    // s2 stands at plan x≈4423 looking back down the hall, past the bar at x≈2189
    const seen = objectsInFrame(scene, cam('s2')).map((o) => o.catalogId)
    expect(seen).toContain('bar.resort-left')
    expect(seen).toContain('bar.resort-right')
  })
})

describe('frustum filter (gate 3)', () => {
  it('keeps an object the angle looks at', () => {
    const table = createObject('table.round', MIDDLE, venue)
    expect(objectsInFrame(sceneWith(table), cam('s1')).map((o) => o.id)).toEqual([table.id])
  })

  it('drops an object behind the camera', () => {
    // s3 stands on the centreline at plan y≈18cm and looks down +y, so anything
    // at negative y is behind its back
    const behind = createObject('table.round', at(2200, -600), venue)
    expect(objectsInFrame(sceneWith(behind), cam('s3'))).toEqual([])
  })

  it('drops an object far off to the side of a narrow angle', () => {
    // 83° off s3's axis — the hall is open enough that most in-hall positions are
    // visible from most angles, so this is what "out of frame" actually looks like
    const aside = createObject('table.round', at(5200, 300), venue)
    expect(objectsInFrame(sceneWith(aside), cam('s3'))).toEqual([])
  })

  it('drops an object on the reception deck when the camera is in the hall', () => {
    const onDeck = createObject('table.round', at(5200, 1600), venue)
    expect(objectsInFrame(sceneWith(onDeck), cam('s3'))).toEqual([])
  })

  it('drops a hidden object even when it is in frame', () => {
    const table = createObject('table.round', MIDDLE, venue)
    table.flags.visible = false
    expect(objectsInFrame(sceneWith(table), cam('s1'))).toEqual([])
  })

  it('drops an object whose category layer is hidden', () => {
    const table = createObject('table.round', MIDDLE, venue)
    const scene = sceneWith(table)
    scene.settings.layers = { tables: { hidden: true } }
    expect(objectsInFrame(scene, cam('s1'))).toEqual([])
  })

  it('considers everything when there is no sealed camera to cull against', () => {
    const far = createObject('table.round', at(5200, 1600), venue)
    expect(objectsInFrame(sceneWith(far), null)).toHaveLength(1)
  })
})

describe('grouping (§45)', () => {
  it('collapses many of one product into one reference and counts them', () => {
    const tables = [at(1000, 700), at(1400, 700), at(1800, 700)].map((p) =>
      createObject('table.round', p, venue),
    )
    const { groups, refs } = selectRefs(sceneWith(...tables), cam('s1'))
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
    expect(refs.filter((r) => r.role === 'design')).toHaveLength(1)
  })

  it('splits the same product into two references when the colours differ', () => {
    const ivory = createObject('table.round', at(1000, 700), venue)
    const gold = createObject('table.round', at(1400, 700), venue)
    gold.appearance = { cloth: { color: '#c9a86a' } }
    const { groups } = selectRefs(sceneWith(ivory, gold), cam('s1'))
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.color)).toContain(' in gold')
    expect(groups.map((g) => g.color)).toContain(null)
  })

  it('orders chuppah before lighting before tables', () => {
    const scene = sceneWith(
      createObject('table.round', MIDDLE, venue),
      createObject('lamp.chandelier-diamond', at(2000, 700), venue),
      createObject('chuppah.draped-white', at(2200, 900), venue),
    )
    const { groups } = selectRefs(scene, cam('s1'))
    expect(groups.map((g) => g.entry.category)).toEqual(['chuppah', 'lighting', 'tables'])
  })
})

describe('colour is mentioned only when it was changed (§44)', () => {
  const entry = listCatalog().find((e) => e.id === 'table.round')!

  it('says nothing at the default', () => {
    expect(colorPhrase(entry, {})).toBeNull()
    expect(colorPhrase(entry, { cloth: { color: '#f5f0e8' } })).toBeNull()
  })

  it('names the colour once it differs', () => {
    expect(colorPhrase(entry, { cloth: { color: '#c9a86a' } })).toBe(' in gold')
    expect(colorPhrase(entry, { cloth: { color: '#7a2e3f' } })).toBe(' in burgundy')
  })

  it('says nothing for an entry with no editable slot', () => {
    const chair = listCatalog().find((e) => e.id === 'chair.x-white')!
    expect(colorPhrase(chair, { upholstery: { color: '#ff0000' } })).toBeNull()
  })

  it('names a free-picker colour by its nearest word', () => {
    expect(hexToColorName('#010101')).toBe('black')
    expect(hexToColorName('#fefefe')).toBe('white')
    expect(hexToColorName('#0b0b7f')).toBe('navy blue')
    expect(hexToColorName('not a colour')).toBe('not a colour')
  })
})

describe('the 14-reference cap', () => {
  it('cuts to MAX_DESIGN_REFS and says what was cut', () => {
    // one of every table-decor product, all standing mid-hall in s1's view
    const decor = listCatalog()
      .filter((e) => e.category === 'tableDecor')
      .map((e, i) => createObject(e.id, at(1600 + i * 40, 700), venue))
    expect(decor.length).toBeGreaterThan(MAX_DESIGN_REFS)

    const { refs, groups, warnings } = selectRefs(sceneWith(...decor), cam('s1'))
    expect(groups.length).toBe(decor.length)
    expect(refs.filter((r) => r.role === 'design')).toHaveLength(MAX_DESIGN_REFS)
    expect(refs).toHaveLength(MAX_DESIGN_REFS + 1) // + the hall material shot
    expect(warnings.join(' ')).toContain(`${MAX_DESIGN_REFS} references included`)
  })

  it('still describes the items it could not illustrate', () => {
    const decor = listCatalog()
      .filter((e) => e.category === 'tableDecor')
      .map((e, i) => createObject(e.id, at(1600 + i * 40, 700), venue))
    const scene = sceneWith(...decor)
    const pkg = composeExport(scene, 's1')
    const cut = pkg.warnings.join(' ')
    // every product is named somewhere: in the prose if not in the pictures
    for (const entry of listCatalog().filter((e) => e.category === 'tableDecor')) {
      expect(pkg.prompt.includes(entry.promptFragment!) || cut.includes(entry.id)).toBe(true)
    }
  })
})

describe('the hall material reference (§46)', () => {
  it('is always first, even in an empty room', () => {
    const pkg = composeExport(sceneWith(), 's1')
    expect(pkg.refs[0]).toEqual(HALL_MATERIAL_REF)
    expect(pkg.refs[0].role).toBe('materials')
  })

  it('is present on the reception-deck angles too', () => {
    expect(composeExport(sceneWith(), 'k1').refs[0]).toEqual(HALL_MATERIAL_REF)
  })

  it('tells the model to take only materials from it', () => {
    expect(HALL_MATERIAL_REF.caption).toMatch(/Do not copy furniture/i)
  })
})

describe('composeExport', () => {
  it('does not throw on an empty scene', () => {
    const pkg = composeExport(sceneWith(), 's1')
    expect(pkg.prompt).toContain('resort banquet hall')
    expect(pkg.warnings.join(' ')).toContain('empty')
  })

  it('does not throw on a scene with no venue pack', () => {
    const scene = createDefaultScene(2400, 1600, null)
    const pkg = composeExport(scene, 's1')
    expect(pkg.refs[0]).toEqual(HALL_MATERIAL_REF)
    expect(pkg.warnings.join(' ')).toContain('not a sealed camera')
  })

  it('warns rather than throws on an unknown angle', () => {
    const pkg = composeExport(sceneWith(), 'no-such-angle')
    expect(pkg.warnings.join(' ')).toContain('No prompt template')
  })

  it('writes the count as a word and the item under its heading', () => {
    const tables = Array.from({ length: 12 }, (_, i) =>
      createObject('table.round', at(1000 + i * 60, 700), venue),
    )
    const pkg = composeExport(sceneWith(...tables), 's1')
    expect(pkg.prompt).toContain('TABLES: twelve 180cm round banquet tables')
  })

  it('numbers the reference instructions to match the reference list', () => {
    const pkg = composeExport(sceneWith(createObject('table.round', MIDDLE, venue)), 's1')
    expect(pkg.prompt).toContain('MATERIALS: match reference image 1')
    expect(pkg.prompt).toContain('DESIGN ELEMENTS: match reference image 2.')
  })

  it('carries the angle label, for the output folder', () => {
    expect(composeExport(sceneWith(), 's4').angleLabel).toBe('זווית 4 (מוגבה)')
  })
})

describe('english helpers', () => {
  it('spells counts', () => {
    expect(quantityWord(1)).toBe('one')
    expect(quantityWord(12)).toBe('twelve')
    expect(quantityWord(96)).toBe('ninety-six')
    expect(quantityWord(120)).toBe('one hundred twenty')
    expect(quantityWord(1000)).toBe('1000')
  })

  it('pluralises the head noun, not the tail', () => {
    expect(pluralize('a 180cm round banquet table under a floor-length tablecloth', 12)).toBe(
      'twelve 180cm round banquet tables under a floor-length tablecloth',
    )
    expect(pluralize('a white cross-back dining chair', 1)).toBe('a white cross-back dining chair')
  })
})
