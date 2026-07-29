#!/usr/bin/env node
/**
 * Measure the lighting-truss beam positions out of a venue GLB, so
 * venuePacks.ts `ceilingBeams` can be geometry-extracted instead of hand
 * transcribed from the SketchUp clamp nodes.
 *
 *   node extract-beams.mjs <in.glb> [--offset ox,oz] [--clip x,y,w,d]
 *                          [--band loCm,hiCm] [--report prims|runs|beams]
 *
 * Coordinates: the pack applies `offset` (metres) to the loaded model, so a raw
 * GLB position maps to the plan as
 *     planX_cm = rawX * 100
 *     planY_cm = (rawZ + oz) * 100
 *     planH_cm = rawY * 100
 * (`--offset` takes the pack's ox,oz — for resort that is 0,24.861.)
 *
 * Method: the truss is a set of long thin runs. Every primitive that lives in
 * the height band gets its world-space bbox; a bbox far longer on one plan axis
 * than the other is a member of a run along that axis, and its centre on the
 * PERPENDICULAR axis is where that run sits. Members are then clustered by that
 * perpendicular centre, which is exactly the `positions` array's semantics.
 *
 * Reads Draco. Linear in primitives: only the accessor min/max is touched, not
 * the 3.2M vertices — except `--report verts`, which does open one node up.
 *
 * Other reports, in the order you want them when a model is new to you:
 *   materials  which materials live at that height at all
 *   nodes      how the assembly repeats — a node appearing 36 or 72 times is a fitting
 *   near       everything above one plan point, by height: what a fixture is made of
 *   prims      raw per-primitive bboxes
 *   runs       the long thin members, i.e. the beam candidates
 *   crossings  cluster the small hardware into hang points, and collapse to a grid
 *   verts      real vertices of the selected nodes, clustered per plan axis
 *
 * On resort/venue.glb this found ELEVEN ⌀7cm tubes along y at x = 158 + 405k,
 * height 909–916, and nothing at all running along x — see
 * HANAN-APP-DOCS/Plans/R3/handoff/01-beams.md. The 72 HalfCoupler clamps that the
 * old hand transcription read are 36 hanging light fixtures, not beams, and they
 * grip the tube from its +x side, which is where that transcript's ~17cm bias
 * came from. If you re-run this after a re-export, expect the same shape.
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const argv = process.argv.slice(2);
const inPath = argv.find((a) => !a.startsWith('--'));
if (!inPath) {
  console.error('usage: node extract-beams.mjs <in.glb> [--offset ox,oz] [--clip x,y,w,d] [--band lo,hi] [--report prims|runs|beams]');
  process.exit(2);
}
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const nums = (s) => s.split(',').map(Number);

const [ox, oz] = nums(flag('offset', '0,0'));
const clip = flag('clip', null) ? nums(flag('clip')) : null;   // plan cm x,y,w,d
const [bandLo, bandHi] = nums(flag('band', '800,1000'));       // plan cm
const report = flag('report', 'beams');
const matFilter = flag('material', null);                      // substring
const nodeFilter = flag('nodes', null) ? new RegExp(flag('nodes')) : null;
const limit = Number(flag('limit', '120'));

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

const doc = await io.read(inPath);

/** raw GLB world coords -> plan cm */
const toPlan = (wx, wy, wz) => [wx * 100, (wz + oz) * 100, wy * 100];

const prims = [];
let totalPrims = 0;

for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    totalPrims++;
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const lo = pos.getMin([]);
    const hi = pos.getMax([]);
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (let cx = 0; cx < 2; cx++) for (let cy = 0; cy < 2; cy++) for (let cz = 0; cz < 2; cz++) {
      const x = cx ? hi[0] : lo[0], y = cy ? hi[1] : lo[1], z = cz ? hi[2] : lo[2];
      const w = [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
      ];
      for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
    }
    const a = toPlan(min[0], min[1], min[2]);
    const b = toPlan(max[0], max[1], max[2]);
    const p = {
      material: prim.getMaterial() ? prim.getMaterial().getName() : '(none)',
      node: node.getName(),
      tris: Math.round((prim.getIndices() ? prim.getIndices().getCount() : pos.getCount()) / 3),
      x: [Math.min(a[0], b[0]), Math.max(a[0], b[0])],
      y: [Math.min(a[1], b[1]), Math.max(a[1], b[1])],
      h: [Math.min(a[2], b[2]), Math.max(a[2], b[2])],
    };
    p.cx = (p.x[0] + p.x[1]) / 2;
    p.cy = (p.y[0] + p.y[1]) / 2;
    p.ch = (p.h[0] + p.h[1]) / 2;
    p.w = p.x[1] - p.x[0];
    p.d = p.y[1] - p.y[0];
    p.t = p.h[1] - p.h[0];
    prims.push(p);
  }
}

