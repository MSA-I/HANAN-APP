#!/usr/bin/env node
/**
 * Rename materials in a prop to `<prefix>-NN`, so the renderer can build a real
 * material for them — either EVERY material (`--all`) or a NAMED SET (`--only`).
 *
 * The generalisation `mark-glass.mjs` and `mark-fabric.mjs` were each one case of:
 * a part is not what its baked PBR says it is, and the only durable way to say so
 * is the material NAME. `propModel.buildParts` groups by that name and
 * `editableSlots[].match` (core/catalog/types.ts) is a PREFIX of it, so a name is
 * the whole interface. Where those two tools decide WHICH parts qualify from the
 * geometry, this one is told which.
 *
 *  - `--all <prefix>` — for the model that is a single material end to end, which
 *    is exactly what the acrylic guest chair is: one mesh, one material (the
 *    user's own words: "the whole chair is the same material").
 *  - `--only <a,b,…> <prefix>` — for the model where a geometric rule no longer
 *    holds. `decor-place-setting-horizontal.glb` was re-exported segmented so its
 *    napkin could be coloured, and the finer segmentation shattered both drinking
 *    glasses into 52 parts; `mark-glass.mjs`'s proximity clustering then bridges
 *    through the shards and reports 3 tall / 0 short where the coarse export gave
 *    1 and 1. The rule is geometric and the geometry moved under it. So the caller
 *    measures (a part belongs to a glass iff its xz box sits inside that glass's
 *    own 9 cm footprint — handoff/FOUND-01-horizontal.md) and passes the answer.
 *
 * ⚠ `--only` IS NOT A LICENCE TO TYPE PART INDICES BY HAND. That is the failure
 * `mark-glass.mjs` exists to prevent, and it is still the failure. The list must
 * come from a measurement whose table is written down and reproducible; what this
 * flag adds is that the measurement no longer has to live inside this repo's
 * tools to be usable. Hence the loud exit below: a mistyped name must never
 * degrade into "marked nothing" with a zero exit code.
 *
 * Names are UNIQUE UNDER A SHARED PREFIX (`acrylic-00`, `acrylic-01`, …) even
 * when there is only one. README lines 73-75: `propModel` merges primitives whose
 * material NAME is identical and keeps only the first material, which is how
 * seventeen folds of a screen once came to wear the first fold's baked texture.
 * With one material the rule costs nothing; keeping it means the tool is never
 * the thing that reintroduces that bug.
 *
 * ⚠ THE ORDER IS A CONTRACT (README:69-71):
 *     glb-prep → inspect-materials → mark-material --dry → mark-material
 *   and re-running `glb-prep` ERASES the names. The marking is always after the
 *   preparation, never before. That is not discipline you can rely on, which is
 *   why the catalog tests read the shipped GLB back and fail if the prefix is
 *   gone (chuppahChair.test.ts, covers.test.ts).
 *
 *   node mark-material.mjs <in.glb> --all <prefix> [--out <file>] [--dry]
 *   node mark-material.mjs <in.glb> --only <name1,name2,…> <prefix> [--out <file>] [--dry]
 */
import { NodeIO } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const USAGE = [
  'usage: node mark-material.mjs <in.glb> --all <prefix> [--out <file>] [--dry]',
  '       node mark-material.mjs <in.glb> --only <name1,name2,…> <prefix> [--out <file>] [--dry]',
].join('\n')

const argv = process.argv.slice(2)
const inPath = argv[0]
const allAt = argv.indexOf('--all')
const onlyAt = argv.indexOf('--only')

if (!inPath || inPath.startsWith('--') || (allAt < 0 && onlyAt < 0)) {
  console.error(USAGE)
  process.exit(2)
}
if (allAt >= 0 && onlyAt >= 0) {
  console.error('--all and --only are alternatives; pass exactly one')
  process.exit(2)
}

/** the names `--only` was given, in the order the caller wrote them; null for --all */
let wanted = null
let prefix
if (onlyAt >= 0) {
  const list = argv[onlyAt + 1]
  prefix = argv[onlyAt + 2]
  if (!list || list.startsWith('--')) {
    console.error('--only needs a comma-separated list of material names\n' + USAGE)
    process.exit(2)
  }
  wanted = [...new Set(list.split(',').map((s) => s.trim()).filter(Boolean))]
  if (!wanted.length) {
    console.error('--only was given an empty list')
    process.exit(2)
  }
} else {
  prefix = argv[allAt + 1]
}
if (!prefix || prefix.startsWith('--')) {
  console.error(USAGE)
  process.exit(2)
}
if (!/^[a-z][a-z0-9-]*$/.test(prefix)) {
  console.error(`prefix must be lowercase kebab (got ${JSON.stringify(prefix)})`)
  process.exit(2)
}
const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : inPath
const dry = argv.includes('--dry')

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  })

const doc = await io.read(inPath)
const materials = doc.getRoot().listMaterials()

/**
 * The named list must match REAL materials. A typo that silently marks nothing is
 * the exact failure this tool exists to prevent, and it is invisible downstream:
 * the file still writes, the renderer still draws, and the glass is simply opaque.
 */
if (wanted) {
  const present = new Set(materials.map((m) => m.getName()))
  const missing = wanted.filter((n) => !present.has(n))
  if (missing.length) {
    console.error(`${inPath}: ${missing.length} of ${wanted.length} names in --only are not in this file:`)
    for (const n of missing) console.error(`    ${JSON.stringify(n)}`)
    console.error(`  the file has ${materials.length} materials; run inspect-materials.mjs to list them`)
    process.exit(1)
  }
}

const chosen = wanted ? new Set(wanted) : null
const hit = materials.filter((m) => !chosen || chosen.has(m.getName()))
const skipped = materials.filter((m) => chosen && !chosen.has(m.getName()))

console.log(inPath)
console.log(`  materials ${materials.length} → ${hit.length} marked "${prefix}-NN"` +
  (chosen ? `, ${skipped.length} left alone` : ''))
hit.forEach((m, i) => {
  const to = `${prefix}-${String(i).padStart(2, '0')}`
  console.log(`    ${JSON.stringify(m.getName())}  →  ${to}`)
  if (!dry) m.setName(to)
})
// --dry has to say what it will NOT touch as plainly as what it will: the review
// that matters is "is anything in this second list actually a glass?"
if (skipped.length) {
  console.log(`  untouched (${skipped.length}):`)
  for (const m of skipped) console.log(`    ${JSON.stringify(m.getName())}`)
}

if (dry) console.log('  --dry: nothing written')
else {
  await io.write(outPath, doc)
  console.log(`  → ${outPath}`)
}
