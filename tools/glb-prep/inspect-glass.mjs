#!/usr/bin/env node
/**
 * Which materials in a GLB declare themselves as GLASS?
 *
 * Written for PLAN-05 item 28. The re-segmented place setting arrives with 82
 * materials all named `Material_tripo_part_<n>`, so the name says nothing — but the
 * file itself carries KHR_materials_transmission / _volume / _ior on the parts the
 * author meant to be transparent. That declaration is evidence, not a guess, and it
 * is what tells the app which slot is "the glasses".
 *
 * Reads the raw JSON chunk of the .glb rather than going through @gltf-transform,
 * because the extensions are exactly what an unregistered reader drops.
 *
 *   node inspect-glass.mjs <in.glb>
 */
import { readFileSync } from 'node:fs';

const inPath = process.argv[2];
if (!inPath) { console.error('usage: node inspect-glass.mjs <in.glb>'); process.exit(2); }

const buf = readFileSync(inPath);
if (buf.readUInt32LE(0) !== 0x46546c67) { console.error('not a .glb'); process.exit(2); }
let off = 12, json = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  if (type === 0x4e4f534a) { json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString('utf8')); break; }
  off += 8 + len + ((4 - (len % 4)) % 4);
}
if (!json) { console.error('no JSON chunk'); process.exit(2); }

console.log(`extensionsUsed: ${JSON.stringify(json.extensionsUsed ?? [])}`);
console.log(`materials: ${json.materials?.length ?? 0}\n`);

const GLASSY = ['KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_ior', 'KHR_materials_specular'];
const rows = [];
for (const [i, m] of (json.materials ?? []).entries()) {
  const ext = m.extensions ?? {};
  const flags = GLASSY.filter((k) => k in ext);
  const pbr = m.pbrMetallicRoughness ?? {};
  rows.push({
    i,
    name: m.name ?? '(unnamed)',
    alphaMode: m.alphaMode ?? 'OPAQUE',
    baseAlpha: Array.isArray(pbr.baseColorFactor) ? pbr.baseColorFactor[3] : 1,
    metallic: pbr.metallicFactor ?? 1,
    rough: pbr.roughnessFactor ?? 1,
    transmission: ext.KHR_materials_transmission?.transmissionFactor ?? 0,
    thickness: ext.KHR_materials_volume?.thicknessFactor ?? 0,
    ior: ext.KHR_materials_ior?.ior ?? null,
    flags,
  });
}

const glass = rows.filter((r) => r.transmission > 0 || r.thickness > 0 || r.alphaMode !== 'OPAQUE' || r.baseAlpha < 1);
console.log(`--- materials that declare transparency (${glass.length} of ${rows.length}) ---`);
console.log('idx  name                              alpha    a   metal  rough  transm  thick  ior   ext');
for (const r of glass) {
  console.log(
    `${String(r.i).padStart(3)}  ${r.name.padEnd(32)} ${r.alphaMode.padEnd(7)} ${String(r.baseAlpha).padStart(4)}  ` +
    `${String(r.metallic).padStart(5)}  ${String(r.rough).padStart(5)}  ${String(r.transmission).padStart(6)}  ` +
    `${String(r.thickness).padStart(5)}  ${String(r.ior ?? '-').padStart(4)}  ${r.flags.join(',')}`,
  );
}

// metallic parts, for the "swap the metal for glass" half of the request
const metal = rows.filter((r) => r.metallic >= 0.5 && !glass.includes(r));
console.log(`\n--- materials with metallicFactor >= 0.5 (${metal.length} of ${rows.length}) ---`);
for (const r of metal) {
  console.log(`${String(r.i).padStart(3)}  ${r.name.padEnd(32)} metal=${r.metallic} rough=${r.rough}`);
}