// Everything that lives at truss height, inside the hall rectangle.
const inBand = prims.filter((p) => {
  if (p.ch < bandLo || p.ch > bandHi) return false;
  if (matFilter && !p.material.includes(matFilter)) return false;
  if (nodeFilter && !nodeFilter.test(p.node || '')) return false;
  if (clip) {
    const [cx0, cy0, cw, cd] = clip;
    if (p.x[1] < cx0 || p.x[0] > cx0 + cw) return false;
    if (p.y[1] < cy0 || p.y[0] > cy0 + cd) return false;
  }
  return true;
});

const r1 = (n) => Math.round(n * 10) / 10;

if (report === 'materials') {
  const byMat = new Map();
  for (const p of inBand) {
    let s = byMat.get(p.material);
    if (!s) { s = { n: 0, tris: 0, x: [Infinity, -Infinity], y: [Infinity, -Infinity], h: [Infinity, -Infinity] }; byMat.set(p.material, s); }
    s.n++; s.tris += p.tris;
    s.x[0] = Math.min(s.x[0], p.x[0]); s.x[1] = Math.max(s.x[1], p.x[1]);
    s.y[0] = Math.min(s.y[0], p.y[0]); s.y[1] = Math.max(s.y[1], p.y[1]);
    s.h[0] = Math.min(s.h[0], p.h[0]); s.h[1] = Math.max(s.h[1], p.h[1]);
  }
  console.log(`${totalPrims} primitives total, ${inBand.length} in band ${bandLo}..${bandHi} cm${clip ? ' inside clip' : ''}\n`);
  console.log('material                         prims     tris   planX            planY            height');
  for (const [name, s] of [...byMat.entries()].sort((a, b) => b[1].tris - a[1].tris)) {
    console.log(
      `${name.padEnd(30)} ${String(s.n).padStart(6)} ${String(s.tris).padStart(8)}  ` +
      `[${String(r1(s.x[0])).padStart(7)},${String(r1(s.x[1])).padStart(7)}]  ` +
      `[${String(r1(s.y[0])).padStart(7)},${String(r1(s.y[1])).padStart(7)}]  ` +
      `[${String(r1(s.h[0])).padStart(6)},${String(r1(s.h[1])).padStart(6)}]`,
    );
  }
  process.exit(0);
}

// A primitive that merges many separate members has a bbox as wide as the whole
// hall, so the run test above cannot see inside it. This opens one up: it reads
// the real vertices and clusters them per plan axis, which finds members that
// are geometrically separate but share a primitive.
if (report === 'verts') {
  const gap = Number(flag('gap', '20'));
  // `--band` picks primitives by their centre height; `--vband` then keeps only
  // the vertices at the level of interest, so a tall primitive can be sliced.
  const [vLo, vHi] = nums(flag('vband', `${bandLo},${bandHi}`));
  const want = new Set(inBand.map((p) => `${p.node}|${p.material}`));
  const xs = [], ys = [], hs = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial() ? prim.getMaterial().getName() : '(none)';
      if (!want.has(`${node.getName()}|${mat}`)) continue;
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const el = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        const [x, y, z] = el;
        const p = toPlan(
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        );
        if (p[2] < vLo || p[2] > vHi) continue;
        if (clip) {
          const [cx0, cy0, cw, cd] = clip;
          if (p[0] < cx0 || p[0] > cx0 + cw || p[1] < cy0 || p[1] > cy0 + cd) continue;
        }
        xs.push(p[0]); ys.push(p[1]); hs.push(p[2]);
      }
    }
  }
  console.log(`${xs.length} vertices from ${want.size} node|material pairs\n`);
  const groupsOf = (vals) => {
    const s = [...vals].sort((a, b) => a - b);
    const g = [];
    for (const v of s) {
      const last = g[g.length - 1];
      if (last && v - last.hi <= gap) { last.hi = v; last.n++; } else g.push({ lo: v, hi: v, n: 1 });
    }
    return g;
  };
  for (const [name, vals] of [['plan x', xs], ['plan y', ys], ['height', hs]]) {
    const g = groupsOf(vals);
    console.log(`${name}: ${g.length} clusters (gap > ${gap} cm)`);
    for (const c of g.slice(0, 40)) {
      console.log(`  [${String(r1(c.lo)).padStart(8)},${String(r1(c.hi)).padStart(8)}]  width ${String(r1(c.hi - c.lo)).padStart(7)}  centre ${String(r1((c.lo + c.hi) / 2)).padStart(8)}  verts ${c.n}`);
    }
    if (g.length > 40) console.log(`  … ${g.length - 40} more`);
    console.log();
  }
  process.exit(0);
}

