#!/usr/bin/env node
/**
 * Draw-call cost and part clustering of a GLB.
 *
 * Counts meshes / primitives / materials (one primitive = one draw call in the
 * app's renderer, since propModel.ts emits a <mesh> per part), then groups the
 * materials into spatial clusters by footprint proximity so an un-named
 * segmentation can still be talked about as "the two vessels" / "the plates".
 *
 *   node inspect-parts.mjs <in.glb> [gapCm]
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const inPath = process.argv[2];
const GAP = Number(process.argv[3] ?? 2); // cm: two parts join a cluster if their footprints come this close
if (!inPath) { console.error('usage: node inspect-parts.mjs <in.glb> [gapCm]'); process.exit(2); }

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

const doc = await io.read(inPath);
const root = doc.getRoot();

let prims = 0, meshNodes = 0, tris = 0;
const box = new Map(); // material name -> bbox in cm
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  meshNodes++;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    prims++;
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const idx = prim.getIndices();
    tris += (idx ? idx.getCount() : pos.getCount()) / 3;
    const name = prim.getMaterial()?.getName() ?? '(none)';
    let b = box.get(name);
    if (!b) { b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], tris: 0 }; box.set(name, b); }
    b.tris += (idx ? idx.getCount() : pos.getCount()) / 3;
    for (let i = 0; i < pos.getCount(); i++) {
      const p = pos.getElement(i, []);
      const w = [
        (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) * 100,
        (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) * 100,
        (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) * 100,
      ];
      for (let a = 0; a < 3; a++) { if (w[a] < b.min[a]) b.min[a] = w[a]; if (w[a] > b.max[a]) b.max[a] = w[a]; }
    }
  }
}
const r2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
console.log(`file: ${inPath}`);
console.log(`meshes: ${root.listMeshes().length}  mesh nodes: ${meshNodes}  primitives (= draw calls): ${prims}  materials: ${root.listMaterials().length}  tris: ${Math.round(tris)}`);

// --- cluster the materials by footprint proximity ---
// Parts named on the command line are held out first: one wide flat disc under
// everything bridges every column into a single cluster, which says nothing.
const EXCLUDE = new Set((process.argv[4] ?? '').split(',').filter(Boolean));
const held = [];
for (const n of [...box.keys()]) {
  const m = /_(\d+)$/.exec(n);
  if (m && EXCLUDE.has(m[1])) { held.push(n); box.delete(n); }
}
if (held.length) console.log(`held out: ${held.join(', ')}`);
const names = [...box.keys()];
const near = (a, b) => {
  const A = box.get(a), B = box.get(b);
  const dx = Math.max(0, Math.max(A.min[0] - B.max[0], B.min[0] - A.max[0]));
  const dz = Math.max(0, Math.max(A.min[2] - B.max[2], B.min[2] - A.max[2]));
  return Math.hypot(dx, dz) <= GAP;
};
const parent = new Map(names.map((n) => [n, n]));
const find = (n) => { while (parent.get(n) !== n) { parent.set(n, parent.get(parent.get(n))); n = parent.get(n); } return n; };
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  if (near(names[i], names[j])) parent.set(find(names[i]), find(names[j]));
}
const groups = new Map();
for (const n of names) {
  const k = find(n);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(n);
}
const idxOf = (n) => { const m = /_(\d+)$/.exec(n); return m ? Number(m[1]) : NaN; };
const out = [...groups.values()].map((members) => {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], tris: 0 };
  for (const n of members) {
    const c = box.get(n);
    b.tris += c.tris;
    for (let a = 0; a < 3; a++) { b.min[a] = Math.min(b.min[a], c.min[a]); b.max[a] = Math.max(b.max[a], c.max[a]); }
  }
  return { members: members.slice().sort((x, y) => idxOf(x) - idxOf(y)), b };
});
out.sort((p, q) => (q.b.max[1] - q.b.min[1]) - (p.b.max[1] - p.b.min[1]));
console.log(`\nspatial clusters (materials whose footprints come within ${GAP} cm), tallest first:`);
for (const { members, b } of out) {
  console.log(
    `\n  ${members.length} parts · ${Math.round(b.tris)} tris · ` +
    `x[${r2(b.min[0])}, ${r2(b.max[0])}] z[${r2(b.min[2])}, ${r2(b.max[2])}] y[${r2(b.min[1])}, ${r2(b.max[1])}]  ` +
    `footprint ${r2(b.max[0] - b.min[0])}×${r2(b.max[2] - b.min[2])} cm, height ${r2(b.max[1] - b.min[1])} cm`,
  );
  const ids = members.map(idxOf).filter((n) => !Number.isNaN(n)).sort((a, c) => a - c);
  console.log(`    part indices: ${ids.length === members.length ? ids.join(', ') : members.join(', ')}`);
}
