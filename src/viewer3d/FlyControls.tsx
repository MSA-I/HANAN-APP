/**
 * Lumion-exact navigation for the 3D viewer, matched to Lumion's official docs:
 * - W/A/S/D and the ARROW keys move (ground-projected), Q ascends, E descends
 * - Shift = fast, Space = very slow, Shift+Space = very fast
 * - RIGHT mouse drag = look around (FPS-style, eye stays put)
 * - O + right drag = orbit the camera around the look-at point
 * - Middle drag = pan (camera-controls truck; Shift/Space scale it too)
 * - Mouse WHEEL = move forwards/backwards along the view direction
 * - Ctrl+H = reset pitch to horizontal · double right-click = teleport there
 * - LEFT button moves nothing — it only selects (R3F object events)
 * Bound to PHYSICAL keys (event.code) so the Hebrew layout works. Keyboard
 * flight is active only in full-3D mode; mouse actions are canvas-scoped.
 *
 * The Canvas runs frameloop="demand": movement self-sustains by invalidating
 * every frame while a key is held, and stops costing anything on release.
 * The floor clamp (camera y ≥ 0.3m) lives centrally in CameraRig's guard.
 */
import { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type CameraControlsImpl from 'camera-controls'
import { Plane, Raycaster, Spherical, Vector2, Vector3 } from 'three'
import { isTypingTarget } from '../editor2d/useEditorShortcuts'
import { useOverlayStore } from '../editor2d/overlayStore'
import { useEditorStore } from '../state/store'

const BASE_SPEED = 4 // m/s — a brisk walk
const FAST_MULT = 3 // Shift ("fast")
const SLOW_MULT = 0.2 // Space ("very slowly")
const VERY_FAST_MULT = 6 // Shift+Space ("very fast")
const MAX_DT = 0.05 // clamp a frame step — a hitch slows motion, never teleports
const LOOK_SPEED = 0.003 // rad per px of right-drag (look and O-orbit)
const WHEEL_STEP = 1.5 // metres per wheel notch, before speed modifiers
const VIEW_PHI_MIN = 0.15 // don't let the view flip over the poles
const DBL_RMB_MS = 350 // double right-click window (teleport)
const DBL_RMB_PX = 6

interface HeldKeys {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  fast: boolean
  slow: boolean
}

// Lumion convention: arrows move like WASD, Q = up, E = down
const KEYMAP: Partial<Record<string, keyof HeldKeys>> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyQ: 'up',
  KeyE: 'down',
  ShiftLeft: 'fast',
  ShiftRight: 'fast',
  Space: 'slow',
}

const speedMult = (k: HeldKeys): number =>
  k.fast && k.slow ? VERY_FAST_MULT : k.fast ? FAST_MULT : k.slow ? SLOW_MULT : 1

const clearedKeys = (): HeldKeys => ({
  forward: false,
  back: false,
  left: false,
  right: false,
  up: false,
  down: false,
  fast: false,
  slow: false,
})

// scratch objects — no per-frame allocation
const _pos = new Vector3()
const _tgt = new Vector3()
const _dir = new Vector3()
const _sph = new Spherical()
const _ndc = new Vector2()
const _hit = new Vector3()
const _ray = new Raycaster()
const _floor = new Plane(new Vector3(0, 1, 0), 0)