if (report === 'nodes') {
  const byNode = new Map();
  for (const p of inBand) {
    const k = `${p.node}|${p.material}`;
    let s = byNode.get(k);
    if (!s) { s = { node: p.node, material: p.material, n: 0, w: 0, d: 0, t: 0, tris: p.tris, h: [Infinity, -Infinity] }; byNode.set(k, s); }
    s.n++; s.w += p.w; s.d += p.d; s.t += p.t;
    s.h[0] = Math.min(s.h[0], p.h[0]); s.h[1] = Math.max(s.h[1], p.h[1]);
  }
  console.log(`${inBand.length} primitives in band\n`);
  console.log('node                      material                    count  avg w×d×t          h-range');
  for (const s of [...byNode.values()].sort((a, b) => b.n - a.n)) {
    console.log(
      `${String(s.node).slice(0, 24).padEnd(25)} ${s.material.padEnd(26)} ${String(s.n).padStart(6)}  ` +
      `${String(r1(s.w / s.n)).padStart(6)}×${String(r1(s.d / s.n)).padStart(6)}×${String(r1(s.t / s.n)).padStart(6)}  ` +
      `[${String(r1(s.h[0])).padStart(6)},${String(r1(s.h[1])).padStart(6)}]`,
    );
  }
  process.exit(0);
}

if (report === 'near') {
  const [nx, ny, nr] = nums(flag('near', '0,0,100'));
  const hits = prims.filter((p) => p.x[1] >= nx - nr && p.x[0] <= nx + nr && p.y[1] >= ny - nr && p.y[0] <= ny + nr);
  console.log(`${hits.length} primitives within ${nr} cm of plan (${nx}, ${ny}), by height\n`);
  console.log('   h        h-range          w×d      tris  material                   node');
  for (const p of hits.sort((a, b) => a.ch - b.ch).slice(0, limit)) {
    console.log(
      `${String(r1(p.ch)).padStart(8)}  [${String(r1(p.h[0])).padStart(6)},${String(r1(p.h[1])).padStart(6)}]  ` +
      `${String(r1(p.w)).padStart(6)}×${String(r1(p.d)).padStart(6)}  ${String(p.tris).padStart(6)}  ` +
      `${p.material.padEnd(25)} ${String(p.node).slice(0, 24)}`,
    );
  }
  process.exit(0);
}

