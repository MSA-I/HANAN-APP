/**
 * PLAN-05 C3 — which placed objects the camera can actually SEE, measured on the
 * GPU at export time.
 *
 * > "יש זוויות שלא רואים את הרקע או את האלמנטים ולכן ההחלטה לצרף רפרנסים שלא
 * > נמצאים בתמונה נורא מבלבלת את המודל של התמונות צריך שסוכן יסתכל וישווה בין
 * > אלמנטים שקיימים לאותה זווית ולאלמנטים שלא קיימים ואז יחליט אילו רפרנסים
 * > לצרף"
 *
 * THE METHOD: render the frame, hide one object, render it again, and count the
 * pixels that changed. That count IS the answer to "how much of the picture we
 * are sending does this object occupy", which is the question the slot budget
 * needs answered.
 *
 * WHY THE DIFFERENCE AND NOT AN ID-COLOUR PASS. Flat id colours need
 * `scene.overrideMaterial` or a material swap, and both throw away alpha,
 * transparency and instancing. The planters are alpha-cut leaves on crossed
 * planes, the railings are glass, the chairs are an InstancedMesh — an id pass
 * turns all three into solid blocks and reports a plant as occluding whatever is
 * behind it. That is the very error this exists to remove. The difference is
 * taken on the REAL render, so alpha, transparency, ContactShadows, the mirrored
 * clusters and the instanced chairs are all correct for free, and occlusion by
 * the venue GLB — the whole point — needs no special case at all.
 *
 * WHY NOT CPU RAYCASTING. It needs a CPU copy of a 63 MB venue's geometry plus a
 * BVH (a new dependency), and it gets foliage wrong in exactly the way above.
 *
 * ⚠ THE ASPECT RATIO IS PART OF THE MEASUREMENT. The pass runs at the capture's
 * own aspect (CAPTURE_SIZE, 1536/1024 = 1.5), just scaled down. Measuring a
 * differently-shaped frame would answer a question about a picture nobody is
 * sending — a silent, invisible wrong answer.
 *
 * COST: (N+1) renders at 384×256 plus N readbacks. At N=20 that is ~8 MB moved
 * and 50–150 ms per angle, once, inside an export that already waits up to 60
 * frames for the camera to settle.
 */
import type { Camera, Object3D, Scene, WebGLRenderer } from 'three'
import { LinearFilter, RGBAFormat, UnsignedByteType, WebGLRenderTarget } from 'three'
import { coverageFrom, diffCount } from '../core/prompts/coverage'
import { CAPTURE_SIZE, type Coverage } from '../core/prompts/refs'

/**
 * Measuring resolution. Small on purpose — this counts pixels, it does not look
 * at them, and every object costs one full render plus one readback.
 *
 * 384×256 keeps the capture's 1.5 aspect exactly and is one sixteenth of its
 * area, so a fraction measured here means the same fraction there. It cannot go
 * much lower: MIN_COVERAGE_FRACTION is ~10 pixels at this size, and below ~200×
 * wide the threshold would land under a single pixel and stop discriminating.
 */
const MEASURE_WIDTH = 384
const MEASURE_HEIGHT = Math.round(
  (MEASURE_WIDTH * CAPTURE_SIZE.height) / CAPTURE_SIZE.width,
)

/** Every tagged object in the tree, by the id `ObjectGroup` stamped on it. */
function taggedObjects(scene: Scene): Map<string, Object3D[]> {
  const found = new Map<string, Object3D[]>()
  scene.traverse((node) => {
    const id = node.userData?.objectId
    if (typeof id !== 'string' || !id) return
    const list = found.get(id)
    if (list) list.push(node)
    else found.set(id, [node])
  })
  return found
}

/**
 * Render `scene` into `target` and read it back.
 *
 * The camera's aspect is the CAPTURE's, not the target's, and the two are equal
 * by construction — see the file header. It is set by the caller once, around
 * the whole measurement, rather than per render.
 */
function renderInto(
  gl: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  target: WebGLRenderTarget,
  buffer: Uint8Array,
): void {
  gl.setRenderTarget(target)
  gl.clear()
  gl.render(scene, camera)
  gl.readRenderTargetPixels(target, 0, 0, target.width, target.height, buffer)
}

/**
 * Share of the frame each tagged object occupies, 0..1, keyed by object id.
 *
 * Returns `undefined` when there is nothing to measure — no tagged objects, or a
 * renderer that will not give a context. `undefined` is the documented "nobody
 * measured" state that leaves the frustum in charge, so failing this way is
 * always safe and never silently empties an export.
 *
 * ⚠ Everything it touches is restored in `finally`: the render target, the
 * camera's aspect, and every object's `visible` flag. This runs on the LIVE
 * scene the user is looking at — leaving an object hidden would be worse than
 * any wrong reference.
 */
export function measureCoverage(gl: WebGLRenderer, scene: Scene, camera: Camera): Coverage | undefined {
  const tagged = taggedObjects(scene)
  if (!tagged.size) return undefined

  const target = new WebGLRenderTarget(MEASURE_WIDTH, MEASURE_HEIGHT, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  })
  const totalPixels = MEASURE_WIDTH * MEASURE_HEIGHT
  const base = new Uint8Array(totalPixels * 4)
  const probe = new Uint8Array(totalPixels * 4)
  const previousTarget = gl.getRenderTarget()

  try {
    renderInto(gl, scene, camera, target, base)

    const counts: Record<string, number> = {}
    for (const [id, nodes] of tagged) {
      const was = nodes.map((n) => n.visible)
      // an object already hidden contributes nothing and cannot be "hidden more"
      if (was.every((v) => !v)) {
        counts[id] = 0
        continue
      }
      for (const n of nodes) n.visible = false
      try {
        renderInto(gl, scene, camera, target, probe)
        counts[id] = diffCount(base, probe)
      } finally {
        nodes.forEach((n, i) => (n.visible = was[i]))
      }
    }
    return coverageFrom(counts, totalPixels)
  } catch {
    // A lost context or a refused readback must not cost the user the export.
    // undefined = "nobody measured", and the frustum answers as it always did.
    return undefined
  } finally {
    gl.setRenderTarget(previousTarget)
    target.dispose()
  }
}
