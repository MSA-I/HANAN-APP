import { describe, expect, it } from 'vitest'
import { listCatalog } from '../catalog/registry'
import { createDefaultScene, createObject } from '../model/factory'
import { DEFAULT_LIGHTING, type SceneObject, type SceneState, type Vec2 } from '../model/types'
import { getVenuePack, type SealedCamera } from '../venuePacks'
import { composeExport } from './compose'
import {
  colorPhrase,
  designRefBudget,
  hexToColorName,
  MAX_DESIGN_REFS,
  MAX_FIXED_REFS,
  MAX_INPUT_IMAGES,
  pluralize,
  quantityWord,
} from './fragments'
import {
  BACKGROUND_REF,
  HALL_MATERIAL_REF,
  HALL_MATERIAL_REF_ELEVATED,
  isElevatedAngle,
  materialRefFor,
  objectsInFrame,
  selectRefs,
} from './refs'
import {
  CAPTURE_SHADOWS_OFF,
  listAngleTemplates,
  SHARED_DIRECTION,
  SHARED_NEGATIVE,
  templateFor,
} from './templates'

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

/** The path selectRefs builds for a product — read from the catalog, never spelled out. */
const shotOf = (catalogId: string): string =>
  `public${listCatalog().find((e) => e.id === catalogId)!.thumbnail}`

const entriesIn = (...categories: string[]) =>
  listCatalog().filter((e) => categories.includes(e.category))

/** One of every centrepiece, standing mid-hall where s1 can see the lot. */
const everyCentrepiece = (y = 700) =>
  entriesIn('tableDecor').map((e, i) => createObject(e.id, at(1600 + i * 40, y), venue))

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

describe('the image budget', () => {
  it('cuts the design list to its budget and says what was cut', () => {
    // one of every table-decor product, all standing mid-hall in s1's view
    const decor = everyCentrepiece()
    const budget = designRefBudget(0) // nothing fixed in frame, so the slack comes back
    expect(decor.length).toBeGreaterThan(budget)

    const { refs, groups, warnings } = selectRefs(sceneWith(...decor), cam('s1'))
    expect(groups.length).toBe(decor.length)
    expect(refs.filter((r) => r.role === 'design')).toHaveLength(budget)
    expect(refs).toHaveLength(budget + 2) // + the hall material shot and the landscape
    expect(warnings.join(' ')).toContain(`${budget} references included`)
  })

  it('still describes the items it could not illustrate', () => {
    const scene = sceneWith(...everyCentrepiece())
    const pkg = composeExport(scene, 's1')
    const cut = pkg.warnings.join(' ')
    // every product is named somewhere: in the prose if not in the pictures
    for (const entry of entriesIn('tableDecor')) {
      expect(pkg.prompt.includes(entry.promptFragment!) || cut.includes(entry.id)).toBe(true)
    }
  })

  /**
   * The ceiling gpt-image-1 documents. Everything else in this file is a
   * judgement about which pictures are worth a slot; this is the one number that
   * makes the request fail outright if it is wrong, so it is asserted on the
   * arithmetic AND on real scenes.
   */
  it('never sends more than MAX_INPUT_IMAGES, for any number of fixed elements', () => {
    for (let fixedCount = 0; fixedCount <= 10; fixedCount++) {
      const capture = 1
      const alwaysOn = 2 // materials + background
      const used = Math.min(fixedCount, MAX_FIXED_REFS)
      expect(capture + alwaysOn + used + designRefBudget(fixedCount)).toBeLessThanOrEqual(
        MAX_INPUT_IMAGES,
      )
    }
  })

  it('holds the ceiling on a room crammed with both kinds of thing', () => {
    // every product isFixedElement would claim, added one at a time on top of a
    // room already holding one of every centrepiece
    const fixedProducts = entriesIn('bars', 'decor')
    expect(fixedProducts.length).toBeGreaterThan(0)
    for (let n = 0; n <= fixedProducts.length; n++) {
      const scene = sceneWith(
        ...fixedProducts.slice(0, n).map((e, i) => createObject(e.id, at(1700 + i * 60, 950), venue)),
        ...everyCentrepiece(),
      )
      const { refs } = selectRefs(scene, cam('s1'))
      expect(1 + refs.length, `${n} fixed products`).toBeLessThanOrEqual(MAX_INPUT_IMAGES)
      expect(refs.filter((r) => r.role === 'fixed').length).toBeLessThanOrEqual(MAX_FIXED_REFS)
    }
  })

  it('spends the worst case exactly: five fixed elements leave MAX_DESIGN_REFS', () => {
    expect(designRefBudget(MAX_FIXED_REFS)).toBe(MAX_DESIGN_REFS)
    expect(designRefBudget(99)).toBe(MAX_DESIGN_REFS)
    expect(1 + 2 + MAX_FIXED_REFS + MAX_DESIGN_REFS).toBe(MAX_INPUT_IMAGES)
  })
})

