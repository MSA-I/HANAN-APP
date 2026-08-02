#!/usr/bin/env node
/**
 * glb-prep — asset-prep for HANAN-APP.
 *
 * Two modes, one pipeline (strip → transform → optimize → Draco):
 *   venue : SketchUp→SimLab GLB. Z-up→Y-up, strip SimLab extras (Camera/Ground),
 *           heavy optimize (target browser-ready). Trusts the model's existing
 *           origin placement (user positioned the floor corner at 0,0).
 *   prop  : Tripo furniture GLB (already Y-up). Rescale to real cm dimensions,
 *           drop base to Y=0 and centre X/Z, light optimize. Batch a folder.
 *
 * Units: output is in METRES (1 unit = 1 m), matching the venue GLB and the
 * app's three.js space (core/space.ts converts plan-cm → three-metres /100).
 * Scale targets are given in CM and converted here.
 *
 * Usage:
 *   node glb-prep.mjs <in.glb> <out.glb> [options]
 *   node glb-prep.mjs <inDir>  <outDir> --mode prop --height 92   (batch a folder)
 *
 * Options:
 *   --mode venue|prop        default: venue
 *   --source-up z|y          source up-axis. default: venue→z, prop→y
 *   --height  <cm>           prop: uniform-scale to this total height
 *   --diameter <cm>          prop: uniform-scale so max horizontal extent = cm (round tables)
 *   --footprint <WxD> [--fp-height <cm>]
 *                            prop: non-uniform to exact footprint W×D (cm); height kept or set
 *   --yaw <deg>              prop: rotate about Y (CCW seen from above) BEFORE scaling.
 *                            Tripo's yaw is arbitrary — use this to face the model the
 *                            app's way: a chair's backrest must end up at +Z (front −Z).
 *   --recenter               venue: also recentre floor corner to origin (default off — trusts placement)
 *   --no-textures            skip texture resize/compress (use if sharp is unavailable)
 *   --tex-size <px>          max texture edge. default 2048
 *   --draco / --no-draco     Draco geometry compression. default on
 *
 * ponytail: transform is applied on a single wrapper node and baked by flatten();
 *           good enough — these are static meshes, no skinning/animation to preserve.
 */
import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, extname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, flatten, join as joinMeshes, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const SQRT1_2 = Math.SQRT1_2;


function parseArgs(argv) {
  const a = { mode: 'venue', recenter: false, textures: true, texSize: 2048, draco: true };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--mode') a.mode = argv[++i];
    else if (t === '--source-up') a.sourceUp = argv[++i];
    else if (t === '--height') a.height = Number(argv[++i]);
    else if (t === '--diameter') a.diameter = Number(argv[++i]);
    else if (t === '--footprint') a.footprint = argv[++i];
    else if (t === '--fp-height') a.fpHeight = Number(argv[++i]);
    else if (t === '--yaw') a.yaw = Number(argv[++i]);
    else if (t === '--recenter') a.recenter = true;
    else if (t === '--no-textures') a.textures = false;
    else if (t === '--tex-size') a.texSize = Number(argv[++i]);
    else if (t === '--draco') a.draco = true;
    else if (t === '--no-draco') a.draco = false;
    else if (t === '--merge') a.merge = true;
    else pos.push(t);
  }
  a.input = pos[0];
  a.output = pos[1];
  // SimLab and Tripo both export glTF-standard Y-up. Only rotate if a source is
  // verified Z-up (pass --source-up z). Verified 2026-07-15: resort SimLab GLB is Y-up.
  if (!a.sourceUp) a.sourceUp = 'y';
  return a;
}

/** World-space AABB of the whole document, via each mesh primitive's POSITION min/max
 *  transformed by its node's world matrix. Version-proof (no reliance on a helper name).
 *
 *  ⚠ This is the box around the primitive's LOCAL box, put through the matrix — so it
 *  is exact only while every world matrix is axis-aligned (no rotation, or a multiple
 *  of 90°). Under any other rotation it is inflated, and its centre is R·c, the rotated
 *  centre of the box, not the centre of the rotated geometry. That is fine for what the
 *  scale stages ask of it (see step 4: they measure the model in ITS OWN axes, before
 *  any yaw) and wrong for anything that has to know where the geometry actually is —
 *  use `exactWorldBounds` there. */
