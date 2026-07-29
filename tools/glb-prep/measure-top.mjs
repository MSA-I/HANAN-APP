#!/usr/bin/env node
/**
 * How big is a table's USABLE TOP, as opposed to its bounding box?
 *
 * `measure-ring.mjs` answers the same question radially and was written for the
 * ⌀380's central hole. This one exists because the answer turned out to matter for
 * every table, round and rectangular alike: a draped table's widest point is the
 * hem at the FLOOR, so the GLB bbox that `defaultSize` records is the hem, while
 * the surface a plate can stand on is several centimetres inside it. Laying place
 * settings against the declared outline therefore hangs them over the drape.
 *
 * Reports, for the top 5% of the model's height:
 *   - radial coverage (round tables): last radius still ≥90% covered
 *   - per-axis extent (rect tables):  last |x| / |z| still ≥90% covered
 * plus the same numbers for the whole model, so the inset is a subtraction.
 *
 *   node measure-top.mjs <in.glb> [gridCm]
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const inPath = process.argv[2];
const GRID = Number(process.argv[3] ?? 1);
if (!inPath) { console.error('usage: node measure-top.mjs <in.glb> [gridCm]'); process.exit(2); }

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

const doc = await io.read(inPath);

const tris = [];
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
const cx = (bb.min[0] + bb.max[0]) / 2;
const cz = (bb.min[2] + bb.max[2]) / 2;
const height = bb.max[1] - bb.min[1];

console.log(`file: ${inPath}`);
console.log(`bbox cm: x[${r2(bb.min[0])}, ${r2(bb.max[0])}] y[${r2(bb.min[1])}, ${r2(bb.max[1])}] z[${r2(bb.min[2])}, ${r2(bb.max[2])}]`);
console.log(`size cm: ${r2(bb.max[0] - bb.min[0])} x ${r2(bb.max[1] - bb.min[1])} x ${r2(bb.max[2] - bb.min[2])}`);

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

const SOLID = 0.9;

function report(label, yLo, yHi) {
  const { grid, w, h } = raster(yLo, yHi);
  const at = (px, py) => grid[py * w + px];
  const X = (px) => bb.min[0] + (px + 0.5) * GRID;
  const Z = (py) => bb.min[2] + (py + 0.5) * GRID;

  // radial
  const maxR = Math.ceil(Math.max(bb.max[0] - cx, bb.max[2] - cz)) + 1;
  const hit = new Float64Array(maxR + 1), tot = new Float64Array(maxR + 1);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const r = Math.round(Math.hypot(X(px) - cx, Z(py) - cz));
    if (r > maxR) continue;
    tot[r] += 1;
    if (at(px, py)) hit[r] += 1;
  }
  const frac = [];
  for (let r = 0; r <= maxR; r++) frac[r] = tot[r] ? hit[r] / tot[r] : 0;
  let rIn = null, rOut = null;
  for (let r = 0; r <= maxR; r++) if (frac[r] >= SOLID) { rIn = r; break; }
  for (let r = maxR; r >= 0; r--) if (frac[r] >= SOLID) { rOut = r; break; }

  // per-axis: the largest |x| whose column is ≥SOLID covered over the rows the
  // silhouette occupies at all, and the same for |z|
  const colHit = new Float64Array(w), colTot = new Float64Array(w);
  const rowHit = new Float64Array(h), rowTot = new Float64Array(h);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    colTot[px]++; rowTot[py]++;
    if (at(px, py)) { colHit[px]++; rowHit[py]++; }
  }
  // normalise each column/row against the best-covered one, so a square top reads
  // 100% across its whole width instead of tapering with the raster's margins
  const colBest = Math.max(...colHit), rowBest = Math.max(...rowHit);
  let xOut = 0, zOut = 0;
  for (let px = 0; px < w; px++) if (colBest && colHit[px] / colBest >= SOLID) xOut = Math.max(xOut, Math.abs(X(px) - cx));
  for (let py = 0; py < h; py++) if (rowBest && rowHit[py] / rowBest >= SOLID) zOut = Math.max(zOut, Math.abs(Z(py) - cz));

  // raw silhouette: the outermost covered cell on each axis, and the area — the
  // area is the only honest width for a curved band, where "half-extent" is noise
  let xRaw = 0, zRaw = 0, area = 0;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    if (!at(px, py)) continue;
    area += GRID * GRID;
    xRaw = Math.max(xRaw, Math.abs(X(px) - cx));
    zRaw = Math.max(zRaw, Math.abs(Z(py) - cz));
  }
  console.log(`  ${label.padEnd(16)} radial: solid ${rIn}…${rOut}   half-extent x=${r2(xOut)} z=${r2(zOut)}   raw x=${r2(xRaw)} z=${r2(zRaw)}   area=${r2(area)} cm²`);
  return { rIn, rOut, xOut, zOut, xRaw, zRaw, area, frac };
}

console.log(`  ${'band'.padEnd(16)} (>=${SOLID} coverage)`);
const whole = report('WHOLE MODEL', bb.min[1] - 1, bb.max[1] + 1);
const top = report('TOP 5%', bb.max[1] - height * 0.05, bb.max[1] + 1);
report('TOP 15%', bb.max[1] - height * 0.15, bb.max[1] + 1);

console.log(`\n  => top is inside the bbox by: radial ${r2((bb.max[0] - bb.min[0]) / 2 - top.rOut)} cm, x ${r2((bb.max[0] - bb.min[0]) / 2 - top.xOut)} cm, z ${r2((bb.max[2] - bb.min[2]) / 2 - top.zOut)} cm`);
console.log(`  => whole-model silhouette rOut ${whole.rOut} vs bbox half ${r2((bb.max[0] - bb.min[0]) / 2)}`);

// fine radial scan across the top's outer transition, and the inner one if a hole
const lo = Math.max(0, top.rOut - 8), hi = Math.min(top.frac.length - 1, top.rOut + 8);
console.log(`  fine top scan r=${lo}..${hi}: ` + Array.from({ length: hi - lo + 1 }, (_, i) => `${lo + i}:${(top.frac[lo + i] * 100).toFixed(0)}%`).join(' '));
if (top.rIn > 1) {
  const a = Math.max(0, top.rIn - 8), b = Math.min(top.frac.length - 1, top.rIn + 8);
  console.log(`  fine hole scan r=${a}..${b}: ` + Array.from({ length: b - a + 1 }, (_, i) => `${a + i}:${(top.frac[a + i] * 100).toFixed(0)}%`).join(' '));
}
