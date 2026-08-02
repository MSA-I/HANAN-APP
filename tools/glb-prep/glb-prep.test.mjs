#!/usr/bin/env node
/**
 * glb-prep's centring, on synthetic input — the one thing in this tool that can be
 * wrong by centimetres and leave a file that looks perfectly healthy.
 *
 *   node tools/glb-prep/glb-prep.test.mjs
 *
 * ## Why the fixture is a TRIANGLE and not a box
 *
 * The bug is that centring used the box AROUND the rotated box instead of the box
 * around the rotated GEOMETRY. A solid box cannot show it: its corners ARE its
 * geometry, so the two boxes coincide at every angle and the test would pass
 * against the broken code. The fixture has to be geometry that does not fill its
 * own AABB — a right triangle is the smallest such thing — and a yaw that is not a
 * multiple of 90°, because at right angles the two boxes coincide again. That
 * combination is not hypothetical: it is `chair-chuppah-guest.glb` (--yaw -153.08),
 * which shipped 2.28 cm off centre, and `chair-black.glb` (--yaw 75).
 *
 * The last assertion of each case is the one that keeps the test honest: it checks
 * that the two measurements really DO disagree on this fixture, so a future edit
 * cannot make the test vacuous by accident.
 *
 * ## Why --no-draco --no-textures
 *
 * Both are compression, downstream of every transform under test, and both add
 * noise to a millimetre assertion (Draco quantises positions) plus a sharp/wasm
 * load to a test that should be instant. What is under test is steps 3-5.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Document, NodeIO } from '@gltf-transform/core';

const TOOL = fileURLToPath(new URL('./glb-prep.mjs', import.meta.url));
const DIR = fileURLToPath(new URL('../../.tmp/glb-prep-test/', import.meta.url));

const io = new NodeIO();

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
  if (!ok) failures++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/**
 * A right triangle standing 0.9 m tall in a 0.4 × 0.6 footprint, deliberately
 * asymmetric inside its own bounding box. Local AABB centre in xz is (0, 0), so a
 * centring that trusts the box thinks the model is already centred at every angle.
 */
function writeFixture(path) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(
      new Float32Array([
        -0.2, 0.0, -0.3, //
        0.2, 0.0, -0.3,
        -0.2, 0.9, 0.3,
      ]),
    )
    .setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setMaterial(doc.createMaterial('fixture'));
  const mesh = doc.createMesh('tri').addPrimitive(prim);
  const node = doc.createNode('tri').setMesh(mesh);
  doc.createScene().addChild(node);
  return io.write(path, doc);
}

/** Bounds of the GEOMETRY: every vertex through its node's world matrix. */
function exactBounds(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const p = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, p);
        const w = [
          m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
          m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
          m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
        ];
        for (let k = 0; k < 3; k++) {
          if (w[k] < min[k]) min[k] = w[k];
          if (w[k] > max[k]) max[k] = w[k];
        }
      }
    }
  }
  return { min, max };
}

/** Bounds the old code produced: the eight corners of each local AABB, transformed. */
function cornerBounds(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const lo = pos.getMin([]);
      const hi = pos.getMax([]);
      for (let c = 0; c < 8; c++) {
        const x = c & 1 ? hi[0] : lo[0];
        const y = c & 2 ? hi[1] : lo[1];
        const z = c & 4 ? hi[2] : lo[2];
        const w = [
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ];
        for (let k = 0; k < 3; k++) {
          if (w[k] < min[k]) min[k] = w[k];
          if (w[k] > max[k]) max[k] = w[k];
        }
      }
    }
  }
  return { min, max };
}

const mid = (b, k) => (b.min[k] + b.max[k]) / 2;
const cm = (m) => `${(m * 100).toFixed(3)} cm`;

async function run(label, yaw, { expectDisagreement }) {
  console.log(`\n${label}`);
  const inPath = `${DIR}in.glb`;
  const outPath = `${DIR}out-${String(yaw).replace('.', '_').replace('-', 'm')}.glb`;
  await writeFixture(inPath);
  execFileSync(
    process.execPath,
    [TOOL, inPath, outPath, '--mode', 'prop', '--height', '90', '--yaw', String(yaw), '--no-draco', '--no-textures'],
    { stdio: 'pipe' },
  );

  const out = await io.read(outPath);
  const e = exactBounds(out);
  const c = cornerBounds(out);

  // 1 µm. The transform is float32 arithmetic on three vertices; anything the fix
  // is about is four orders of magnitude larger than this.
  const TOL = 1e-6;
  check('geometry is centred on X', near(mid(e, 0), 0, TOL), `x centre ${cm(mid(e, 0))}`);
  check('geometry is centred on Z', near(mid(e, 2), 0, TOL), `z centre ${cm(mid(e, 2))}`);
  check('base sits on Y = 0', near(e.min[1], 0, TOL), `min y ${cm(e.min[1])}`);
  check('height survived the yaw', near(e.max[1] - e.min[1], 0.9, 1e-5), `${cm(e.max[1] - e.min[1])}`);

  // the guard: on a non-right-angle yaw the corner box must MISS the centre, which
  // is exactly the error the old centring committed. At a right angle it must not.
  const drift = Math.hypot(mid(c, 0) - mid(e, 0), mid(c, 2) - mid(e, 2));
  check(
    expectDisagreement
      ? 'the corner box really does disagree here (so this test can bite)'
      : 'at a right angle the two measurements agree',
    expectDisagreement ? drift > 0.1 : drift < TOL,
    `corner-vs-geometry drift ${cm(drift)}`,
  );
}

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

await run('yaw 37° — not a multiple of 90°, the case that was broken', 37, { expectDisagreement: true });
await run('yaw -153.08° — the acrylic guest chair’s own angle', -153.08, { expectDisagreement: true });
await run('yaw 90° — the control: every other prop in the library', 90, { expectDisagreement: false });

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
