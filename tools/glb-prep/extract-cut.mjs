#!/usr/bin/env node
/**
 * Extract the `ZONE_CUT` marker — the plan's walls, traced by hand in SketchUp —
 * into plan-coordinate triangles the 2D view fills as poché.
 *
 * ⚠ THIS REPLACES SLICING THE MODEL. `extract-section.mjs` used to cut venue.glb
 * with a horizontal plane at 1.00 m, and every hard problem the 2D plan had came
 * out of that one decision: the railing vanished because the plane passed through
 * the gap between its rail and its cap; the east wall came out as 36 severed
 * stumps because two cut ranges left a 9 cm strip uncovered; and a door was not
 * identifiable at all, because the model has no door material and an opening is
 * only the ABSENCE of geometry. A hand-painted face has none of those failure
 * modes: there is no cut height to guess, an opening is simply where the user did
 * not paint, and it survives a re-import because the marking lives in the source.
 *
 * The output is a triangle soup, not contours, and that is deliberate. The faces
 * ARE the wall footprints — filling them draws exactly what was painted. The
 * contour tracer in extract-zones.mjs rasterises at 10 cm and floods the interior
 * of a closed loop, which is right for an area marker and wrong for a 10 cm wall
 * band: it would swallow the room and drop the short stubs.
 *
 * Coordinate mapping is the same as extract-zones.mjs — ZONE_FLOOR's min corner is
 * the plan origin — so the walls land in the frame the zones already use.
 *
 *   node extract-cut.mjs <marked.glb> [--out <file>]
 */
import { NodeIO } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const inPath = argv[0]
if (!inPath) {
  console.error('usage: node extract-cut.mjs <marked.glb> [--out <file>]')
  process.exit(2)
}
const outPath = argv.includes('--out')
  ? argv[argv.indexOf('--out') + 1]
  : '../../public/venue-packs/resort/cut.json'

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  })

const doc = await io.read(inPath)

const wanted = new Map([
  ['ZONE_CUT', 'cut'],
  ['ZONE_FLOOR', 'floor'],
])
const groups = new Map()
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const m = node.getWorldMatrix()
  const wx = (x, y, z) => m[0] * x + m[4] * y + m[8] * z + m[12]
  const wz = (x, y, z) => m[2] * x + m[6] * y + m[10] * z + m[14]
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? ''
    const key = wanted.get(name)
    if (!key) continue
    const pos = prim.getAttribute('POSITION')
    if (!pos) continue
    const idx = prim.getIndices()
    const tris = groups.get(key) ?? []
    groups.set(key, tris)
    const el = [0, 0, 0]
    const at = (i) => {
      pos.getElement(idx ? idx.getScalar(i) : i, el)
      return [wx(...el), wz(...el)]
    }
    const count = idx ? idx.getCount() : pos.getCount()
    for (let i = 0; i + 2 < count; i += 3) tris.push([...at(i), ...at(i + 1), ...at(i + 2)])
  }
}

const floor = groups.get('floor')
if (!floor?.length) {
  console.error('no ZONE_FLOOR found — cannot establish plan origin')
  process.exit(1)
}
const cut = groups.get('cut')
if (!cut?.length) {
  console.error('no ZONE_CUT found — paint the walls in SketchUp first')
  process.exit(1)
}

let fx = Infinity
let fz = Infinity
for (const t of floor) {
  for (let k = 0; k < 6; k += 2) {
    fx = Math.min(fx, t[k])
    fz = Math.min(fz, t[k + 1])
  }
}
const cm = (v, o) => Math.round((v - o) * 100 * 10) / 10

/** A degenerate triangle draws nothing and costs a path segment. */
const area2 = (t) => Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1]))

const tris = []
let dropped = 0
let lo = [Infinity, Infinity]
let hi = [-Infinity, -Infinity]
for (const t of cut) {
  if (area2(t) < 1e-8) {
    dropped++
    continue
  }
  const p = [cm(t[0], fx), cm(t[1], fz), cm(t[2], fx), cm(t[3], fz), cm(t[4], fx), cm(t[5], fz)]
  for (let k = 0; k < 6; k += 2) {
    lo = [Math.min(lo[0], p[k]), Math.min(lo[1], p[k + 1])]
    hi = [Math.max(hi[0], p[k]), Math.max(hi[1], p[k + 1])]
  }
  tris.push(p)
}

const payload = {
  note: 'ZONE_CUT painted in the SketchUp source and read back by tools/glb-prep/extract-cut.mjs. Plan cm, origin at the ZONE_FLOOR min corner — the same frame as venuePacks zones. Triangles, filled as poché: an opening is where nothing was painted.',
  units: 'cm',
  bounds: { minX: lo[0], minY: lo[1], maxX: hi[0], maxY: hi[1] },
  tris,
}
writeFileSync(outPath, JSON.stringify(payload))

console.log(`ZONE_CUT: ${tris.length} triangles${dropped ? ` (${dropped} degenerate dropped)` : ''}`)
console.log(`  plan bounds cm: x ${lo[0]}…${hi[0]}  y ${lo[1]}…${hi[1]}`)
console.log(`  → ${outPath}`)
