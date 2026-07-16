#!/usr/bin/env node
/**
 * List glTF cameras in a GLB — position, look-at target and vertical FOV, in the
 * model's raw frame. Used to check whether SketchUp Scenes survived SKP→SimLab
 * conversion as cameras we can turn into sealed venue angles.
 *
 *   node inspect-cameras.mjs <in.glb>
 */
import { NodeIO } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const inPath = process.argv[2]
if (!inPath) { console.error('usage: node inspect-cameras.mjs <in.glb>'); process.exit(2) }

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  })

const doc = await io.read(inPath)
const root = doc.getRoot()
const cams = root.listCameras()
console.log(`cameras: ${cams.length}`)

const r = (n) => Math.round(n * 100) / 100
// find the node that references each camera, read its world matrix
const camNode = new Map()
for (const node of root.listNodes()) {
  const c = node.getCamera()
  if (c) camNode.set(c, node)
}
for (const cam of cams) {
  const node = camNode.get(cam)
  const nm = node ? node.getName() : '(no node)'
  let pos = null, target = null, up = null, yfov = null
  if (cam.getType() === 'perspective') yfov = cam.getYFov()
  if (node) {
    const m = node.getWorldMatrix()
    pos = [m[12], m[13], m[14]]
    // camera looks down -Z of its local frame
    const fwd = [-m[8], -m[9], -m[10]]
    up = [m[4], m[5], m[6]]
    const len = Math.hypot(...fwd) || 1
    target = [pos[0] + fwd[0] / len * 5, pos[1] + fwd[1] / len * 5, pos[2] + fwd[2] / len * 5]
  }
  console.log(`\n• camera "${cam.getName() || '(unnamed)'}" node="${nm}" type=${cam.getType()}`)
  if (yfov != null) console.log(`  yfov: ${r((yfov * 180) / Math.PI)}°`)
  if (pos) console.log(`  position (m): [${pos.map(r).join(', ')}]`)
  if (target) console.log(`  look-at (m): [${target.map(r).join(', ')}]`)
  if (up) console.log(`  up: [${up.map(r).join(', ')}]`)
}
