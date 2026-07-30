#!/usr/bin/env node
/**
 * Name the CURTAIN and the FRAME of a divider screen, so the renderer can let the
 * user recolour the cloth without touching the steel.
 *
 * Same problem and same answer as mark-glass.mjs: Tripo returns parts called
 * `Material_tripo_part_<n>` — pure indices, no semantics — and nothing in the file
 * says "fabric". What the GEOMETRY says is unambiguous. A mobile screen is a
 * pleated curtain hung inside a rectangular frame on casters, so:
 *
 *   - the two POSTS, the feet and the four casters stand at the extreme ends of
 *     the x span, entirely outside the curtain;
 *   - the top RAIL is the one part that spans most of the width;
 *   - everything else is cloth.
 *
 * WHY FRACTIONS OF THE MODEL'S OWN BBOX rather than centimetres: the rule then
 * works on the raw Tripo export (normalised to ~1.0 tall) and on the prepped file
 * (1.8 m tall) alike, so it cannot rot when the catalogued height changes. The
 * measured margin on divider-screen.glb is wide — the outermost CLOTH pleat
 * reaches 0.62 m of a 0.78 m half-width while the nearest FRAME part starts at
 * 0.73 — and the tool prints both numbers so a re-export can be re-checked
 * instead of trusted.
 *
 * ⚠ UNIQUE NAMES, SHARED PREFIX. `fabric-00…` and `frame-00…`, not one name for
 * each group: propModel.buildParts MERGES primitives that share a material name
 * and keeps only the first material, which is right for glass (the material is
 * thrown away and replaced) but would make seventeen pleats wear part 0's baked
 * texture over sixteen other UV layouts. The app matches on the PREFIX
 * (`material.name.startsWith(slot.match)`), exactly as `isGlassPart` does.
 *
 * ⚠ RUN IT AFTER glb-prep, NEVER BEFORE. Re-prepping the source rewrites every
 * material and erases these names — the same property mark-glass.mjs has.
 *
 *   node mark-fabric.mjs <in.glb> [--out <file>] [--dry]
 */
import { NodeIO } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const argv = process.argv.slice(2)
const inPath = argv[0]
if (!inPath) {
  console.error('usage: node mark-fabric.mjs <in.glb> [--out <file>] [--dry]')
  process.exit(2)
}
const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : inPath
const dry = argv.includes('--dry')

/**
 * Fraction of the half-width past which a part is structure. A part counts only
 * when it lies ENTIRELY outside it — a pleat that merely reaches behind the post
 * is still cloth.
 */
const POST_INSET = 0.9
/** Fraction of the full width a part must span to be the top rail. */
const RAIL_SPAN = 0.5

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  })

const doc = await io.read(inPath)
const root = doc.getRoot()

// world-space bbox per material, walking the node tree so transforms count
const parts = []
for (const node of root.listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const m = node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    const mat = prim.getMaterial()
    if (!pos || !mat) continue
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    const v = [0, 0, 0]
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v)
      const p = [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
      ]
      for (let k = 0; k < 3; k++) {
        if (p[k] < lo[k]) lo[k] = p[k]
        if (p[k] > hi[k]) hi[k] = p[k]
      }
    }
    parts.push({ mat, lo, hi, name: mat.getName() })
  }
}

if (!parts.length) {
  console.error('no primitives with a material — nothing to mark')
  process.exit(1)
}

const minX = Math.min(...parts.map((p) => p.lo[0]))
const maxX = Math.max(...parts.map((p) => p.hi[0]))
const width = maxX - minX
const centreX = (minX + maxX) / 2
const halfWidth = width / 2
const postFrom = POST_INSET * halfWidth
const railFrom = RAIL_SPAN * width

/** How far the NEAREST end of this part is from the model's centre line. */
const reach = (p) => Math.min(Math.abs(p.lo[0] - centreX), Math.abs(p.hi[0] - centreX))
const outer = (p) => reach(p) >= postFrom
const rail = (p) => p.hi[0] - p.lo[0] >= railFrom
const isFrame = (p) => outer(p) || rail(p)

const frame = parts.filter(isFrame)
const fabric = parts.filter((p) => !isFrame(p))

frame.forEach((p, i) => p.mat.setName(`frame-${String(i).padStart(2, '0')}`))
fabric.forEach((p, i) => p.mat.setName(`fabric-${String(i).padStart(2, '0')}`))

const cm = (v) => (v * 100).toFixed(1)
console.log(inPath)
console.log(
  `  ${parts.length} parts · width ${cm(width)} cm · post threshold ${cm(postFrom)} cm from centre · rail threshold ${cm(railFrom)} cm span`,
)
console.log(`  fabric ${fabric.length} · frame ${frame.length}`)

// The two numbers that say whether the rule still separates cleanly. They must
// straddle the post threshold, and the wider the gap the safer a re-export is.
const worstFabric = Math.max(...fabric.map(reach))
const bestFrame = Math.min(...frame.filter((p) => !rail(p)).map(reach))
console.log(
  `  ⚠ margin: outermost CLOTH reaches ${cm(worstFabric)} cm · innermost FRAME part starts ${cm(bestFrame)} cm · threshold ${cm(postFrom)} cm`,
)
if (worstFabric >= postFrom || bestFrame < postFrom) {
  console.error('  ✗ the rule does NOT separate this model — do not ship this run')
  process.exit(1)
}

console.log('  classification (was → now, reach cm, x-span cm):')
for (const p of parts) {
  console.log(
    `    ${p.name.padEnd(24)} → ${p.mat.getName().padEnd(10)} reach ${cm(reach(p)).padStart(6)}  span ${cm(p.hi[0] - p.lo[0]).padStart(6)}`,
  )
}

if (dry) console.log('  --dry: nothing written')
else {
  await io.write(outPath, doc)
  console.log(`  → ${outPath}`)
}
