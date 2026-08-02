#!/usr/bin/env node
/**
 * Rename EVERY material in a prop to `<prefix>-NN`, so the renderer can build a
 * real material for it.
 *
 * The generalisation `mark-glass.mjs` and `mark-fabric.mjs` were each one case of:
 * a part is not what its baked PBR says it is, and the only durable way to say so
 * is the material NAME. `propModel.buildParts` groups by that name and
 * `editableSlots[].match` (core/catalog/types.ts) is a PREFIX of it, so a name is
 * the whole interface. Where those two tools decide WHICH parts qualify from the
 * geometry, this one is for the model that is a single material end to end —
 * `--all <prefix>` says "the whole thing is this", which is exactly what the
 * acrylic guest chair is: one mesh, one material (the user's own words: "the
 * whole chair is the same material").
 *
 * Names are UNIQUE UNDER A SHARED PREFIX (`acrylic-00`, `acrylic-01`, …) even
 * when there is only one. README lines 72-74: `propModel` merges primitives whose
 * material NAME is identical and keeps only the first material, which is how
 * seventeen folds of a screen once came to wear the first fold's baked texture.
 * With one material the rule costs nothing; keeping it means the tool is never
 * the thing that reintroduces that bug.
 *
 * ⚠ THE ORDER IS A CONTRACT (README:69-71):
 *     glb-prep → inspect-materials → mark-material --dry → mark-material
 *   and re-running `glb-prep` ERASES the names. The marking is always after the
 *   preparation, never before. That is not discipline you can rely on, which is
 *   why the catalog test reads the shipped GLB back and fails if the prefix is
 *   gone (chuppahChair.test.ts).
 *
 *   node mark-material.mjs <in.glb> --all <prefix> [--out <file>] [--dry]
 */
import { NodeIO } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const argv = process.argv.slice(2)
const inPath = argv[0]
const allAt = argv.indexOf('--all')
const prefix = allAt >= 0 ? argv[allAt + 1] : null
if (!inPath || !prefix) {
  console.error('usage: node mark-material.mjs <in.glb> --all <prefix> [--out <file>] [--dry]')
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

console.log(inPath)
console.log(`  materials ${materials.length} → prefix "${prefix}"`)
materials.forEach((m, i) => {
  const to = `${prefix}-${String(i).padStart(2, '0')}`
  console.log(`    ${JSON.stringify(m.getName())}  →  ${to}`)
  if (!dry) m.setName(to)
})

if (dry) console.log('  --dry: nothing written')
else {
  await io.write(outPath, doc)
  console.log(`  → ${outPath}`)
}