/**
 * §26: "the fixed elements like the bar or the DJ booth or the vegetation, as
 * long as they appear in the same view."
 *
 * The frame test was never the problem — objectsInFrame already answered "in the
 * same view". The defect was priority: CATEGORY_PRIORITY ranks `bars` seventh
 * and `decor` last, so in a dressed hall those three were the FIRST references
 * to be cut. They are what makes a render recognisable as this building.
 */
describe('fixed hall elements are illustrated before the design cut (§26)', () => {
  const bar = () => createObject('bar.resort-left', at(1900, 850), venue)
  const dj = () => createObject('dj.booth', at(2000, 850), venue)
  const planter = () => createObject('plant.potted-2', at(2100, 850), venue)

  it('keeps the bar, the DJ booth and the planter and cuts centrepieces instead', () => {
    const scene = sceneWith(bar(), dj(), planter(), ...everyCentrepiece())
    const { refs, warnings } = selectRefs(scene, cam('s1'))

    const fixed = refs.filter((r) => r.role === 'fixed').map((r) => r.path)
    expect(fixed).toEqual([shotOf('bar.resort-left'), shotOf('dj.booth'), shotOf('plant.potted-2')])

    // …and the design list is what gave up the slots
    expect(refs.filter((r) => r.role === 'design')).toHaveLength(designRefBudget(3))
    const cut = warnings.join(' ')
    expect(cut).toContain('design items in frame')
    for (const id of ['bar.resort-left', 'dj.booth', 'plant.potted-2']) {
      expect(cut, `${id} was cut`).not.toContain(id)
    }
    expect(1 + refs.length).toBeLessThanOrEqual(MAX_INPUT_IMAGES)
  })

  it('orders them materials, background, fixed, design', () => {
    const scene = sceneWith(bar(), planter(), createObject('table.round', MIDDLE, venue))
    const roles = selectRefs(scene, cam('s1')).refs.map((r) => r.role)
    expect(roles).toEqual(['materials', 'background', 'fixed', 'fixed', 'design'])
  })

  it('counts a baked venue fixture as fixed without anything being placed', () => {
    // the resort bakes its bar in (core/venueFixtures.ts, flags.frozen)
    const { refs } = selectRefs(sceneWithFixtures(), cam('s2'))
    expect(refs.filter((r) => r.role === 'fixed').length).toBeGreaterThan(0)
  })

  it('does not claim the chuppah, which carries zoneKind but is event furniture', () => {
    const scene = sceneWith(createObject('chuppah.draped-white', at(2200, 900), venue))
    const { refs } = selectRefs(scene, cam('s1'))
    expect(refs.filter((r) => r.role === 'fixed')).toEqual([])
    expect(refs.filter((r) => r.role === 'design')).toHaveLength(1)
  })

  it('names the fixed cut in warnings too, never dropping one silently', () => {
    const fixedProducts = entriesIn('bars', 'decor')
    expect(fixedProducts.length).toBeGreaterThan(MAX_FIXED_REFS)
    const scene = sceneWith(
      ...fixedProducts.map((e, i) => createObject(e.id, at(1700 + i * 60, 950), venue)),
    )
    const { refs, groups, warnings } = selectRefs(scene, cam('s1'))
    const inFrame = groups.filter((g) => g.fixed)
    expect(inFrame.length).toBeGreaterThan(MAX_FIXED_REFS)

    const kept = inFrame.slice(0, MAX_FIXED_REFS)
    expect(refs.filter((r) => r.role === 'fixed')).toHaveLength(
      kept.filter((g) => g.entry.thumbnail).length,
    )
    expect(warnings.join(' ')).toContain('fixed hall elements in frame')
    for (const group of inFrame.slice(MAX_FIXED_REFS)) {
      expect(warnings.join(' '), group.catalogId).toContain(group.catalogId)
    }
  })
})

