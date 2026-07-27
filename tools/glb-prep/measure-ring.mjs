#!/usr/bin/env node
/**
 * Radial coverage profile of a GLB, top-down. Written to measure the central
 * hole of table-round-380.glb (PLAN-02 / A2 rInner). Temporary tool.
 *
 *   node measure-ring.mjs <in.glb> [gridCm]
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const inPath = process.argv[2];
const GRID = Number(process.argv[3] ?? 1); // cm per cell
if (!inPath) { console.error('usage: node measure-ring.mjs <in.glb> [gridCm]'); process.exit(2); }

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

const doc = await io.read(inPath);

// ---- gather world-space triangles (metres -> cm) -------------------------
const tris = []; // [ax,ay,az, bx,by,bz, cx,cy,cz] in cm
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  const xf = (p) => [
    (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) * 100,
    (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) * 100,
    (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) * 100,
  ];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const get = (i) => xf(pos.getElement(idx ? idx.getScalar(i) : i, []));
    for (let i = 0; i < n; i += 3) tris.push([...get(i), ...get(i + 1), ...get(i + 2)]);
  }
}

const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const t of tris) for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
  const c = t[v * 3 + a];
  if (c < bb.min[a]) bb.min[a] = c;
  if (c > bb.max[a]) bb.max[a] = c;
}
const r2 = (n) => Math.round(n * 100) / 100;
console.log(`triangles: ${tris.length}`);
console.log(`bbox cm: x[${r2(bb.min[0])}, ${r2(bb.max[0])}] y[${r2(bb.min[1])}, ${r2(bb.max[1])}] z[${r2(bb.min[2])}, ${r2(bb.max[2])}]`);
console.log(`size cm: ${r2(bb.max[0] - bb.min[0])} x ${r2(bb.max[1] - bb.min[1])} x ${r2(bb.max[2] - bb.min[2])}`);

const cx = (bb.min[0] + bb.max[0]) / 2;
const cz = (bb.min[2] + bb.max[2]) / 2;
const topY = bb.max[1];

// ---- rasterize a top-down silhouette, restricted to a height band --------
function raster(yLo, yHi) {
  const w = Math.ceil((bb.max[0] - bb.min[0]) / GRID) + 2;
  const h = Math.ceil((bb.max[2] - bb.min[2]) / GRID) + 2;
  const grid = new Uint8Array(w * h);
  const toX = (x) => (x - bb.min[0]) / GRID;
  const toZ = (z) => (z - bb.min[2]) / GRID;
  for (const t of tris) {
    const ys = [t[1], t[4], t[7]];
    if (Math.max(...ys) < yLo || Math.min(...ys) > yHi) continue;
    const ax = toX(t[0]), az = toZ(t[2]);
    const bx = toX(t[3]), bz = toZ(t[5]);
    const gx = toX(t[6]), gz = toZ(t[8]);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, gx)));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, gx)));
    const z0 = Math.max(0, Math.floor(Math.min(az, bz, gz)));
    const z1 = Math.min(h - 1, Math.ceil(Math.max(az, bz, gz)));
    const d = (bx - ax) * (gz - az) - (gx - ax) * (bz - az);
    if (Math.abs(d) < 1e-12) continue;
    for (let py = z0; py <= z1; py++) for (let px = x0; px <= x1; px++) {
      const qx = px + 0.5, qz = py + 0.5;
      const l1 = ((bx - qx) * (gz - qz) - (gx - qx) * (bz - qz)) / d;
      const l2 = ((gx - qx) * (az - qz) - (ax - qx) * (gz - qz)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) grid[py * w + px] = 1;
    }
  }
  return { grid, w, h };
}

/** Coverage fraction per 1cm radial bin, from the model's horizontal centre. */
function profile(label, yLo, yHi) {
  const { grid, w, h } = raster(yLo, yHi);
  const maxR = Math.ceil(Math.max(bb.max[0] - cx, bb.max[2] - cz)) + 1;
  const hit = new Float64Array(maxR + 1);
  const tot = new Float64Array(maxR + 1);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = bb.min[0] + (px + 0.5) * GRID;
    const z = bb.min[2] + (py + 0.5) * GRID;
    const r = Math.round(Math.hypot(x - cx, z - cz));
    if (r > maxR) continue;
    tot[r] += 1;
    if (grid[py * w + px]) hit[r] += 1;
  }
  console.log(`\n=== ${label}  (y ${r2(yLo)}…${r2(yHi)}) ===`);
  const frac = [];
  for (let r = 0; r <= maxR; r++) frac[r] = tot[r] ? hit[r] / tot[r] : 0;

  // first radius where coverage is solid, and last radius before it drops
  const SOLID = 0.9;
  let rIn = null, rOut = null;
  for (let r = 0; r <= maxR; r++) if (frac[r] >= SOLID) { rIn = r; break; }
  for (let r = maxR; r >= 0; r--) if (frac[r] >= SOLID) { rOut = r; break; }
  for (let r = 0; r <= maxR; r += 5) {
    const bar = '#'.repeat(Math.round(frac[r] * 40));
    console.log(`  r=${String(r).padStart(3)}  ${(frac[r] * 100).toFixed(1).padStart(5)}%  ${bar}`);
  }
  console.log(`  -> first solid (>=${SOLID}) radius: ${rIn}`);
  console.log(`  -> last  solid (>=${SOLID}) radius: ${rOut}`);
  // fine scan around the inner transition
  if (rIn != null) {
    const lo = Math.max(0, rIn - 12), hi = Math.min(maxR, rIn + 12);
    console.log(`  fine scan ${lo}..${hi}:`);
    for (let r = lo; r <= hi; r++) console.log(`     r=${String(r).padStart(3)} ${(frac[r] * 100).toFixed(1)}%`);
  }
  return { rIn, rOut, frac };
}

const height = bb.max[1] - bb.min[1];
profile('WHOLE MODEL', bb.min[1] - 1, bb.max[1] + 1);
profile('TOP BAND (top 15%)', topY - height * 0.15, topY + 1);
profile('TOP BAND (top 5%)', topY - height * 0.05, topY + 1);
