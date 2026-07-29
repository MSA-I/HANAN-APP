#!/usr/bin/env node
/**
 * Where is the PLATE inside decor-place-setting.glb, in the file's own frame?
 *
 * Independent of the doc comment in actions.ts: lists every flat height plateau,
 * then locates the chosen one's axis three different ways (centroid of the
 * annulus, midpoint of its bbox, and a least-squares circle fit on its OUTER
 * edge) so the three can be compared instead of trusted.
 *
 *   node measure-plate.mjs <in.glb> [plateauY]
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const inPath = process.argv[2];
const forcedY = process.argv[3] !== undefined ? Number(process.argv[3]) : null;
if (!inPath) { console.error('usage: node measure-plate.mjs <in.glb> [plateauY]'); process.exit(2); }

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

const doc = await io.read(inPath);

const pts = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    for (let i = 0; i < pos.getCount(); i++) {
      const p = pos.getElement(i, []);
      pts.push([
        (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) * 100,
        (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) * 100,
        (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) * 100,
      ]);
    }
  }
}
const r3 = (n) => Math.round(n * 1000) / 1000;
const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const p of pts) for (let a = 0; a < 3; a++) { if (p[a] < bb.min[a]) bb.min[a] = p[a]; if (p[a] > bb.max[a]) bb.max[a] = p[a]; }
console.log(`file: ${inPath}`);
console.log(`verts: ${pts.length}`);
console.log(`bbox cm: x[${r3(bb.min[0])}, ${r3(bb.max[0])}] y[${r3(bb.min[1])}, ${r3(bb.max[1])}] z[${r3(bb.min[2])}, ${r3(bb.max[2])}]`);

const mid = (a) => { let lo = Infinity, hi = -Infinity; for (const v of a) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return (lo + hi) / 2; };
function radialSpan(sample, cx, cz) {
  let lo = Infinity, hi = -Infinity;
  for (const p of sample) { const r = Math.hypot(p[0] - cx, p[2] - cz); lo = Math.min(lo, r); hi = Math.max(hi, r); }
  return [lo, hi];
}

// --- 1. every flat plateau, with the shape of the slab it forms ---
const BIN = 0.02;
const hist = new Map();
for (const p of pts) {
  const k = Math.round(p[1] / BIN);
  hist.set(k, (hist.get(k) ?? 0) + 1);
}
console.log('\nflat plateaus (0.02cm bins, densest 14) — a PLATE reads as a narrow annulus:');
console.log('   y_cm   verts   x-mid    z-mid    r about mid');
for (const [k, n] of [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).sort((a, b) => a[0] - b[0])) {
  const y = k * BIN;
  const slab = pts.filter((p) => Math.abs(p[1] - y) <= 0.03);
  const cx = mid(slab.map((p) => p[0])), cz = mid(slab.map((p) => p[2]));
  const [lo, hi] = radialSpan(slab, cx, cz);
  console.log(`  ${y.toFixed(3).padStart(6)} ${String(n).padStart(7)}  ${r3(cx).toFixed(3).padStart(7)}  ${r3(cz).toFixed(3).padStart(7)}   ${r3(lo).toFixed(2)} … ${r3(hi).toFixed(2)}`);
}

// --- 2. the plate: the named plateau, then its LARGEST connected cluster in xz.
// A height slab alone is not the plate — cutlery and glass rims cross the same
// height metres away, which is why the raw slab reads r = 9…27 instead of a ring.
const plateauY = forcedY ?? 2.28;
console.log(`\n=== plate plateau y = ${r3(plateauY)} cm ===`);

const EPS = 0.03;
const slab = pts.filter((p) => Math.abs(p[1] - plateauY) <= EPS);
console.log(`vertices within ${EPS} cm of it: ${slab.length}`);

// grid-cluster the slab: 1 cm cells, 8-connected
const CELL = 1;
const key = (p) => `${Math.floor(p[0] / CELL)},${Math.floor(p[2] / CELL)}`;
const cells = new Map();
for (const p of slab) {
  const k = key(p);
  if (!cells.has(k)) cells.set(k, []);
  cells.get(k).push(p);
}
const seen = new Set();
const clusters = [];
for (const k of cells.keys()) {
  if (seen.has(k)) continue;
  const stack = [k], members = [];
  seen.add(k);
  while (stack.length) {
    const cur = stack.pop();
    members.push(...cells.get(cur));
    const [cxi, czi] = cur.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const nk = `${cxi + dx},${czi + dz}`;
      if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
    }
  }
  clusters.push(members);
}
clusters.sort((a, b) => b.length - a.length);
console.log(`clusters in the slab (1 cm cells, 8-connected): ${clusters.length}`);
for (const c of clusters.slice(0, 5)) {
  const cx = mid(c.map((p) => p[0])), cz = mid(c.map((p) => p[2]));
  const [lo, hi] = radialSpan(c, cx, cz);
  console.log(`  ${String(c.length).padStart(5)} verts  mid (${r3(cx)}, ${r3(cz)})  r ${r3(lo)} … ${r3(hi)}`);
}
const ring = clusters[0];
console.log(`taking the largest: ${ring.length} verts`);

const centroid = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[2]], [0, 0]).map((v) => v / ring.length);
const bboxMid = [mid(ring.map((p) => p[0])), mid(ring.map((p) => p[2]))];
console.log(`  A centroid of annulus verts : x=${r3(centroid[0])} z=${r3(centroid[1])}`);
console.log(`  B midpoint of annulus bbox  : x=${r3(bboxMid[0])} z=${r3(bboxMid[1])}`);
let [rLo, rHi] = radialSpan(ring, bboxMid[0], bboxMid[1]);
console.log(`  annulus radial span about B : r = ${r3(rLo)} … ${r3(rHi)}`);

const outer = ring.filter((p) => Math.hypot(p[0] - bboxMid[0], p[2] - bboxMid[1]) >= rLo + 0.75 * (rHi - rLo));
function kasa(sample) {
  let Sx = 0, Sz = 0, Sxx = 0, Szz = 0, Sxz = 0, Sxr = 0, Szr = 0, Sr = 0;
  for (const p of sample) {
    const x = p[0], z = p[2], rr = x * x + z * z;
    Sx += x; Sz += z; Sxx += x * x; Szz += z * z; Sxz += x * z; Sxr += x * rr; Szr += z * rr; Sr += rr;
  }
  const n = sample.length;
  const A = [[2 * Sxx, 2 * Sxz, Sx], [2 * Sxz, 2 * Szz, Sz], [2 * Sx, 2 * Sz, n]];
  const b = [Sxr, Szr, Sr];
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
    [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]];
    for (let k = i + 1; k < 3; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < 3; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const s = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let acc = b[i];
    for (let j = i + 1; j < 3; j++) acc -= A[i][j] * s[j];
    s[i] = acc / A[i][i];
  }
  return [s[0], s[1], Math.sqrt(s[2] + s[0] * s[0] + s[1] * s[1])];
}
const [fx, fz, fr] = kasa(outer);
let rms = 0;
for (const p of outer) rms += (Math.hypot(p[0] - fx, p[2] - fz) - fr) ** 2;
console.log(`  C circle fit on outer edge (${outer.length} pts): x=${r3(fx)} z=${r3(fz)} r=${r3(fr)} rms=${r3(Math.sqrt(rms / outer.length))}`);
[rLo, rHi] = radialSpan(ring, fx, fz);
console.log(`  annulus radial span about C : r = ${r3(rLo)} … ${r3(rHi)}`);

// --- 3. the same in CATALOGUE cm, at the loader's per-axis fit ---
const S = { x: 36 / 45, z: 31.3 / 39.14, y: 15 / 18.73 };
console.log(`\nloader per-axis fit  x ${r3(S.x)}  z ${r3(S.z)}  y ${r3(S.y)}`);
console.log("  file (x,z)  ->  catalogue (x, y) cm   [glTF z is the plan's y]");
for (const [name, c] of [['A centroid', centroid], ['B bbox mid', bboxMid], ['C circle fit', [fx, fz]]]) {
  console.log(`  ${name.padEnd(13)} (${r3(c[0])}, ${r3(c[1])})  ->  (${r3(c[0] * S.x)}, ${r3(c[1] * S.z)})`);
}
console.log(`plate radius in catalogue cm about C: ${r3(rLo * S.x)} … ${r3(rHi * S.x)}   (⌀ ${r3(2 * rLo * S.x)} … ${r3(2 * rHi * S.x)})`);
console.log(`plateau height in catalogue cm: ${r3(plateauY * S.y)}`);

// --- 4. radial profile about the fitted axis: how deep is the plate's well? ---
console.log('\nradial profile about C (file cm) — max y per 0.5 cm ring, cutlery excluded by y<5:');
let line = '';
for (let r = 0; r < 16; r += 0.5) {
  let top = -Infinity, n = 0;
  for (const p of pts) {
    if (p[1] > 5) continue;
    const d = Math.hypot(p[0] - fx, p[2] - fz);
    if (d < r || d >= r + 0.5) continue;
    n++;
    if (p[1] > top) top = p[1];
  }
  line += `  r${r.toFixed(1)}:${n ? top.toFixed(3) : '-'}`;
  if (((r * 2) % 8) === 7) { console.log(line); line = ''; }
}
if (line) console.log(line);
