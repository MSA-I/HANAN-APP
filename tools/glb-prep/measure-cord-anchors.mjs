#!/usr/bin/env node
/**
 * Where the vertical cords of a multi-drum pendant stand, in the file's own frame
 * and as fractions of its own bounds — the frame `CatalogEntry.cordAnchors` uses.
 *
 * `inspect-parts.mjs` cannot answer this: it clusters by MATERIAL NAME, and
 * `decor-pendant-geometric.glb` has exactly one material for the whole cluster —
 * 1 part, 35,728 tris. Structurally incapable, not merely unhelpful. So this reads
 * the geometry directly: bake every node's world matrix, take a horizontal band of
 * vertices, project to XZ and find the connected components of the occupied cells.
 *
 *   node measure-cord-anchors.mjs <in.glb> [--cord y0:y1] [--drum y0:y1]
 *                                          [--gap cm] [--expect n]
 *
 *     --cord    the band the CORDS are read from, in file cm. Default: the top
 *               10% of the model. Thin vertical columns are the least ambiguous
 *               thing in a file like this — but only where every cord reaches the
 *               band, which is exactly what the profile below is printed to check.
 *     --drum    the band the DRUMS are read from. Default: the bottom 35%.
 *     --gap     raster cell, and therefore the distance at which two columns are
 *               judged to be one. Default 2.
 *     --expect  how many cords the model VISIBLY has. Given, a different count is
 *               a hard failure — a partial read is worse than no read, because it
 *               looks like an answer.
 *
 * ⚠ THE DRUM READ IS THE CHECK, AND IT IS NOT A FORMALITY. Every drum's vertices
 * are assigned to the nearest cord and the resulting centroid is compared with
 * that cord. A cord with no drum under it shows up as a cluster that is tiny, or
 * whose centroid drifts far from the cord it was seeded from. If that happens the
 * model is not N drums on N vertical cords and the assumption behind `cordAnchors`
 * is wrong for this file — stop and report rather than shipping a guess.
 *
 * Measure the PREPPED file in public/props, never the raw source: the fractions
 * this prints are only meaningful in the frame the catalogue's `modelSize`
 * describes.
 *
 * ⚠ WHY THE BANDS ARE ARGUMENTS AND NOT CONSTANTS. The defaults assume every drum
 * hangs at the same height. `decor-pendant-geometric.glb` does not — its four
 * cords are of four different lengths, and only one of them reaches the top of the
 * model, so the default cord band finds ONE column and says so. Read the profile,
 * find the band where the count is stable, and name it. The command that produced
 * a catalogued number belongs in the comment beside it.
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const argv = process.argv.slice(2);
const inPath = argv.find((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const band = (name) => {
  const v = flag(name);
  if (!v) return null;
  const [a, b] = v.split(':').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) { console.error(`--${name} wants y0:y1 in file cm`); process.exit(2); }
  return [a, b];
};
const GAP = Number(flag('gap') ?? 2);
const EXPECT = flag('expect') === null ? null : Number(flag('expect'));
if (!inPath) {
  console.error('usage: node measure-cord-anchors.mjs <in.glb> [--cord y0:y1] [--drum y0:y1] [--gap cm] [--expect n]');
  process.exit(2);
}

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

const doc = await io.read(inPath);

// --- every vertex, world-transformed, in cm -------------------------------------
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
if (!pts.length) { console.error('no POSITION data in the file'); process.exit(2); }

const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const p of pts) {
  for (let a = 0; a < 3; a++) {
    if (p[a] < bounds.min[a]) bounds.min[a] = p[a];
    if (p[a] > bounds.max[a]) bounds.max[a] = p[a];
  }
}
const size = [0, 1, 2].map((a) => bounds.max[a] - bounds.min[a]);
const centre = [0, 1, 2].map((a) => (bounds.min[a] + bounds.max[a]) / 2);
const r2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const r4 = (n) => (Math.round(n * 10000) / 10000).toFixed(4);
const H = size[1];

console.log(`file: ${inPath}`);
console.log(`vertices: ${pts.length}`);
console.log(
  `bounds cm  x[${r2(bounds.min[0])}, ${r2(bounds.max[0])}]  ` +
  `y[${r2(bounds.min[1])}, ${r2(bounds.max[1])}]  z[${r2(bounds.min[2])}, ${r2(bounds.max[2])}]`,
);
console.log(`size cm    ${r2(size[0])} × ${r2(size[2])} × ${r2(size[1])} (w × d × h)`);
console.log(`plan centre cm  x ${r2(centre[0])}  z ${r2(centre[2])}   ← anchors are fractions FROM here`);

/**
 * Connected components of the XZ footprint of one horizontal band.
 *
 * Rasterising first and connecting CELLS rather than points is what makes `gap`
 * mean one thing: two columns are the same cord if their occupied cells touch,
 * regardless of how densely either is tessellated. 4-connected, not 8: a diagonal
 * touch is one cell corner and would bridge two cords that pass within `gap`√2.
 */
