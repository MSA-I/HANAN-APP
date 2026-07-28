/**
 * One prompt template per sealed camera angle (PLAN-08 §44).
 *
 * ⛔ HOW THESE WERE WRITTEN, AND HOW THEY MUST BE CHANGED.
 *
 * Every `base` below was written while LOOKING AT that angle rendered from the
 * venue pack — never from the camera numbers, and never from the other angles.
 * The captures are kept at `HANAN-APP-DOCS/Plans/handoff/08-angles/<id>.png`
 * (2026-07-28, empty hall, `resort` pack), next to `shoot-angles.mjs`, the
 * puppeteer harness that took them.
 *
 * An angle description written from a guess is a wrong prompt, and the prompt is
 * the entire product — so if a camera moves or the venue GLB is re-imported,
 * RE-SHOOT THE ANGLE AND READ IT before touching the text.
 *
 * The ids are the venue pack's own (`venuePacks.ts` cameras): 's1'–'s5' for the
 * hall and 'k1'/'k2' for the raised reception deck. PLAN-08 called the last two
 * 'kp1'/'kp2'; PLAN-07 shipped them as 'k1'/'k2' and the pack is the authority.
 *
 * Language is English (gate 4): image models are trained overwhelmingly on
 * English captions. None of this text reaches the UI, so it is not a
 * strings.ts concern.
 */

export interface AngleTemplate {
  /** matches SealedCamera.id in venuePacks.ts */
  cameraId: string
  /** the viewpoint and the architecture that is actually in this frame */
  base: string
  /** what this angle is FOR — the things a render from here has to get right */
  emphasis: string[]
  /** angle-specific exclusions, appended after the shared ones */
  negative?: string
}

/**
 * The building, as it reads in all five hall angles. Repeated per-angle prose
 * would drift apart on the first edit; the differences live in `base`.
 */
const HALL_SHELL =
  'The venue is a large open resort banquet hall, roughly 44 by 25 metres, ' +
  '11.6 metres to the underside of the roof. Its architecture is fixed and must not be redesigned: ' +
  'an exposed open-web timber and steel truss roof; a rectangular black lighting truss slung beneath it ' +
  'carrying regular rows of black moving-head spotlights; square plastered columns in a colonnade with ' +
  'full-height glazing between them; a deep oxblood-red beam running horizontally at column-head height; ' +
  'a feature wall of tall maroon louvered slat panels hung in front of terracotta perforated-brick screens; ' +
  'and a floor of pale sand-coloured large-format stone inlaid with darker geometric chevron banding that ' +
  'divides it into big square panels.'

/**
 * Constraints that apply to every angle. Kept out of the per-angle text.
 *
 * The last two sentences are §25 — "the image has to be realistic and not look
 * like an SKP or CGI". SHARED_DIRECTION already ASKS for a photograph; what was
 * missing is the refusal, and in these models a negation carries further than
 * the matching positive. Everything named is a specific way the supplied capture
 * can bleed through into the render, because the capture IS a viewport
 * screenshot of a SketchUp-derived model.
 */
export const SHARED_NEGATIVE =
  'Do not add people, text, watermarks, logos or signage. ' +
  'Do not add furniture, decor or lighting fixtures that are not listed above. ' +
  'Do not alter the building itself — no new walls, windows, columns or ceiling. ' +
  'Do not move the camera, change the framing, or change the time of day. ' +
  'This is not a SketchUp export, not CGI, not a 3D render, not a clay or grey-shaded render ' +
  'and not a viewport screenshot. ' +
  'No model outlines, no wireframe or silhouette edges, no flat untextured materials — every ' +
  'surface carries real material texture, and the light is photographed light.'

/**
 * §23–24: what the landscape reference IS, and what the render has to do with
 * it. Kept apart from the per-angle text because the reference is fixed for
 * every angle, and apart from SHARED_DIRECTION because it is about one image
 * rather than about the rendering.
 *
 * The deck angles are named here rather than in k1/k2's own `base`: on those two
 * the landscape is not a view through a window, it is most of the frame, and the
 * templates were written before there was a photograph of it to point at.
 */
export const SHARED_BACKGROUND =
  'The landscape reference is a photograph of the real site this venue stands on. ' +
  'Everything visible past the building is that landscape: take the horizon line, the terrain, ' +
  'the planting and the sky from it. The full-height glazing between the columns, and every ' +
  'other opening, must show that view rather than a blank, a glare or an invented one; on the ' +
  'raised reception deck the whole space beyond the parapet is that same landscape and sky. ' +
  'Take no building, structure, furniture or planting arrangement from that reference — only ' +
  'the setting, and only at the depth the frame puts it.'

