#!/usr/bin/env node
/**
 * suggest-yaw — which `--yaw` does this Tripo prop need?
 *
 * Tripo exports at an arbitrary Y-rotation, and the app's convention is fixed:
 * a chair's BACKREST must sit at +Z (so the seat faces −Z = −y in plan). Getting
 * this wrong rotates every chair around its table by a quarter turn, which is
 * obvious in a render and invisible in a bbox — so guessing per model by eye is
 * how you ship five wrong chairs.
 *
 * Heuristic: on a chair, the mass ABOVE seat height is the backrest. Take the
 * centroid of that mass (weighted by vertex count), and the yaw that carries it
 * onto +Z is `-atan2(cx, cz)`. Rotation about +Y by `a` maps
 * (x,z) → (x·cos a + z·sin a, −x·sin a + z·cos a), i.e. it ADDS `a` to the angle
 * measured from +Z toward +X — hence the negation.
 *
 * Prints the raw numbers too: eyeball them. A confident answer needs the backrest
 * to be clearly off-centre; a centred blob (round table, vase) means "no yaw
 * needed" and prints as such rather than a random angle from float noise.
 *
 *   node suggest-yaw.mjs <in.glb> [--split 0.55]   # split = seat height, fraction of total
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const args = process.argv.slice(2);
const inPath = args[0];
const splitAt = Number(args[args.indexOf('--split') + 1]) || 0.55;
if (!inPath) {
  console.error('usage: node suggest-yaw.mjs <in.glb> [--split 0.55]');
  process.exit(2);
}

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

const doc = await io.read(inPath);

// Pass 1: world-space vertices (positions only — enough to locate mass).
const verts = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const v = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      verts.push([
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
      ]);
    }
  }
}
if (!verts.length) { console.error('no vertices'); process.exit(1); }

const ys = verts.map((v) => v[1]);
const yMin = Math.min(...ys), yMax = Math.max(...ys);
const cut = yMin + (yMax - yMin) * splitAt;

// Centroid of the whole prop, and of the mass above the seat line.
const mean = (rows, i) => rows.reduce((s, v) => s + v[i], 0) / rows.length;
const upper = verts.filter((v) => v[1] > cut);
if (upper.length < 20) { console.error('too little geometry above the split — is this a chair?'); process.exit(1); }

const allX = mean(verts, 0), allZ = mean(verts, 2);
const upX = mean(upper, 0) - allX; // relative to the prop's own centre
const upZ = mean(upper, 2) - allZ;

const span = Math.max(
  Math.max(...verts.map((v) => v[0])) - Math.min(...verts.map((v) => v[0])),
  Math.max(...verts.map((v) => v[2])) - Math.min(...verts.map((v) => v[2])),
);
const offset = Math.hypot(upX, upZ);
const yaw = -Math.atan2(upX, upZ) * (180 / Math.PI);
const r2 = (n) => Math.round(n * 100) / 100;

console.log(`vertices           : ${verts.length}  (${upper.length} above seat line)`);
console.log(`height             : ${r2(yMin)} … ${r2(yMax)}   seat line at y=${r2(cut)} (${splitAt})`);
console.log(`backrest offset    : x=${r2(upX)}  z=${r2(upZ)}   |offset|=${r2(offset)}  (prop span ${r2(span)})`);

if (offset < span * 0.04) {
  console.log(`\n→ backrest is centred (offset < 4% of span): RADIALLY SYMMETRIC — no --yaw needed.`);
} else {
  const snapped = Math.round(yaw / 90) * 90;
  const off = Math.abs(yaw - snapped);
  console.log(`\n→ suggested: --yaw ${r2(yaw)}` + (off < 8 ? `   (snap to --yaw ${((snapped % 360) + 360) % 360})` : `   ⚠ not near a right angle — check the model`));
}