function components(y0, y1) {
  const cells = new Map();
  for (const p of pts) {
    if (p[1] < y0 || p[1] > y1) continue;
    const i = Math.floor(p[0] / GAP);
    const j = Math.floor(p[2] / GAP);
    const k = `${i},${j}`;
    let c = cells.get(k);
    if (!c) { c = { i, j, pts: [] }; cells.set(k, c); }
    c.pts.push(p);
  }
  const parent = new Map([...cells.keys()].map((k) => [k, k]));
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (const c of cells.values()) {
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const n = `${c.i + di},${c.j + dj}`;
      if (!cells.has(n)) continue;
      const a = find(`${c.i},${c.j}`), b = find(n);
      if (a !== b) parent.set(a, b);
    }
  }
  const groups = new Map();
  for (const [key, c] of cells) {
    const r = find(key);
    let g = groups.get(r);
    if (!g) { g = []; groups.set(r, g); }
    for (const p of c.pts) g.push(p);
  }
  return [...groups.values()].map(stats).sort((a, b) => a.cz - b.cz || a.cx - b.cx);
}

function stats(ps) {
  return {
    n: ps.length,
    cx: ps.reduce((a, p) => a + p[0], 0) / ps.length,
    cz: ps.reduce((a, p) => a + p[2], 0) / ps.length,
    minX: Math.min(...ps.map((p) => p[0])),
    maxX: Math.max(...ps.map((p) => p[0])),
    minZ: Math.min(...ps.map((p) => p[2])),
    maxZ: Math.max(...ps.map((p) => p[2])),
    minY: Math.min(...ps.map((p) => p[1])),
    maxY: Math.max(...ps.map((p) => p[1])),
  };
}

/**
 * Read the profile before trusting either band: a component count that is constant
 * down the column is N cords; a count that climbs as you descend is a STAGGERED
 * cluster, where no single slice cuts every cord and the bands have to be named by
 * hand off this table.
 */
console.log(`\nvertical profile (${GAP} cm slices, XZ components per slice):`);
for (let y = bounds.min[1]; y < bounds.max[1]; y += GAP) {
  const slice = components(y, y + GAP);
  const n = slice.reduce((s, c) => s + c.n, 0);
  console.log(
    `  y ${r2(y).padStart(6)}–${r2(Math.min(y + GAP, bounds.max[1])).padStart(6)}  ` +
    `${String(n).padStart(6)} verts  ${slice.length} comp  ` +
    slice.map((c) => `(${r2(c.cx)}, ${r2(c.cz)})`).join(' '),
  );
}

const cordBand = band('cord') ?? [bounds.min[1] + H * 0.90, bounds.max[1]];
// Everything below the cords by default, not the bottom third: in a staggered
// cluster the drums sit at four different heights, and any fixed band catches some
// of them and misses others. Taking all of it costs nothing — each vertex still
// goes to its nearest cord.
const drumBand = band('drum') ?? [bounds.min[1], cordBand[0]];

const cords = components(...cordBand);
console.log(`\nCORDS — y ∈ [${r2(cordBand[0])}, ${r2(cordBand[1])}] cm: ${cords.length} column(s)`);
for (const [i, c] of cords.entries()) {
  const fx = (c.cx - centre[0]) / size[0];
  const fz = (c.cz - centre[2]) / size[2];
  console.log(
    `  #${i}  centroid x ${r2(c.cx).padStart(7)} z ${r2(c.cz).padStart(7)}` +
    `   bbox x[${r2(c.minX)}, ${r2(c.maxX)}] z[${r2(c.minZ)}, ${r2(c.maxZ)}]   ${c.n} verts` +
    `\n      { x: ${r4(fx)}, y: ${r4(fz)} }   ← fraction of file bounds; plan y is three z`,
  );
}

