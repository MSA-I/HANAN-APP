/**
 * Per-mode render tuning for the outdoor lighting presets. Viewer concern —
 * the scene stores only LightingSettings (mode + sun); everything here is how
 * the viewer interprets a mode. Kept import-free (data only) so the inspector
 * can read canonical sun values without pulling three.js into the main bundle.
 *
 * `sunset` must reproduce the pre-v5 hardcoded render exactly (0.9 sun / 0.2
 * hemisphere / 0.65 env / 0.9 exposure / #f6f5f2 backdrop) — its azimuth and
 * elevation are the spherical decomposition of the old fixed sun vector.
 *
 * `night` works by dimming: the env photo is golden hour and never visible
 * (only reflections), so a cool faint sun + dark blue backdrop reads as night
 * without a second env image. If it ever reads as merely "underexposed", the
 * escalation is a real night equirect via tools/glb-prep/env-prep.mjs.
 */
import type { LightingMode } from '../core/model/types'

export interface LightingModeDef {
  sun: { color: string; azimuth: number; elevation: number; intensity: number }
  hemisphere: { sky: string; ground: string; intensity: number }
  envIntensity: number
  exposure: number
  /** canvas clear colour behind the hall */
  background: string
}

export const LIGHTING_MODES: Record<LightingMode, LightingModeDef> = {
  day: {
    sun: { color: '#fff6e8', azimuth: 50.6, elevation: 66, intensity: 1.4 },
    hemisphere: { sky: '#ffffff', ground: '#d8d2c8', intensity: 0.35 },
    envIntensity: 0.8,
    exposure: 1.0,
    background: '#eef3f7',
  },
  sunset: {
    sun: { color: '#ffffff', azimuth: 50.6, elevation: 65.6, intensity: 0.9 },
    hemisphere: { sky: '#ffffff', ground: '#d8d2c8', intensity: 0.2 },
    envIntensity: 0.65,
    exposure: 0.9,
    background: '#f6f5f2',
  },
  night: {
    sun: { color: '#8fa3c8', azimuth: 50.6, elevation: 35, intensity: 0.06 },
    hemisphere: { sky: '#2a3550', ground: '#141821', intensity: 0.07 },
    envIntensity: 0.1,
    exposure: 0.7,
    background: '#0e1420',
  },
}
