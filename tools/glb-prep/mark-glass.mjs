#!/usr/bin/env node
/**
 * Name the drinking vessels in a segmented place setting, so the renderer can
 * give them a real glass material.
 *
 * Tripo returns 81 parts called `Material_tripo_part_<n>` — pure indices, no
 * semantics, every material byte-identical, and no transparency declared
 * anywhere (Plans/R3/handoff/BLOCKED-05-A3.md). Nothing in the file says
 * "glass". What the GEOMETRY says is unambiguous, though: two narrow columns
 * stand side by side in one corner of the setting, one reaching the model's full
 * height and one stopping at a little over half of it. That is a wine glass and
 * a water glass.
 *
 * ⚠ THE RULE MUST RUN ON CLUSTERS, NOT ON PARTS. Tripo shatters each vessel into
 * thirty-odd fragments, and a fragment of the wine glass's foot is a wide flat
 * thing 3 cm off the cloth — judged alone it reads as cutlery. Parts are joined
 * into a cluster when their footprints touch, and the CLUSTER's height is what
 * decides. The plate discs are pulled out first: they underlie everything and
 * would bridge the whole setting into one cluster. (Judged per part instead, the
 * split comes out 22/35 rather than 38/32 — the fragments, not the vessels.)
 *
 * It renames rather than merges: merging is the renderer's job (propModel joins
 * parts that share a material name), and a rename survives a re-prep of the same
 * source, where a hard-coded index list would not. Merging inside the GLB is not
 * even available — the 81 parts carry 76 DIFFERENT baked textures, so it would
 * need an atlas, while the material these end up with is transmissive and has no
 * texture at all.
 *
 *   node mark-glass.mjs <in.glb> [--out <file>] [--dry]
 */
import { NodeIO } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const argv = process.argv.slice(2)
const inPath = argv[0]
if (!inPath) {
  console.error('usage: node mark-glass.mjs <in.glb> [--out <file>] [--dry]')
  process.exit(2)
}
const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : inPath
const dry = argv.includes('--dry')

/** m. A plate: wide and all but flat. Excluded before clustering — see the header. */
const PLATE_MIN_SPAN = 0.2
const PLATE_MAX_TOP = 0.03
/** m. Footprints this close count as touching. */
const JOIN_GAP = 0.01
/** m. A vessel cluster is narrower than this in BOTH horizontal axes. */
const COLUMN_MAX = 0.11
/** m. Below this it is cutlery, not something you drink from. */
const VESSEL_MIN_TOP = 0.05
/** m. Splits the two vessels. The measured pair tops out at 0.187 and 0.102. */
const TALL_MIN_TOP = 0.14

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
    parts.push({ mat, lo, hi })
  }
}

const isPlate = (p) =>
  (p.hi[0] - p.lo[0] >= PLATE_MIN_SPAN || p.hi[2] - p.lo[2] >= PLATE_MIN_SPAN) &&
  p.hi[1] <= PLATE_MAX_TOP
const plates = parts.filter(isPlate)
const rest = parts.filter((p) => !isPlate(p))

// union-find over footprint adjacency
const parent = rest.map((_, i) => i)
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
const union = (a, b) => {
  const ra = find(a)
  const rb = find(b)
  if (ra !== rb) parent[ra] = rb
}
const touches = (a, b) =>
  a.lo[0] - JOIN_GAP <= b.hi[0] &&
  b.lo[0] - JOIN_GAP <= a.hi[0] &&
  a.lo[2] - JOIN_GAP <= b.hi[2] &&
  b.lo[2] - JOIN_GAP <= a.hi[2]
for (let i = 0; i < rest.length; i++) {
  for (let j = i + 1; j < rest.length; j++) if (touches(rest[i], rest[j])) union(i, j)
}

const clusters = new Map()
rest.forEach((p, i) => {
  const r = find(i)
  const c = clusters.get(r) ?? {
    members: [],
    lo: [Infinity, Infinity, Infinity],
    hi: [-Infinity, -Infinity, -Infinity],
  }
  c.members.push(p)
  for (let k = 0; k < 3; k++) {
    c.lo[k] = Math.min(c.lo[k], p.lo[k])
    c.hi[k] = Math.max(c.hi[k], p.hi[k])
  }
  clusters.set(r, c)
})

let tall = 0
let short = 0
const kept = []
for (const c of clusters.values()) {
  const w = c.hi[0] - c.lo[0]
  const d = c.hi[2] - c.lo[2]
  const top = c.hi[1]
  const vessel = w <= COLUMN_MAX && d <= COLUMN_MAX && top > VESSEL_MIN_TOP
  const label = !vessel ? null : top >= TALL_MIN_TOP ? 'glass-tall' : 'glass-short'
  if (label) {
    for (const p of c.members) p.mat.setName(label)
    if (label === 'glass-tall') tall += c.members.length
    else short += c.members.length
  } else {
    kept.push({ n: c.members.length, w, d, top })
  }
}

console.log(inPath)
console.log(
  `  parts ${parts.length} · plates ${plates.length} · glass-tall ${tall} · glass-short ${short} · other ${
    parts.length - plates.length - tall - short
  }`,
)
console.log('  non-vessel clusters (parts, footprint cm, top cm):')
for (const k of kept.sort((a, b) => b.n - a.n)) {
  console.log(
    `    ${String(k.n).padStart(3)} parts  ${(k.w * 100).toFixed(1)} × ${(k.d * 100).toFixed(1)}  top ${(k.top * 100).toFixed(2)}`,
  )
}

if (dry) console.log('  --dry: nothing written')
else {
  await io.write(outPath, doc)
  console.log(`  → ${outPath}`)
}