export function FlyControls({ controlsRef }: { controlsRef: RefObject<CameraControlsImpl | null> }) {
  const keys = useRef<HeldKeys>(clearedKeys())
  // own clock: R3F's delta is seconds-long on the first frame after demand-mode idle
  const lastT = useRef<number | null>(null)
  const transitioning = useRef(false)
  // free-look drag state (clientX/Y deltas — movementX is unreliable for synthetic events)
  const look = useRef<{ x: number; y: number } | null>(null)
  const orbitHeld = useRef(false) // physical O — switches right-drag to orbit
  const lastRmb = useRef<{ t: number; x: number; y: number } | null>(null)
  const baseTruck = useRef<number | null>(null)
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const mode = useEditorStore((s) => s.mode)

  /** Freeze a running preset animation at its current pose so the user takes over. */
  const snapCancelTransition = () => {
    const c = controlsRef.current
    if (!c || !transitioning.current) return
    c.getPosition(_pos, false)
    c.getTarget(_tgt, false)
    void c.setLookAt(_pos.x, _pos.y, _pos.z, _tgt.x, _tgt.y, _tgt.z, false)
    transitioning.current = false
  }

  /**
   * Keyups can be EATEN — a native context menu (right-click outside the
   * canvas), an OS focus steal, a browser shortcut — leaving a key "held"
   * forever and the camera flying on its own. Hard-release everything on any
   * such signal; re-pressing costs the user nothing.
   */
  const releaseAll = () => {
    keys.current = clearedKeys()
    look.current = null
    orbitHeld.current = false
    updateTruckSpeed()
  }

  /** Shift (unlike letter keys) is queryable on every event — self-heal it. */
  const syncShift = (e: KeyboardEvent | PointerEvent | WheelEvent) => {
    const shift = e.getModifierState('Shift')
    if (keys.current.fast !== shift) {
      keys.current.fast = shift
      updateTruckSpeed()
    }
  }

  /** Lumion speed modifiers also scale middle-button panning. */
  const updateTruckSpeed = () => {
    const c = controlsRef.current
    if (!c) return
    baseTruck.current ??= c.truckSpeed
    c.truckSpeed = baseTruck.current * speedMult(keys.current)
  }

  /** Ctrl+H — keep eye and heading, level the view to the horizon. */
  const resetPitch = () => {
    const c = controlsRef.current
    if (!c) return
    snapCancelTransition()
    c.getPosition(_pos, false)
    c.getTarget(_tgt, false)
    _dir.subVectors(_tgt, _pos)
    const len = _dir.length()
    _sph.setFromVector3(_dir)
    _sph.phi = Math.PI / 2
    _dir.setFromSpherical(_sph).setLength(len)
    _tgt.copy(_pos).add(_dir)
    void c.setLookAt(_pos.x, _pos.y, _pos.z, _tgt.x, _tgt.y, _tgt.z, false)
    invalidate()
  }

  // window-level keyboard — the canvas itself never takes focus
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      syncShift(e)
      if (isTypingTarget(e)) return
      // O is tracked in every mode (it only matters during a canvas right-drag)
      if (e.code === 'KeyO') orbitHeld.current = true
      // panic stop — Esc always drops every held movement key
      if (e.code === 'Escape') {
        keys.current = clearedKeys()
        updateTruckSpeed()
      }
      if (useEditorStore.getState().mode !== '3d') return
      if (useOverlayStore.getState().helpOpen) return
      if (e.ctrlKey && e.code === 'KeyH') {
        e.preventDefault() // also blocks the browser's history shortcut
        resetPitch()
        return
      }
      const key = KEYMAP[e.code]
      if (!key) return
      // Space would re-trigger a focused chip / scroll; arrows would scroll the page
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
      const isMovement = key !== 'fast' && key !== 'slow'
      // never hijack browser/app combos (Shift is NOT bailed on — Shift+W = fast fly)
      if (isMovement && (e.ctrlKey || e.metaKey || e.altKey)) return
      keys.current[key] = true
      if (!isMovement) updateTruckSpeed()
      // a fresh movement press snap-cancels a running preset animation in place
      if (isMovement && !e.repeat) snapCancelTransition()
      invalidate() // kick the demand loop
    }
    // NO mode guards on keyup — keys must release even if focus/mode changed mid-hold
    const onKeyUp = (e: KeyboardEvent) => {
      syncShift(e)
      if (e.code === 'KeyO') orbitHeld.current = false
      const key = KEYMAP[e.code]
      if (!key) return
      keys.current[key] = false
      if (key === 'fast' || key === 'slow') updateTruckSpeed()
    }
    const onBlur = () => releaseAll()
    // tab switched / window minimized — blur doesn't always fire first
    const onVisibility = () => {
      if (document.hidden) releaseAll()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlsRef, invalidate])

  // the help dialog takes over the keyboard — stop flying when it opens
  const helpOpen = useOverlayStore((s) => s.helpOpen)
  useEffect(() => {
    if (helpOpen) releaseAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helpOpen])

  // Mouse on the canvas: RIGHT-drag look (or O-orbit), double right-click teleport,
  // wheel forwards/backwards. CameraRig maps right+wheel to ACTION.NONE for us.
  useEffect(() => {
    const el = gl.domElement

    /** Double right-click: jump the eye horizontally over the clicked floor point. */
    const teleport = (e: PointerEvent) => {
      const c = controlsRef.current
      if (!c) return
      const rect = el.getBoundingClientRect()
      _ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      _ray.setFromCamera(_ndc, camera)
      if (!_ray.ray.intersectPlane(_floor, _hit)) return // clicked the sky
      snapCancelTransition()
      c.getPosition(_pos, false)
      c.getTarget(_tgt, false)
      const dx = _hit.x - _pos.x
      const dz = _hit.z - _pos.z
      void c.setLookAt(_pos.x + dx, _pos.y, _pos.z + dz, _tgt.x + dx, _tgt.y, _tgt.z + dz, false)
      look.current = null
      invalidate()
    }

    const onPointerDown = (e: PointerEvent) => {
      syncShift(e)
      if (e.button !== 2) return
      const now = performance.now()
      const prev = lastRmb.current
      lastRmb.current = { t: now, x: e.clientX, y: e.clientY }
      if (
        prev &&
        now - prev.t < DBL_RMB_MS &&
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DBL_RMB_PX
      ) {
        lastRmb.current = null
        teleport(e)
        return
      }
      look.current = { x: e.clientX, y: e.clientY }
      el.setPointerCapture(e.pointerId)
      snapCancelTransition()
    }
    const onPointerMove = (e: PointerEvent) => {
      syncShift(e) // a stuck Shift heals on the very next mouse move
      const c = controlsRef.current
      if (!look.current || !c) return
      const dx = e.clientX - look.current.x
      const dy = e.clientY - look.current.y
      look.current = { x: e.clientX, y: e.clientY }
      if (!dx && !dy) return
      if (orbitHeld.current) {
        // Lumion "O + right mouse": orbit the camera around the look-at point
        void c.rotate(-dx * LOOK_SPEED, -dy * LOOK_SPEED, false)
        invalidate()
        return
      }
      // free look: rotate the view direction while the eye stays put
      c.getPosition(_pos, false)
      c.getTarget(_tgt, false)
      _dir.subVectors(_tgt, _pos)
      const len = _dir.length()
      _sph.setFromVector3(_dir)
      _sph.theta -= dx * LOOK_SPEED // drag right → look right
      _sph.phi = Math.min(Math.PI - VIEW_PHI_MIN, Math.max(VIEW_PHI_MIN, _sph.phi + dy * LOOK_SPEED)) // drag up → look up
      _dir.setFromSpherical(_sph).setLength(len)
      _tgt.copy(_pos).add(_dir)
      void c.setLookAt(_pos.x, _pos.y, _pos.z, _tgt.x, _tgt.y, _tgt.z, false)
      invalidate()
    }
    const onPointerEnd = (e: PointerEvent) => {
      if (e.button === 2 || e.type === 'pointercancel') look.current = null
    }
    // Lumion wheel: move forwards/backwards along the VIEW direction (not a
    // dolly toward the orbit target), scaled by the Shift/Space modifiers.
    const onWheel = (e: WheelEvent) => {
      syncShift(e)
      const c = controlsRef.current
      if (!c) return
      e.preventDefault()
      // Shift+wheel arrives as deltaX in Chromium; Firefox line-mode needs scaling
      const raw = e.deltaY !== 0 ? e.deltaY : e.deltaX
      const notches = (e.deltaMode === 1 ? raw * 33 : raw) / 100
      if (!notches) return
      snapCancelTransition()
      c.getPosition(_pos, false)
      c.getTarget(_tgt, false)
      _dir.subVectors(_tgt, _pos).normalize().multiplyScalar(-notches * WHEEL_STEP * speedMult(keys.current))
      _pos.add(_dir)
      _tgt.add(_dir)
      void c.setLookAt(_pos.x, _pos.y, _pos.z, _tgt.x, _tgt.y, _tgt.z, false)
      invalidate()
    }
    const onContextMenu = (e: Event) => e.preventDefault()
    // a NATIVE context menu (right-click on panels/toolbar — ours on the canvas
    // is suppressed) eats every keyup while it is open, sticking whatever is
    // held. Release proactively the moment one is about to open.
    const onNativeMenu = (e: MouseEvent) => {
      if (e.target === el) return
      releaseAll()
    }
    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('contextmenu', onNativeMenu)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('contextmenu', onNativeMenu)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, controlsRef, invalidate])

  // preset jumps animate via camera-controls transitions — while one runs, it wins.
  useEffect(() => {
    const c = controlsRef.current
    if (!c) return
    const start = () => {
      transitioning.current = true
    }
    const stop = () => {
      transitioning.current = false
    }
    c.addEventListener('transitionstart', start)
    c.addEventListener('rest', stop)
    c.addEventListener('sleep', stop)
    return () => {
      c.removeEventListener('transitionstart', start)
      c.removeEventListener('rest', stop)
      c.removeEventListener('sleep', stop)
    }
  }, [controlsRef])

  // leaving 3D releases everything
  useEffect(() => {
    if (mode !== '3d') {
      keys.current = clearedKeys()
      lastT.current = null
      updateTruckSpeed()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // priority -2: before drei's CameraControls update at -1, so a move renders same-frame
  useFrame(() => {
    const c = controlsRef.current
    const k = keys.current
    if (!c) return
    const moving = k.forward || k.back || k.left || k.right || k.up || k.down
    if (!moving || useEditorStore.getState().mode !== '3d') {
      lastT.current = null
      return
    }
    const now = performance.now()
    const dt = lastT.current === null ? 0 : Math.min((now - lastT.current) / 1000, MAX_DT)
    lastT.current = now
    if (transitioning.current) {
      invalidate() // keep ticking; held keys resume when the preset lands
      return
    }
    const speed = BASE_SPEED * speedMult(k)
    const fwd = (k.forward ? 1 : 0) - (k.back ? 1 : 0)
    const strafe = (k.right ? 1 : 0) - (k.left ? 1 : 0)
    const vert = (k.up ? 1 : 0) - (k.down ? 1 : 0)
    const norm = fwd !== 0 && strafe !== 0 ? Math.SQRT1_2 : 1
    // forward() is ground-projected (never changes altitude); all three move the
    // camera AND its target together, so the view direction is untouched
    if (fwd) void c.forward(fwd * speed * norm * dt, false)
    if (strafe) void c.truck(strafe * speed * norm * dt, 0, false)
    if (vert) void c.elevate(vert * speed * dt, false)
    invalidate() // self-sustain the demand loop
  }, -2)

  return null
}