/**
 * How high each cord actually reaches, as a fraction of the model. All 1.0 means
 * the cluster hangs off one plane and a single procedural cord above the model's
 * top continues every one of them. Anything less is a cord that ends in mid-air.
 */
console.log('\nCORD TOPS — how far up the model each one reaches:');
for (const [i, c] of cords.entries()) {
  const column = pts.filter((p) => Math.hypot(p[0] - c.cx, p[2] - c.cz) <= GAP);
  const top = Math.max(...column.map((p) => p[1]));
  console.log(`  #${i}  top y ${r2(top).padStart(6)} cm = ${r4((top - bounds.min[1]) / H)} of the model`);
}

/**
 * The check. Every drum-band vertex goes to the nearest cord; a cord with nothing
 * under it comes back with a tiny cluster or a centroid metres from where it was
 * seeded. Seeded rather than clustered blind because these drums are open lattices
 * that overlap in plan — 4 drums 12.5 cm across in a 42.6 cm strip cannot be
 * separated by their footprints, and pretending otherwise is how a partial read
 * gets shipped.
 */
console.log(`\nDRUMS — y ∈ [${r2(drumBand[0])}, ${r2(drumBand[1])}] cm, assigned to the nearest cord:`);
const buckets = cords.map(() => []);
let assigned = 0;
for (const p of pts) {
  if (p[1] < drumBand[0] || p[1] > drumBand[1]) continue;
  let best = -1, bestD = Infinity;
  for (const [i, c] of cords.entries()) {
    const d = Math.hypot(p[0] - c.cx, p[2] - c.cz);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) { buckets[best].push(p); assigned++; }
}
let failed = false;
let worst = 0;
let narrowest = Infinity;
for (const [i, ps] of buckets.entries()) {
  if (!ps.length) {
    console.log(`  #${i}  NOTHING under this cord`);
    failed = true;
    continue;
  }
  const s = stats(ps);
  const d = Math.hypot(s.cx - cords[i].cx, s.cz - cords[i].cz);
  worst = Math.max(worst, d);
  narrowest = Math.min(narrowest, Math.max(s.maxX - s.minX, s.maxZ - s.minZ));
  console.log(
    `  #${i}  ${String(s.n).padStart(6)} verts (${r2((s.n / assigned) * 100)}%)  ` +
    `centroid x ${r2(s.cx).padStart(7)} z ${r2(s.cz).padStart(7)}  Δ from cord ${r2(d)} cm  ` +
    `footprint ${r2(s.maxX - s.minX)}×${r2(s.maxZ - s.minZ)} cm`,
  );
}

console.log('\nVERDICT');
// A drum in this file is ~12.5 cm across, so a couple of centimetres is a cord
// entering an open lattice off-centre. Past half a drum it is not the same object
// and the anchor would be a fiction.
console.log(`  worst cord→drum offset: ${r2(worst)} cm`);
if (worst > 4) {
  console.log('  ✗ a drum centroid is further from its cord than half a drum. Do NOT ship these numbers.');
  failed = true;
}
// A body, not a wire. Vertex SHARE is useless here — the drums of a staggered
// cluster are different sizes at different heights, so one of them holding 4% of
// the vertices says nothing. What says something is that every cord has a
// drum-shaped footprint under it rather than more of its own cord.
console.log(`  narrowest thing hanging from a cord: ${r2(narrowest)} cm across (raster is ${GAP})`);
if (narrowest < GAP * 3) {
  console.log('  ✗ one cord has only a wire under it, not a drum — the cord count is wrong for this model.');
  failed = true;
}
if (EXPECT !== null && cords.length !== EXPECT) {
  console.log(`  ✗ expected ${EXPECT} cords, found ${cords.length} — a partial read, not an answer.`);
  failed = true;
}
if (!failed) console.log(`  ✓ ${cords.length} cords, each standing over its own drum.`);
process.exit(failed ? 1 : 0);