function worldBounds(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix(); // 16, column-major
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const lo = pos.getMin([]);
      const hi = pos.getMax([]);
      // 8 corners of the local AABB
      for (let cx = 0; cx < 2; cx++)
        for (let cy = 0; cy < 2; cy++)
          for (let cz = 0; cz < 2; cz++) {
            const x = cx ? hi[0] : lo[0];
            const y = cy ? hi[1] : lo[1];
            const z = cz ? hi[2] : lo[2];
            const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
            const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
            const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
            if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
            if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
            if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
          }
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** World-space AABB of the GEOMETRY: every vertex through its node's world matrix,
 *  rather than the eight corners of a box the geometry merely sits inside.
 *
 *  ⛔ THE CENTRING MUST USE THIS ONE. Centring on `worldBounds` centres the ROTATED
 *  BOX, and a box's centre survives a rotation while the geometry inside it does not:
 *  the model lands off by R·c − c. Measured on the acrylic guest chair (`--yaw
 *  -153.08`, the library's steepest): x −0.229 cm, z +2.283 cm off centre, which
 *  `tools/topdown-prep.mjs` — it frames symmetrically about the origin, deliberately,
 *  so the plan image and the 2D footprint share a centre — turned into a plan image
 *  59.63 cm deep for a chair 53.90 cm deep. `--merge` (flatten) is off by default, so
 *  the world matrices are real and this cannot be skipped.
 *
 *  Cost is one pass over the positions — 68k vertices on that chair, 1.5M on the
 *  resort venue. Nothing next to Draco encoding, which runs on the same data. */
function exactWorldBounds(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const p = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix(); // 16, column-major
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const count = pos.getCount();
      for (let i = 0; i < count; i++) {
        pos.getElement(i, p); // getElement, not getArray: it denormalises for us
        const wx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
        const wy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
        const wz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
        if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
        if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
        if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
      }
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

const r3 = (n) => Math.round(n * 1000) / 1000;
const fmtV = (v) => `[${v.map(r3).join(', ')}]`;

async function processOne(io, inPath, outPath, a) {
  const beforeBytes = statSync(inPath).size;
  const doc = await io.read(inPath);
  const root = doc.getRoot();

  // 1. strip SimLab extras: all cameras + nodes named Ground / Camera-*.
  for (const cam of root.listCameras()) cam.dispose();
  for (const node of root.listNodes()) {
    const nm = node.getName();
    if (nm === 'Ground' || /^Camera[-\s]?\d*$/i.test(nm)) {
      // detach children first so we don't drop real geometry, then dispose the empty
      if (node.listChildren().length === 0) node.dispose();
    }
  }

  // 1b. strip ZONE_* marker faces — they exist only for tools/extract-zones.mjs
  // to read footprint/restricted data; they must never render in the app.
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (mat && mat.getName().startsWith('ZONE_')) {
        mesh.removePrimitive(prim);
        prim.dispose();
      }
    }
  }

  // 2. wrap every scene root under THREE nodes, so each transform acts in the frame
  // it is actually measured in:
  //   prep_rot   (innermost) — up-axis fix
  //   prep_scale             — scale, in the MODEL's own axes
  //   prep_root  (outermost) — yaw, then translation
  // Scale must happen BEFORE yaw: `--footprint W×D` is a statement about the model's
  // own width and depth, but bounds measured after a yaw are the rotated AABB, which
  // a non-right-angle yaw inflates (a 74° yaw made a 45cm chair come out 35cm). Scaling
  // in model axes and rotating afterwards also avoids shearing the mesh.
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const inner = doc.createNode('prep_rot');
  for (const child of scene.listChildren()) inner.addChild(child);
  const scaler = doc.createNode('prep_scale');
  scaler.addChild(inner);
  const wrapper = doc.createNode('prep_root');
  wrapper.addChild(scaler);
  scene.addChild(wrapper);

  // 3. up-axis: source z-up → y-up is a -90° rotation about X.
  if (a.sourceUp === 'z') inner.setRotation([-SQRT1_2, 0, 0, SQRT1_2]);

  let b = worldBounds(doc);
  console.log(`  bounds (m) after up-axis: size ${fmtV(b.size)}  min ${fmtV(b.min)}  max ${fmtV(b.max)}`);

  // 4. scale (prop) — targets are cm → metres.
  let scale = 1;
  if (a.mode === 'prop') {
    if (a.footprint) {
      const [w, d] = a.footprint.split('x').map(Number); // cm
      const horiz = [b.size[0], b.size[2]];
      const longIdx = horiz[0] >= horiz[1] ? 0 : 2;
      const shortIdx = longIdx === 0 ? 2 : 0;
      const sLong = (Math.max(w, d) / 100) / b.size[longIdx];
      const sShort = (Math.min(w, d) / 100) / b.size[shortIdx];
      const sy = a.fpHeight ? (a.fpHeight / 100) / b.size[1] : (sLong + sShort) / 2;
      const sv = [0, 0, 0];
      sv[longIdx] = sLong; sv[shortIdx] = sShort; sv[1] = sy;
      scaler.setScale([sv[0], sv[1], sv[2]]);
    } else if (a.diameter) {
      scale = (a.diameter / 100) / Math.max(b.size[0], b.size[2]);
      scaler.setScale([scale, scale, scale]);
    } else if (a.height) {
      scale = (a.height / 100) / b.size[1];
      scaler.setScale([scale, scale, scale]);
    }
    b = worldBounds(doc);
  }

  // 4b. yaw about Y — AFTER scaling, so `--footprint` meant the model's own W×D.
  // The line printed here is the REAL size of the yawed model, so it can be read
  // straight into a catalog entry; the scale above deliberately did not use it.
  if (a.yaw) {
    const h = (a.yaw * Math.PI) / 360; // half-angle, degrees→radians
    wrapper.setRotation([0, Math.sin(h), 0, Math.cos(h)]);
    console.log(`  bounds (m) after yaw ${a.yaw}°: size ${fmtV(exactWorldBounds(doc).size)}`);
  }

  // 5. recentre. prop: base to Y=0, centre X/Z. venue: only if --recenter (trusts placement otherwise).
  // ⛔ MEASURED EXACTLY, not from `b`: `b` is the model-axis box the scale stages
  // needed, and after a yaw that is not a multiple of 90° its centre is not the
  // model's centre. See `exactWorldBounds`.
  if (a.mode === 'prop' || a.recenter) {
    const e = exactWorldBounds(doc);
    const cx = (e.min[0] + e.max[0]) / 2;
    const cz = (e.min[2] + e.max[2]) / 2;
    const t = wrapper.getTranslation();
    if (a.mode === 'prop') {
      wrapper.setTranslation([t[0] - cx, t[1] - e.min[1], t[2] - cz]); // centre X/Z, base→0
    } else {
      wrapper.setTranslation([t[0] - e.min[0], t[1] - e.min[1], t[2] - e.min[2]]); // corner→0
    }
  }

  // 6. optimise. dedup/prune/weld are safe. flatten()+join() cut draw calls but
  // ponytail: OFF by default — they mis-bake nested cm/m scales in the SimLab export
  // (verified: they inflated the resort bbox 13m→28m). Opt in with --merge only on
  // models without instanced/nested-scale geometry. Node-count/draw-call reduction,
  // if needed, is better done at load in three (mergeGeometries) than risking geometry here.
  const steps = [dedup(), prune(), weld()];
  if (a.merge) steps.push(flatten(), joinMeshes());
  if (a.textures) {
    try {
      const sharp = (await import('sharp')).default;
      steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [a.texSize, a.texSize] }));
    } catch {
      console.warn('  ! sharp unavailable — skipping texture compression');
    }
  }
  await doc.transform(...steps);

  // 7. Draco geometry compression.
  if (a.draco) {
    doc.createExtension(KHRDracoMeshCompression)
      .setRequired(true)
      .setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER });
  }

  await io.write(outPath, doc);

  const afterBytes = statSync(outPath).size;
  // read back and measure the GEOMETRY — this line is what gets catalogued, and the
  // corner box lies about a yawed model (it said 83.0 × 83.4 for a 46.3 × 53.9 chair).
  const fb = exactWorldBounds(await io.read(outPath));
  const mb = (n) => (n / 1048576).toFixed(1);
  console.log(`  size: ${mb(beforeBytes)}MB → ${mb(afterBytes)}MB  (${Math.round((1 - afterBytes / beforeBytes) * 100)}% smaller)`);
  console.log(`  final bounds (m): size ${fmtV(fb.size)}  min ${fmtV(fb.min)}  max ${fmtV(fb.max)}`);

  // self-check: finite, non-empty, Y is a sane "up" (height > 0). Fails loudly if the transform broke.
  const bad = fb.size.some((s) => !Number.isFinite(s) || s <= 0) || fb.size[1] <= 0;
  if (bad) throw new Error(`sanity check failed — degenerate bounds ${fmtV(fb.size)}`);
  if (a.mode === 'prop' && Math.abs(fb.min[1]) > 0.02) throw new Error(`prop base not at Y=0 (min.y=${r3(fb.min[1])})`);

  return { beforeBytes, afterBytes, bounds: fb };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.input || !a.output) {
    console.error('usage: node glb-prep.mjs <in.glb|inDir> <out.glb|outDir> [--mode venue|prop] [--height cm] ...');
    process.exit(2);
  }

  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule(),
      'draco3d.decoder': await draco3d.createDecoderModule(),
    });

  const isDir = existsSync(a.input) && statSync(a.input).isDirectory();
  if (isDir) {
    if (!existsSync(a.output)) mkdirSync(a.output, { recursive: true });
    const files = readdirSync(a.input).filter((f) => extname(f).toLowerCase() === '.glb');
    console.log(`batch: ${files.length} GLB in ${a.input} (mode=${a.mode})`);
    for (const f of files) {
      console.log(`\n• ${f}`);
      await processOne(io, join(a.input, f), join(a.output, f), a);
    }
  } else {
    console.log(`${basename(a.input)} (mode=${a.mode})`);
    await processOne(io, a.input, a.output, a);
  }
  console.log('\ndone.');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
