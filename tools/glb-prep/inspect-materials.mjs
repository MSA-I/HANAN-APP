#!/usr/bin/env node
/**
 * Per-material world-space bounding boxes of a GLB. Used to locate the real
 * event floor (Marble/Tile materials) inside a venue model whose overall bbox
 * also includes the desert backdrop. Reads Draco.
 *
 *   node inspect-materials.mjs <in.glb>
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const inPath = process.argv[2];
if (!inPath) { console.error('usage: node inspect-materials.mjs <in.glb>'); process.exit(2); }

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

const doc = await io.read(inPath);
const stats = new Map(); // material name -> {min,max,tris}

for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const mat = prim.getMaterial();
    const name = mat ? mat.getName() : '(none)';
    let s = stats.get(name);
    if (!s) { s = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], tris: 0 }; stats.set(name, s); }
    const idx = prim.getIndices();
    s.tris += (idx ? idx.getCount() : pos.getCount()) / 3;
    const lo = pos.getMin([]); const hi = pos.getMax([]);
    for (let cx = 0; cx < 2; cx++) for (let cy = 0; cy < 2; cy++) for (let cz = 0; cz < 2; cz++) {
      const x = cx ? hi[0] : lo[0], y = cy ? hi[1] : lo[1], z = cz ? hi[2] : lo[2];
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (wx < s.min[0]) s.min[0] = wx; if (wx > s.max[0]) s.max[0] = wx;
      if (wy < s.min[1]) s.min[1] = wy; if (wy > s.max[1]) s.max[1] = wy;
      if (wz < s.min[2]) s.min[2] = wz; if (wz > s.max[2]) s.max[2] = wz;
    }
  }
}

const r = (n) => Math.round(n * 100) / 100;
const rows = [...stats.entries()]
  .map(([name, s]) => ({
    name, tris: Math.round(s.tris),
    x: [r(s.min[0]), r(s.max[0])], y: [r(s.min[1]), r(s.max[1])], z: [r(s.min[2]), r(s.max[2])],
    size: [r(s.max[0] - s.min[0]), r(s.max[1] - s.min[1]), r(s.max[2] - s.min[2])],
  }))
  .sort((a, b) => (b.size[0] * b.size[2]) - (a.size[0] * a.size[2])); // biggest horizontal footprint first

console.log('material                              tris     x-range          z-range          y(height)     footprint(X×Z)');
for (const m of rows) {
  console.log(
    `${m.name.padEnd(36)} ${String(m.tris).padStart(7)}  ` +
    `[${String(m.x[0]).padStart(7)},${String(m.x[1]).padStart(7)}]  ` +
    `[${String(m.z[0]).padStart(7)},${String(m.z[1]).padStart(7)}]  ` +
    `[${String(m.y[0]).padStart(6)},${String(m.y[1]).padStart(6)}]  ` +
    `${m.size[0]}×${m.size[2]}`,
  );
}