describe('the hall material reference (§46)', () => {
  it('is always first, even in an empty room', () => {
    const pkg = composeExport(sceneWith(), 's1')
    expect(pkg.refs[0]).toEqual(HALL_MATERIAL_REF)
    expect(pkg.refs[0].role).toBe('materials')
  })

  it('is still first with a room full of things to illustrate', () => {
    const pkg = composeExport(sceneWith(...everyCentrepiece()), 's1')
    expect(pkg.refs[0]).toEqual(HALL_MATERIAL_REF)
  })

  it('is present on the reception-deck angles too', () => {
    expect(composeExport(sceneWith(), 'k1').refs[0]).toEqual(HALL_MATERIAL_REF)
  })

  /**
   * The user's rule: the top-down photograph goes with an elevated angle, the
   * eye-level one with every other angle. It is a SWAP of the one materials slot,
   * so nothing here may change the number of references.
   */
  describe('and which of the two it is, by angle', () => {
    // pinned by id on purpose: `isElevatedAngle` is geometric, and this is the
    // assertion that catches a camera being moved across the threshold
    const ELEVATED = ['s4', 's5']
    const LEVEL = ['s1', 's2', 's3', 'k1', 'k2']

    it.each(ELEVATED)('%s looks down, so it gets the top-down photograph', (id) => {
      expect(isElevatedAngle(cam(id))).toBe(true)
      expect(composeExport(sceneWith(), id).refs[0]).toEqual(HALL_MATERIAL_REF_ELEVATED)
    })

    it.each(LEVEL)('%s looks across, so it keeps the eye-level photograph', (id) => {
      expect(isElevatedAngle(cam(id))).toBe(false)
      expect(composeExport(sceneWith(), id).refs[0]).toEqual(HALL_MATERIAL_REF)
    })

    it('covers every sealed camera between them', () => {
      expect([...ELEVATED, ...LEVEL].sort()).toEqual(cameras.map((c) => c.id).sort())
    })

    it('is one slot either way — the swap costs no images', () => {
      const level = composeExport(sceneWith(...everyCentrepiece()), 's1')
      const high = composeExport(sceneWith(...everyCentrepiece()), 's4')
      expect(high.refs).toHaveLength(level.refs.length)
      expect(high.refs.filter((r) => r.role === 'materials')).toHaveLength(1)
      expect(1 + high.refs.length).toBeLessThanOrEqual(MAX_INPUT_IMAGES)
    })

    it('falls back to the eye-level shot when there is no sealed camera', () => {
      expect(isElevatedAngle(null)).toBe(false)
      expect(composeExport(sceneWith(), 'no-such-angle').refs[0]).toEqual(HALL_MATERIAL_REF)
    })

    it('names a different file for each, so the package is never ambiguous', () => {
      expect(HALL_MATERIAL_REF_ELEVATED.path).not.toBe(HALL_MATERIAL_REF.path)
      expect(HALL_MATERIAL_REF_ELEVATED.role).toBe('materials')
    })
  })

  it('tells the model to take only materials from it', () => {
    expect(HALL_MATERIAL_REF.caption).toMatch(/Do not copy furniture/i)
  })
})

/**
 * §23: "a third fixed image, which is the background behind the building … named
 * 1.png". It is the real landscape of the site, so the glazing shows a real view
 * instead of one the model invents.
 */
describe('the background reference (§23)', () => {
  it('is second on every sealed angle, right after the materials shot', () => {
    for (const camera of cameras) {
      const pkg = composeExport(sceneWith(), camera.id)
      // by ROLE, not identity: which of the two materials photographs is sent
      // depends on the angle (see materialRefFor), but there is always exactly
      // one of them and the landscape always follows it
      expect(pkg.refs[0].role, camera.id).toBe('materials')
      expect(pkg.refs[0], camera.id).toEqual(materialRefFor(camera))
      expect(pkg.refs[1], camera.id).toEqual(BACKGROUND_REF)
    }
  })

  it('keeps its place ahead of every product shot in a dressed room', () => {
    const pkg = composeExport(sceneWith(...everyCentrepiece()), 's1')
    expect(pkg.refs[1]).toEqual(BACKGROUND_REF)
    expect(pkg.refs.filter((r) => r.role === 'background')).toHaveLength(1)
  })

  it('comes out of the site photography root, not the docs folder', () => {
    // the closed root list that makes this readable lives in tools/capture-plugin.ts
    expect(BACKGROUND_REF.path.startsWith('GAMOS-DOCS/')).toBe(true)
    expect(BACKGROUND_REF.role).toBe('background')
  })

  it('asks for the setting and nothing that was built', () => {
    expect(BACKGROUND_REF.caption).toMatch(/horizon/i)
    expect(BACKGROUND_REF.caption).toMatch(/Do not copy any building/i)
  })

  it('is explained in the prompt, on the hall angles and the deck ones (§24)', () => {
    for (const id of ['s1', 's3', 'k1', 'k2']) {
      const prompt = composeExport(sceneWith(), id).prompt
      expect(prompt, id).toContain('BACKGROUND: reference image 2')
      expect(prompt, id).toContain('real site this venue stands on')
      expect(prompt, id).toContain('beyond the parapet')
    }
  })
})