/**
 * Rendering instruction shared by every angle, kept separate from the negative
 * so the composed prompt reads as: describe, then constrain, then instruct.
 */
export const SHARED_DIRECTION =
  'Produce a photorealistic architectural interior photograph. Keep the exact camera position, ' +
  'framing and perspective of the supplied capture; the capture defines the geometry and the layout, ' +
  'and your task is to render it as a real photograph of a dressed venue.'

const TEMPLATES: AngleTemplate[] = [
  {
    cameraId: 's1',
    base:
      `${HALL_SHELL} ` +
      'This angle stands at eye level, 1.8 metres up, in the western corner of the hall and looks ' +
      'diagonally across it toward the far end, so the full length of the room recedes away from the ' +
      'viewer. The truss roof and its ranks of black spotlights fill the top third of the frame. Across ' +
      'the middle sits the far wall: a two-storey element with a glazed clerestory strip over a woven ' +
      'perforated screen, terracotta brick panelling with maroon lintels above recessed doorways, and a ' +
      'large black screen panel. Along the right the glazed colonnade admits strong daylight, with the ' +
      'oxblood beam crossing above it. The indoor pool runs across the middle right — turquoise water, ' +
      'pale concrete coping, slim brass vertical-bar railings and a line of clipped topiary along the rail. ' +
      'The patterned stone floor fills the lower two thirds and converges hard toward the far corner.',
    emphasis: [
      'The long diagonal sweep of the hall — this angle is the one that shows how much room there is.',
      'Strong perspective convergence of the floor pattern toward the far corner.',
      'Warm daylight raking in from the glazed colonnade on the right.',
      'The truss and spotlight rig read clearly overhead.',
    ],
  },
  {
    cameraId: 's2',
    base:
      `${HALL_SHELL} ` +
      'This angle stands at eye level, 1.6 metres up, in the eastern corner — the opposite end from angle 1 — ' +
      'and looks back west across the width of the hall. The truss roof is seen at a shallow angle, its ' +
      'spotlights receding in a rank toward the upper left. The left half of the frame is the glazed ' +
      'colonnade: tall bright openings between square columns, with the oxblood beam raking steeply down ' +
      'into the frame. The right half is the feature wall, a run of six tall maroon louvered slat panels ' +
      'spaced evenly against the terracotta perforated screen, with the black screen panel at centre left. ' +
      'The pool sits in the left middle distance behind its brass railing. The patterned stone floor fills ' +
      'the entire lower half.',
    emphasis: [
      'The maroon louvered feature wall is the backdrop of this angle — it must read as the dominant surface.',
      'Bright glazed left against warm solid right; the contrast is what makes this frame work.',
      'This is the reverse shot of angle 1 — the same room seen back the other way.',
    ],
  },
  {
    cameraId: 's3',
    base:
      `${HALL_SHELL} ` +
      'This angle stands at eye level, 1.55 metres up, on the hall centreline and looks straight down the ' +
      'axis toward the pool, so the composition is symmetrical. Square columns frame the view at the left, ' +
      'centre and right, with the heavy oxblood beam spanning horizontally between them across the middle ' +
      'of the frame and bright openings behind. The truss roof shows above. In the middle distance the pool ' +
      'crosses the frame, divided by a pale concrete walkway on the centreline, brass vertical-bar railings ' +
      'on both sides and a row of clipped hedging behind them; a low pale grey platform sits on the floor at ' +
      'the centre, on the axis. The patterned stone floor fills the lower half and runs straight out toward ' +
      'the viewer.',
    emphasis: [
      'Symmetry — this is the ceremony axis, and the frame is built around the centreline.',
      'The pool and its hedge line are the backdrop; the low central platform is the ceremony spot.',
      'The columns and the oxblood beam frame the shot like a proscenium.',
    ],
    negative: 'Do not break the left–right symmetry of the architecture.',
  },
  {
    cameraId: 's4',
    base:
      `${HALL_SHELL} ` +
      'This angle is raised 6.7 metres at the western end and looks east and steeply down, so it reads as an ' +
      'elevated three-quarter overview. A narrow strip along the top of the frame is the underside of the ' +
      'lighting truss seen close up, its black moving-head spotlights nearly in silhouette. The upper left is ' +
      'dominated by the feature wall seen almost in elevation: around nine tall maroon louvered slat panels ' +
      'hung against a two-tone terracotta perforated screen, with a plain band above the recessed doorways. ' +
      'The lower two thirds is the stone floor seen from above, so its full geometric inlay is legible — large ' +
      'square panels bordered with dark chevron banding. The corner of the pool with its brass railing and a ' +
      'strip of turquoise water cuts into the bottom right.',
    emphasis: [
      'The floor pattern — this is the angle where the whole geometric inlay is readable, so it must be right.',
      'The overall layout is legible from up here: this is the angle a client uses to check the plan.',
      'The lighting truss overhead, seen close and from below.',
    ],
  },
  {
    cameraId: 's5',
    base:
      `${HALL_SHELL} ` +
      'This angle is raised 7 metres at the eastern end and looks west-north-west across the hall. The top ' +
      'third is the truss seen from close underneath, the black moving-head spotlights large and foreshortened. ' +
      'On the left is the glazed wall — tall bright openings between square columns, with the oxblood beam and ' +
      'a secondary maroon rail crossing it. On the right are the maroon louvered slat panels over the ' +
      'terracotta screen, with the black screen panel at centre. The pool is the subject of the middle distance: ' +
      'a long turquoise rectangle wrapped by brass vertical-bar railings, a row of planted hedging along its far ' +
      'edge, and a large pale grey raised platform projecting out over the water. The patterned stone floor ' +
      'occupies the right side and the foreground.',
    emphasis: [
      'The pool and the pale platform projecting over it — this angle exists to show the ceremony setting.',
      'Elevated three-quarter view: both the water and the floor area are in frame at once.',
      'The spotlights read large and close overhead, giving the frame its depth.',
    ],
  },
  {
    cameraId: 'k1',
    base:
      'The viewpoint is on the resort\'s raised reception deck — a separate open-air terrace 4.7 metres above ' +
      'the hall floor and detached from it, about 16 by 18 metres. The camera stands 1.6 metres above the deck ' +
      'at its western edge and looks east-south-east, away from the hall and out across the open terrace. ' +
      'Almost nothing of the building is in this frame: the lower two thirds is the bare deck surface, a flat ' +
      'warm taupe unpatterned floor crossed by a paler diagonal band, and a low grey parapet wall divided into ' +
      'rectangular panels runs across the middle. Beyond the parapet there is open air. Render the sky and the ' +
      'distant desert landscape beyond the parapet as open evening sky over low arid terrain, consistent with ' +
      'the lighting of the other angles.',
    emphasis: [
      'This is an OPEN-AIR terrace, not a room — the space above the parapet is sky, not ceiling.',
      'The deck floor is plain and unpatterned; it is not the hall\'s inlaid stone.',
      'The placed items are the entire subject here; the architecture gives almost nothing.',
      'Take material and colour cues from the reference image, since this frame shows little of the building.',
    ],
    negative:
      'Do not render the banquet hall interior here — no truss roof, no lighting rig, no pool, no louvered ' +
      'feature wall, no inlaid stone floor. Do not enclose the terrace with walls or a ceiling.',
  },
  {
    cameraId: 'k2',
    base:
      'The viewpoint is on the resort\'s raised reception deck — a separate open-air terrace 4.7 metres above ' +
      'the hall floor, about 16 by 18 metres. The camera stands 1.7 metres above the deck at its far eastern ' +
      'corner and looks back west toward the hall, so the terrace is the foreground and the building is the ' +
      'backdrop. The lower half of the frame is the deck itself: a plain pale grey smooth floor, wide and ' +
      'unpatterned. Across the middle runs the hall\'s eastern elevation seen from outside — a long alternating ' +
      'run of maroon louvered slat panels and terracotta perforated screen panels, with a glazed pavilion in ' +
      'dark framing at the right end. Above that the exposed truss and a dense rank of black moving-head ' +
      'spotlights are seen almost edge-on at eye level, because the deck stands so high. A large plain tan ' +
      'soffit — the canopy over the deck — cuts diagonally across the top of the frame.',
    emphasis: [
      'The deck is the stage and the hall façade is the backdrop — keep that front-to-back reading.',
      'The spotlight rig is at eye level here, not overhead, because the terrace is raised.',
      'The tan canopy soffit overhead frames the top of the shot.',
    ],
    negative:
      'Do not render the pool or the hall\'s inlaid stone floor — neither is visible from the terrace. ' +
      'The deck floor stays plain and pale.',
  },
]

const BY_ID = new Map(TEMPLATES.map((t) => [t.cameraId, t]))

export function templateFor(cameraId: string): AngleTemplate | undefined {
  return BY_ID.get(cameraId)
}

export function listAngleTemplates(): AngleTemplate[] {
  return TEMPLATES
}