if (report === 'prims') {
  console.log(`${inBand.length} primitives in band\n`);
  console.log('material                       node                            tris    planX              planY              h       w×d');
  for (const p of inBand.sort((a, b) => b.w * b.d - a.w * a.d).slice(0, limit)) {
    console.log(
      `${p.material.padEnd(30)} ${String(p.node).slice(0, 30).padEnd(30)} ${String(p.tris).padStart(6)}  ` +
      `[${String(r1(p.x[0])).padStart(7)},${String(r1(p.x[1])).padStart(7)}]  ` +
      `[${String(r1(p.y[0])).padStart(7)},${String(r1(p.y[1])).padStart(7)}]  ` +
      `${String(r1(p.ch)).padStart(6)}  ${r1(p.w)}×${r1(p.d)}`,
    );
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Runs: a beam is a member far longer on one plan axis than the other. `axis` is
// the axis it RUNS ALONG, matching CeilingBeams.axis, and `at` is its centre on
// the perpendicular axis — which is what `positions` holds.
const minLen = Number(flag('min-len', '500'));   // cm along the run
const maxWide = Number(flag('max-wide', '120')); // cm across it

const minAcross = Number(flag('min-across', '1')); // drops zero-thickness planes

const runs = [];
for (const p of inBand) {
  // A roof edge is exported as a single quad: long, and exactly 0 thick across.
  // It reads as a perfect beam and is not one, so require some real thickness.
  if (p.d >= minLen && p.w <= maxWide && p.w >= minAcross) runs.push({ ...p, axis: 'y', at: p.cx, from: p.y[0], to: p.y[1], across: p.w });
  else if (p.w >= minLen && p.d <= maxWide && p.d >= minAcross) runs.push({ ...p, axis: 'x', at: p.cy, from: p.x[0], to: p.x[1], across: p.d });
}

if (report === 'runs') {
  console.log(`${inBand.length} primitives in band ${bandLo}..${bandHi} cm; ${runs.length} are runs (>=${minLen} long, <=${maxWide} across)\n`);
  console.log('axis    at     span                 h        across  tris  material                    node');
  for (const r of runs.sort((a, b) => (a.axis === b.axis ? a.at - b.at : a.axis < b.axis ? -1 : 1))) {
    console.log(
      `  ${r.axis}  ${String(r1(r.at)).padStart(7)}  [${String(r1(r.from)).padStart(7)},${String(r1(r.to)).padStart(7)}]  ` +
      `${String(r1(r.ch)).padStart(6)}  ${String(r1(r.across)).padStart(6)}  ${String(r.tris).padStart(5)}  ` +
      `${r.material.padEnd(26)} ${String(r.node).slice(0, 24)}`,
    );
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Crossings: the coupler hardware. Every small blob at truss height is a part of
// some clamp; parts within `--xtol` of each other belong to one crossing. A
// single part is eccentric (a coupler is bolted to the side of the tube and is
// rotated), so the estimator is the union bbox centre of ALL parts at that
// crossing, which is far steadier than any one of them.
if (report === 'crossings' || report === 'crossing-grid') {
  const xtol = Number(flag('xtol', '120'));
  const blobs = inBand.filter((p) => p.w <= maxWide && p.d <= maxWide);
  const cs = [];
  for (const b of blobs.sort((a, b2) => a.cx - b2.cx || a.cy - b2.cy)) {
    const hit = cs.find((c) => Math.abs(c.cx - b.cx) <= xtol && Math.abs(c.cy - b.cy) <= xtol);
    if (hit) {
      hit.x[0] = Math.min(hit.x[0], b.x[0]); hit.x[1] = Math.max(hit.x[1], b.x[1]);
      hit.y[0] = Math.min(hit.y[0], b.y[0]); hit.y[1] = Math.max(hit.y[1], b.y[1]);
      hit.h[0] = Math.min(hit.h[0], b.h[0]); hit.h[1] = Math.max(hit.h[1], b.h[1]);
      hit.n++; hit.cx = (hit.x[0] + hit.x[1]) / 2; hit.cy = (hit.y[0] + hit.y[1]) / 2;
      hit.materials.add(b.material);
    } else {
      cs.push({ x: [...b.x], y: [...b.y], h: [...b.h], cx: b.cx, cy: b.cy, n: 1, materials: new Set([b.material]) });
    }
  }
  cs.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  console.log(`${blobs.length} blobs -> ${cs.length} crossings (xtol ${xtol} cm)\n`);
  if (report === 'crossings') {
    console.log('    cx       cy    parts   x-extent            y-extent            h');
    for (const c of cs) {
      console.log(
        `${String(r1(c.cx)).padStart(8)} ${String(r1(c.cy)).padStart(8)} ${String(c.n).padStart(6)}   ` +
        `[${String(r1(c.x[0])).padStart(7)},${String(r1(c.x[1])).padStart(7)}]  ` +
        `[${String(r1(c.y[0])).padStart(7)},${String(r1(c.y[1])).padStart(7)}]  ` +
        `[${String(r1(c.h[0])).padStart(6)},${String(r1(c.h[1])).padStart(6)}]`,
      );
    }
  }
  // Collapse the crossing centres onto each axis: rows share a plan y, columns a plan x.
  const collapse = (vals, t) => {
    const s = [...vals].sort((a, b) => a - b);
    const g = [];
    for (const v of s) {
      const last = g[g.length - 1];
      if (last && v - last[last.length - 1] <= t) last.push(v); else g.push([v]);
    }
    return g;
  };
  for (const [key, label] of [['cx', 'columns (plan x)'], ['cy', 'rows (plan y)']]) {
    const groups = collapse(cs.map((c) => c[key]), 200);
    console.log(`\n${label}: ${groups.length} groups`);
    for (const g of groups) {
      const mean = g.reduce((a, b) => a + b, 0) / g.length;
      const lo = Math.min(...g), hi = Math.max(...g);
      console.log(`  mean ${String(r1(mean)).padStart(8)}  median ${String(r1(g[(g.length - 1) >> 1])).padStart(8)}  n=${String(g.length).padStart(2)}  spread [${r1(lo)},${r1(hi)}] = ${r1(hi - lo)}`);
    }
    console.log(`  means: [${groups.map((g) => Math.round(g.reduce((a, b) => a + b, 0) / g.length)).join(', ')}]`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Cluster runs of the same axis whose perpendicular centres are close: several
// members (chords, lacing) can belong to one beam. The beam's position is the
// centre of the cluster's full perpendicular extent, i.e. of its cross-section.
const tol = Number(flag('tol', '60'));

function cluster(axis) {
  const members = runs.filter((r) => r.axis === axis).sort((a, b) => a.at - b.at);
  const out = [];
  for (const m of members) {
    const last = out[out.length - 1];
    if (last && m.at - last.members[last.members.length - 1].at <= tol) last.members.push(m);
    else out.push({ members: [m] });
  }
  return out.map((c) => {
    const lo = Math.min(...c.members.map((m) => (axis === 'y' ? m.x[0] : m.y[0])));
    const hi = Math.max(...c.members.map((m) => (axis === 'y' ? m.x[1] : m.y[1])));
    return {
      axis,
      at: (lo + hi) / 2,
      across: hi - lo,
      from: Math.min(...c.members.map((m) => m.from)),
      to: Math.max(...c.members.map((m) => m.to)),
      hLo: Math.min(...c.members.map((m) => m.h[0])),
      hHi: Math.max(...c.members.map((m) => m.h[1])),
      n: c.members.length,
      materials: [...new Set(c.members.map((m) => m.material))],
    };
  });
}

// ponytail: the baseline to diff against is the resort pack's pre-2026-07-29
// transcription, pasted here rather than imported. The tool is plain node and
// venuePacks.ts is TypeScript inside the app, so reading it would mean a compile
// step for one array. Upgrade path when a second pack exists: pass the baseline
// in with `--old y=...,x=...`, or emit JSON and diff outside the tool.
const OLD = { y: [578, 988, 1389, 1798, 2194, 2599, 3011, 3420, 3821], x: [190, 550, 904, 1270], height: 910 };

for (const axis of ['y', 'x']) {
  const beams = cluster(axis);
  console.log(`\naxis '${axis}' — ${beams.length} beam${beams.length === 1 ? '' : 's'} (committed: ${OLD[axis].length})`);
  console.log('  measured    span                 height           across  n  vs committed');
  for (const b of beams) {
    // nearest committed value, so the delta is per beam and not by index
    let near = null;
    for (const o of OLD[axis]) if (near === null || Math.abs(o - b.at) < Math.abs(near - b.at)) near = o;
    const d = near === null ? NaN : near - b.at;
    console.log(
      `  ${String(r1(b.at)).padStart(8)}  [${String(r1(b.from)).padStart(7)},${String(r1(b.to)).padStart(7)}]  ` +
      `[${String(r1(b.hLo)).padStart(6)},${String(r1(b.hHi)).padStart(6)}]  ${String(r1(b.across)).padStart(6)}  ${String(b.n).padStart(2)}  ` +
      `${near} (Δ ${d > 0 ? '+' : ''}${r1(d)})  ${b.materials.join(' ')}`,
    );
  }
  console.log(`  positions: [${beams.map((b) => Math.round(b.at)).join(', ')}]`);
}