/** §25: "the image has to be realistic and not look like an SKP or CGI." */
describe('realism, by explicit negation (§25)', () => {
  it('refuses the render look in as many words', () => {
    const prompt = composeExport(sceneWith(), 's1').prompt
    expect(prompt).toMatch(/not a SketchUp export/i)
    expect(prompt).toMatch(/not CGI/i)
    expect(prompt).toMatch(/not a 3D render/i)
    expect(prompt).toMatch(/not a clay or grey-shaded render/i)
    expect(prompt).toMatch(/not a viewport screenshot/i)
    expect(prompt).toMatch(/no wireframe or silhouette edges/i)
    expect(prompt).toMatch(/no flat untextured materials/i)
  })

  it('still ASKS for a photograph as well as refusing the alternative', () => {
    expect(composeExport(sceneWith(), 's1').prompt).toContain(
      'photorealistic architectural interior photograph',
    )
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
    expect(pkg.prompt).toContain('BACKGROUND: reference image 2')
    expect(pkg.prompt).toContain('DESIGN ELEMENTS: match reference image 3.')
  })

  it('renumbers when fixed elements take slots ahead of the design list', () => {
    const scene = sceneWith(
      createObject('bar.resort-left', at(1900, 850), venue),
      createObject('dj.booth', at(2000, 850), venue),
      createObject('table.round', MIDDLE, venue),
    )
    const pkg = composeExport(scene, 's1')
    // 1 materials · 2 background · 3-4 the bar and the DJ booth · 5 the table
    expect(pkg.prompt).toContain('VENUE FIXTURES: reference images 3-4')
    expect(pkg.prompt).toContain("this building's OWN bar")
    expect(pkg.prompt).toContain('DESIGN ELEMENTS: match reference image 5.')
  })

  it('leaves out the instruction for a role that sent no image', () => {
    const pkg = composeExport(sceneWith(), 's1')
    expect(pkg.prompt).not.toContain('DESIGN ELEMENTS')
    expect(pkg.prompt).not.toContain('VENUE FIXTURES')
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

/**
 * PLAN-05 C2 — "הצל לא עובד לטובתנו צריך לעשות כפתור שמכבה או מדליק את הצל".
 *
 * The toggle's whole effect on the CAPTURE is free: CaptureRegistrar renders the
 * live scene, so turning the light's shadow off is already visible in the PNG.
 * What needs code, and what is asserted here, is the one sentence that stops the
 * model from reading a shadowless capture as a request for shadowless light.
 */
describe('the shadows toggle reaches the prompt (C2)', () => {
  const withShadows = (shadowsEnabled?: boolean): SceneState => {
    const scene = sceneWith(createObject('table.round', MIDDLE, venue))
    if (shadowsEnabled !== undefined) {
      scene.settings.lighting = { ...DEFAULT_LIGHTING, shadowsEnabled }
    }
    return scene
  }

  it('says nothing at all when the project never touched the toggle', () => {
    const scene = sceneWith(createObject('table.round', MIDDLE, venue))
    expect(scene.settings.lighting?.shadowsEnabled).toBeUndefined()
    expect(composeExport(scene, 's1').prompt).not.toContain('Shadows were suppressed')
  })

  it('says nothing when shadows are explicitly ON', () => {
    expect(composeExport(withShadows(true), 's1').prompt).not.toContain('Shadows were suppressed')
  })

  it('adds the sentence when shadows are OFF', () => {
    const prompt = composeExport(withShadows(false), 's1').prompt
    expect(prompt).toContain('Shadows were suppressed in the supplied capture')
    // the half that matters: the toggle is about the INPUT, not the output
    expect(prompt).toContain('must still carry full, natural, photographic shadows')
    expect(prompt).toContain(CAPTURE_SHADOWS_OFF)
  })

  it('adds to the shared text rather than replacing any of it', () => {
    for (const state of [undefined, true, false] as const) {
      const prompt = composeExport(withShadows(state), 's1').prompt
      expect(prompt, `shadowsEnabled=${state}`).toContain(SHARED_NEGATIVE)
      expect(prompt, `shadowsEnabled=${state}`).toContain(SHARED_DIRECTION)
    }
  })

  it('sits after the rendering direction and before the negative', () => {
    const prompt = composeExport(withShadows(false), 's1').prompt
    expect(prompt.indexOf(SHARED_DIRECTION)).toBeLessThan(prompt.indexOf(CAPTURE_SHADOWS_OFF))
    expect(prompt.indexOf(CAPTURE_SHADOWS_OFF)).toBeLessThan(prompt.indexOf(SHARED_NEGATIVE))
  })

  it('never asks the model for a shadowless picture', () => {
    const prompt = composeExport(withShadows(false), 's1').prompt
    expect(prompt).not.toMatch(/no shadows|without shadows|shadowless/i)
  })
})
