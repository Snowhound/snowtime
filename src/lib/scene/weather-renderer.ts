// The seasonal scene's weather renderer: one WebGL 2 canvas that draws an image's effect as
// points, or rain and mist as quads, in one call with no buffers; each item's randomness comes
// from gl_VertexID and its position from the vertex shader. SceneLayer
// (src/components/scene/scene-layer.tsx) imports it the first time weather runs, so pages with
// the weather off send no shaders.
import type { Colors, Effect, Rgb, Weather, Zone } from './weather'

const TUNING = {
  wind: 0,
  gust: 0,
  shear: 0,
  amount: 1,
  size: 1,
  fall: 1,
  opacity: 1,
  share: 0.3,
  glow: 0,
  tempo: 1,
  gather: 0,
  shimmer: 0.3,
  peaks: 1.2,
  peakTime: 1.5,
  peakSize: 2,
}

type EffectDef = {
  // Items per 1440 × 900, and the bounds for other sizes.
  density: number
  min: number
  max: number
  vs: string
  fs: string
  // The #defines for the features this weather turns on (see below).
  defines?: (t: typeof TUNING & Weather) => string[]
  // Draw each item as a quad of two triangles (six vertices) instead of a point.
  quads?: boolean
  // Target frames per second, unless a preset sets its own: 60 for what moves far enough per
  // frame that 30 looks steppy on fast screens, else 30 or less, since each frame also costs the
  // display compositor a redraw of the page (task 063).
  fps: number
  // Backing pixels per CSS pixel, when less than the usual MAX_DPR: a soft effect draws fewer
  // pixels, and the browser scales the canvas up.
  resolution?: number
  colors: Colors
}

// Each program is compiled for what its weather uses: `defines` names the features a preset turns
// on, as #defines, so a program has no branches or uniforms for the ones it leaves out. Values
// that stay the same for an item, such as its premultiplied color, are worked out in the vertex
// shader. A point's are `flat` varyings; a quad's stay smooth, since all its corners hold the
// same value and `flat` on triangles made ANGLE on Metal draw rain about 10% slower.

// Every vertex shader: the frame, the tuning every effect takes, and each item's randomness.
const VS_HEAD = `
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_dpr, u_size, u_fall, u_opacity;
float hash(float n){ return fract(sin(n*127.1)*43758.5453123); }
float hash2(float n){ return fract(sin(n*269.5+31.7)*17358.5453123); }
`
// The wind, for everything that floats or falls.
const WIND = `
uniform float u_wind, u_gust;
// The wind's strength now, around 1: gusts rise and fall with no fixed period.
float gustNow(){ float t = u_time; return 1.0 + u_gust*(.6*cos(t*.7) + .4*cos(t*1.9+1.3)); }
// The gusts' part of how far the wind has carried an item: the integral of gustNow, less its mean.
float gustTime(){ float t = u_time; return u_gust*(.6*sin(t*.7)/.7 + .4*(sin(t*1.9+1.3) - sin(1.3))/1.9); }
// The wind's speed in clip-space x per second, for an item at depth (1 for the nearest).
float windSpeed(float depth){ return u_wind * depth * 2.0 * u_res.y / u_res.x; }
// How far the wind has carried a floating item so far.
float windX(float depth){ return windSpeed(depth) * (u_time + gustTime()); }
float wrapX(float x, float margin){ return -1.0 - margin + mod(x + 1.0 + margin, 2.0 + 2.0*margin); }
`
// Snow and rain: items that fall through the band (BAND), or the whole screen, and wrap to its
// top, blown sideways more below the horizon (SHEAR).
const FALL = `
// The band's top and bottom in clip space; the full screen and a margin without a band.
uniform vec2 u_band;
// An integer hash for a falling item's column on each pass. The pass count grows without bound,
// and sin() loses precision on large arguments, so hash() gave many items the same column.
float columnHash(int item, float pass){
  uint x = uint(item) * 1664525u + uint(pass) * 1013904223u + 12345u;
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return float(x) / 4294967295.0;
}
#ifdef SHEAR
// The image's horizon in clip space.
uniform float u_horizon, u_shear;
// How much stronger the wind is at y: 1 down to the horizon, then rising to 1 + u_shear at the
// screen's foot, as wind picks up near the ground.
float shearAt(float y){
  float s = clamp((u_horizon - y) / (u_horizon + 1.0), 0.0, 1.0);
  return 1.0 + u_shear * s * s;
}
// How far the wind has carried a falling item since it entered at the band's top, falling v clip
// units a second: the integral of shearAt along its path, which bends sideways below the horizon,
// plus the gusts.
float pathX(float y, float v, float depth){
  float below = max(0.0, u_horizon - y), h = max(u_horizon + 1.0, .01);
  return windSpeed(depth) * ((u_band.x - y + u_shear * below*below*below / (3.0*h*h)) / v + gustTime());
}
#else
float shearAt(float y){ return 1.0; }
float pathX(float y, float v, float depth){ return windSpeed(depth) * ((u_band.x - y) / v + gustTime()); }
#endif
// An item that starts r (0 to 1) down the band and has fallen d, wrapping within the band: its y,
// and which pass it's on, so each pass can start in another column.
vec2 fallPass(float r, float d){ float span = u_band.x - u_band.y, p = (1.0-r)*span + d; return vec2(u_band.x - mod(p, span), floor(p/span)); }
// Fades items out at the band's edges.
#ifdef BAND
float bandFade(float y){ return clamp(min(u_band.x - y, y - u_band.y) / .12, 0.0, 1.0); }
#else
float bandFade(float y){ return 1.0; }
#endif
`
// Glitter, the midges, and the mist keep to rectangles of the image, in clip space (left, top,
// right, bottom), each with a factor of the effect's opacity there. ZONES is how many.
const ZONES = `
uniform vec4 u_zones[4];
uniform vec4 u_zoneGain;
`
// mediump: the fragment shaders only shape an item's pixels, and it's cheaper on mobile GPUs. A
// uniform both stages use would have to match in precision, so each uniform is declared in one
// stage only.
const FS_HEAD = `
precision mediump float;
out vec4 outColor;
`
const COLORS = `
uniform vec3 u_colorA, u_colorB;
`
// A firefly's core and halo, the same on every page.
const FIREFLY: [Rgb, Rgb] = [
  [1.0, 0.98, 0.72],
  [0.74, 0.9, 0.32],
]

// Snow and rain's features.
function fallDefines(t: typeof TUNING & Weather) {
  const defines = []
  if (t.band) defines.push('BAND')
  if (t.shear && t.horizon !== undefined) defines.push('SHEAR')
  return defines
}

// Without an image's zones, glitter and the mist keep to the ground below the horizon (prepare).
function zoneCount(t: typeof TUNING & Weather) {
  return Math.min(t.zones?.length ?? 1, 4)
}

export const EFFECTS: Record<Effect, EffectDef> = {
  // Snow. A is the near flakes' color, B the far ones'.
  snow: {
    density: 500,
    min: 150,
    max: 900,
    fps: 30,
    defines: fallDefines,
    vs: `${VS_HEAD}${WIND}${FALL}${COLORS}
    // Premultiplied, as the canvas composites; straight alpha would darken the flakes' edges.
    flat out vec4 v_color;
    void main() {
      float id = float(gl_VertexID) + 1.0;
      float r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0);
      float z = mix(.22, 1.0, pow(r3, 1.8));
      float v = .15 * mix(.18, .60, z) * u_fall * (1.0+r4*.55);
      vec2 f = fallPass(r2, u_time * v);
      float y = f.x;
      float x = columnHash(gl_VertexID, f.y) * 2.0 - 1.0 + pathX(y, v, mix(.6, 1.0, z));
      x += sin((y+r4*6.28)*4.5 + u_time*(.35+r3)) * (.008 + .035*(1.0-z));
      x = wrapX(x, .15);
      x *= mix(.88, 1.08, z);
      gl_Position = vec4(x, y, 0.0, 1.0);
      gl_PointSize = max(1.0, 1.15 * u_dpr * mix(.8, 2.75, z) * u_size);
      float alpha = mix(.15,.82,z) * mix(.72,1.0,r4) * u_opacity * bandFade(y);
      v_color = vec4(mix(u_colorB, u_colorA, z) + r4 * .02, 1.0) * alpha;
    }`,
    fs: `${FS_HEAD}
    flat in vec4 v_color;
    void main() {
      outColor = v_color * smoothstep(.54, .22, length(gl_PointCoord - .5));
    }`,
    // White on the dark scene and on the light image; on the plain light page white flakes would
    // vanish, so they turn blue-grey there.
    colors: {
      dark: [
        [0.96, 0.98, 1.0],
        [0.66, 0.78, 0.9],
      ],
      image: [
        [1.0, 1.0, 1.0],
        [0.9, 0.94, 0.98],
      ],
      plain: [
        [0.44, 0.58, 0.69],
        [0.72, 0.83, 0.9],
      ],
    },
  },
  // Autumn: leaves that sway as they fall and tumble, each turning on its own. A is rust, B ochre.
  leaves: {
    density: 45,
    min: 20,
    max: 60,
    fps: 60,
    vs: `${VS_HEAD}${WIND}${COLORS}
    flat out vec4 v_color;
    // The leaf's turn as cos and sin, and 1 over its width as it tumbles edge-on.
    flat out vec2 v_turn;
    flat out float v_narrow;
    void main() {
      float id = float(gl_VertexID) + 1.0;
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
      float z = mix(.35, 1.0, pow(r3, 1.5));
      float t = u_time;
      float y = 1.25 - mod((1.25 - (r2*2.0-1.0)) + t * mix(.05, .12, z) * (.8 + r4*.5) * u_fall, 2.5);
      float swing = t * mix(1.0, 1.8, r5) + r4*6.28;
      // Drift with the wind, plus a pendulum sway that's wider for near leaves.
      float x = r1*2.0-1.0 + windX((.6+z)/1.6) + sin(swing) * mix(.03, .08, z) * u_res.y / u_res.x;
      x = wrapX(x, .15);
      gl_Position = vec4(x, y, 0.0, 1.0);
      // The leaf's tips reach 0.87 from its center, and the point spans 0.945 either side, which
      // leaves a pixel's edge on the smallest leaves at any turn.
      gl_PointSize = .9 * u_dpr * mix(10.0, 26.0, z) * mix(.85, 1.15, r5) * u_size;
      float angle = r1*6.28 + t*mix(-.7, .7, r2) + cos(swing)*.6;
      v_turn = vec2(cos(angle), sin(angle));
      // Tumbling: -1 to 1, the leaf edge-on at 0 and showing its back below it.
      float flip = cos(t*mix(.7, 1.8, r4) + r3*6.28);
      v_narrow = 1.0 / mix(.3, 1.0, abs(flip));
      // Darker as it turns edge-on, and a lighter back.
      vec3 col = mix(u_colorA, u_colorB, r5) * mix(.7, 1.0, abs(flip));
      col = mix(col, col * 1.15 + .04, step(flip, 0.0) * .6);
      v_color = vec4(col, 1.0) * mix(.5, .95, z) * u_opacity;
    }`,
    fs: `${FS_HEAD}
    flat in vec4 v_color;
    flat in vec2 v_turn;
    flat in float v_narrow;
    void main() {
      vec2 q = mat2(v_turn.x, -v_turn.y, v_turn.y, v_turn.x) * (gl_PointCoord - .5) * 1.89;
      float across = q.x;
      q.x *= v_narrow;
      // A pointed leaf: where two offset circles overlap.
      float d = max(length(q - vec2(.5, 0.0)), length(q + vec2(.5, 0.0))) - 1.0;
      float fw = fwidth(d);
      // A darker vein down the middle.
      float vein = 1.0 - .25 * (1.0 - smoothstep(.0, .05, abs(across))) * step(abs(q.y), .8);
      outColor = vec4(v_color.rgb * vein, v_color.a) * (1.0 - smoothstep(-fw, fw, d));
    }`,
    colors: {
      dark: [
        [0.58, 0.27, 0.13],
        [0.7, 0.47, 0.18],
      ],
      image: [
        [0.71, 0.32, 0.15],
        [0.85, 0.58, 0.2],
      ],
      plain: [
        [0.71, 0.32, 0.15],
        [0.85, 0.58, 0.2],
      ],
    },
  },
  // Summer nights: fireflies that wander over the meadow and glow on and off. A is the core, B the
  // halo.
  fireflies: {
    density: 40,
    min: 18,
    max: 60,
    fps: 30,
    vs: `${VS_HEAD}
    flat out float v_alpha;
    void main() {
      float id = float(gl_VertexID) + 1.0;
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
      float z = mix(.4, 1.0, r3);
      // Mostly low, over the meadow, a few up to the tree line.
      vec2 p = vec2(r1*2.0-1.0, mix(-.95, .3, pow(r2, 1.3)));
      float t = u_time * mix(.12, .22, r4);
      p += vec2(sin(t*2.1 + r4*6.28) + .5*sin(t*4.7 + r1*6.28), cos(t*1.7 + r5*6.28) + .5*sin(t*3.9 + r2*6.28)) * vec2(.06, .05);
      gl_Position = vec4(p, 0.0, 1.0);
      // A quick glow, a slower fade, then dark for the rest of the cycle.
      float ph = fract(u_time / mix(3.0, 6.0, r5) + r1);
      float glow = smoothstep(0.0, .12, ph) * (1.0 - smoothstep(.18, .6, ph));
      v_alpha = glow * mix(.6, 1.0, z) * u_opacity;
      gl_PointSize = v_alpha < .01 ? 0.0 : u_dpr * mix(9.0, 18.0, z) * u_size;
    }`,
    fs: `${FS_HEAD}${COLORS}
    flat in float v_alpha;
    void main() {
      float d = length(gl_PointCoord - .5) * 2.0;
      float core = exp(-d*d*38.0);
      float halo = exp(-d*d*5.0) * .75;
      float a = (core + halo) * v_alpha;
      vec3 col = mix(u_colorB, u_colorA, core / (core + halo + 1e-4));
      // Less alpha than color, so the glow adds light like it would at night.
      outColor = vec4(col * a, a * .7);
    }`,
    colors: { dark: FIREFLY, image: FIREFLY, plain: FIREFLY },
  },
  // Summer days: soft dandelion fluff and pollen drifting on the breeze, the pollen catching the
  // light. A is the seeds' color, B the pollen's. Without fluff (`share` 0, no FLUFF), it's motes in
  // the sun.
  seeds: {
    density: 70,
    min: 30,
    max: 110,
    fps: 30,
    defines: (t) => (t.share > 0 ? ['FLUFF'] : []),
    vs: `${VS_HEAD}${WIND}${COLORS}
    uniform float u_share;
    flat out vec4 v_color;
    // 1 for fluff, 0 for pollen.
    flat out float v_fluff;
    void main() {
      float id = float(gl_VertexID) + 1.0;
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
    #ifdef FLUFF
      float fluff = step(1.0 - u_share, r5);
    #else
      float fluff = 0.0;
    #endif
      float z = mix(.3, 1.0, r3);
      float t = u_time;
      float x = r1*2.0-1.0 + windX(mix(.35, 1.0, z)) + sin(t*mix(.2, .5, r2) + r4*6.28) * .02;
      float y = r2*2.0-1.0 + t * mix(.004, .014, r4) * u_fall + sin(t*mix(.3, .7, r4) + r1*6.28) * .05;
      x = wrapX(x, .15);
      y = -1.15 + mod(y + 1.15, 2.3);
      gl_Position = vec4(x, y, 0.0, 1.0);
      gl_PointSize = max(1.0, u_dpr * mix(mix(2.5, 5.5, z), mix(8.0, 16.0, z), fluff) * u_size);
      float glint = mix(.45 + .55 * pow(.5 + .5*sin(t*mix(1.0, 2.6, r4) + r2*6.28), 3.0), 1.0, fluff);
      v_color = vec4(mix(u_colorB, u_colorA, fluff), 1.0) * mix(.45, .95, z) * glint * u_opacity;
      v_fluff = fluff;
    }`,
    fs: `${FS_HEAD}
    flat in vec4 v_color;
    flat in float v_fluff;
    void main() {
      float r = length(gl_PointCoord - .5) * 2.0;
      float a = smoothstep(1.0, .2, r);
    #ifdef FLUFF
      // Fluff: a fainter tuft around a small, brighter core.
      a = min(a * mix(1.0, .7, v_fluff) + smoothstep(.32, .08, r) * .8 * v_fluff, 1.0);
    #endif
      outColor = v_color * a;
    }`,
    colors: {
      dark: [
        [1.0, 0.99, 0.93],
        [1.0, 0.93, 0.66],
      ],
      image: [
        [1.0, 0.99, 0.93],
        [1.0, 0.93, 0.66],
      ],
      plain: [
        [0.54, 0.5, 0.4],
        [0.72, 0.58, 0.26],
      ],
    },
  },
  // Rain: thin streaks that come in soft bursts, slanted by the wind against their fall. A is the
  // near streaks' color, B the far ones'.
  rain: {
    density: 260,
    min: 90,
    max: 450,
    fps: 60,
    // Each streak is a thin quad along its slant, since a point covering it would shade about
    // 15 times as many pixels, nearly all of them transparent.
    quads: true,
    defines: fallDefines,
    vs: `${VS_HEAD}${WIND}${FALL}${COLORS}
    const vec2 CORNERS[6] = vec2[6](vec2(-1,-1), vec2(1,-1), vec2(1,1), vec2(-1,-1), vec2(1,1), vec2(-1,1));
    out vec4 v_color;
    out vec2 v_q;
    void main() {
      int item = gl_VertexID / 6;
      float id = float(item) + 1.0;
      float r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0);
      float z = mix(.35, 1.0, pow(r3, 1.3));
      float v = mix(1.1, 2.0, z) * u_fall;
      vec2 f = fallPass(r2, u_time * v);
      float y = f.x;
      float depth = mix(.55, 1.0, z);
      float x = wrapX(columnHash(item, f.y)*2.0-1.0 + pathX(y, v, depth), .15);
      // Sideways pixels per pixel of fall, as the wind blows here and now.
      float slant = 2.0 * u_wind * depth * shearAt(y) * gustNow() / v;
      // Bursts: the shower's strength rises and falls, and each streak shows above its own level.
      float level = mix(.1, 1.0, smoothstep(.15, .85, .5 + .5*sin(u_time*.23 + sin(u_time*.07)*2.0)));
      float shown = smoothstep(r4 - .1, r4, level);
      // The streak's length in pixels; it spans -1 to 1 along its slant.
      float size = u_dpr * mix(14.0, 30.0, z) * u_size;
      // Half a streak's width in the same units: about 0.6 px, fading out by 2.5 times that.
      float width = .6 * u_dpr * 2.0 / size;
      // x: along the streak, toward its falling end; y: across it, in half-widths.
      vec2 corner = CORNERS[gl_VertexID % 6];
      v_q = vec2(corner.x, corner.y * 2.5);
      vec2 dir = normalize(vec2(slant, -1.0));
      vec2 offset = v_q.x * dir + v_q.y * width * vec2(-dir.y, dir.x);
      // A hidden streak collapses to its center, so it covers no pixels.
      gl_Position = vec4(vec2(x, y) + (shown < .01 ? vec2(0) : offset * size / u_res), 0.0, 1.0);
      v_color = vec4(mix(u_colorB, u_colorA, z), 1.0) * mix(.25, .6, z) * shown * u_opacity * bandFade(y);
    }`,
    fs: `${FS_HEAD}
    in vec4 v_color;
    in vec2 v_q;
    void main() {
      float along = v_q.x;
      // Sharp across, tapering toward the streak's ends, and fainter at its trailing end.
      float a = smoothstep(2.5, 1.0, abs(v_q.y)) * smoothstep(1.0, .1, abs(along)) * mix(.35, 1.0, along * .5 + .5);
      outColor = v_color * a;
    }`,
    colors: {
      dark: [
        [0.8, 0.87, 0.96],
        [0.56, 0.66, 0.8],
      ],
      image: [
        [0.4, 0.48, 0.6],
        [0.58, 0.65, 0.75],
      ],
      plain: [
        [0.4, 0.5, 0.63],
        [0.6, 0.68, 0.78],
      ],
    },
  },
  // Snow or frost glittering in the image's snowy zones (`zones`, so it misses water): specks that
  // shimmer faintly and slowly (`shimmer`, `tempo`), and now and then a glint at full brightness,
  // timed so that about `peaks` show at once, each for `peakTime` seconds and `peakSize` times as
  // large. Specks are larger nearer the viewer. A is the glints' color at their peak, B at their
  // edge.
  glitter: {
    density: 500,
    min: 150,
    max: 900,
    fps: 30,
    defines: (t) => [`ZONES ${zoneCount(t)}`],
    vs: `${VS_HEAD}${ZONES}
    // The image's horizon in clip space; below the screen without one.
    uniform float u_horizon;
    uniform float u_tempo, u_shimmer, u_peakTime, u_peakSize;
    // How often each speck glints, in seconds (glitterCycle).
    uniform float u_cycle;
    flat out float v_alpha;
    void main() {
      float id = float(gl_VertexID) + 1.0;
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
      int zi = min(int(r5 * float(ZONES)), ZONES - 1);
      vec4 zone = u_zones[zi];
      // Denser toward the zone's top, which is farther away.
      float y = mix(zone.y, zone.w, pow(r2, 1.5));
      gl_Position = vec4(mix(zone.x, zone.z, r1), y, 0.0, 1.0);
      float shimmer = pow(max(0.0, sin(u_time * u_tempo * mix(.25, .8, r3) + r4 * 6.28)), 4.0) * u_shimmer;
      // Each speck's glint comes once a cycle, at its own time.
      float tau = mod(u_time + hash(id*4.71+2.0) * u_cycle, u_cycle);
      float peak = tau < u_peakTime ? pow(sin(3.14159 * tau / u_peakTime), 2.0) : 0.0;
      v_alpha = max(shimmer, peak) * u_opacity * u_zoneGain[zi];
      // 0 at the horizon, 1 at the screen's foot.
      float near = clamp((u_horizon - y) / (u_horizon + 1.0), 0.0, 1.0);
      gl_PointSize = v_alpha < .02 ? 0.0 : max(1.0, u_dpr * u_size * mix(1.0, 2.4, near)) * mix(1.0, u_peakSize, peak);
    }`,
    fs: `${FS_HEAD}${COLORS}
    flat in float v_alpha;
    void main() {
      float d = length(gl_PointCoord - .5) * 2.0;
      float a = exp(-d * d * 4.0) * (1.0 - smoothstep(.8, 1.0, d)) * v_alpha;
      vec3 col = mix(u_colorB, u_colorA, exp(-d * d * 9.0));
      outColor = vec4(col * a, a);
    }`,
    colors: {
      dark: [
        [1.0, 1.0, 1.0],
        [0.9, 0.95, 1.0],
      ],
      image: [
        [1.0, 1.0, 1.0],
        [0.9, 0.95, 1.0],
      ],
      plain: [
        [0.36, 0.52, 0.7],
        [0.55, 0.68, 0.8],
      ],
    },
  },
  // Summer by the water: small groups of midges, a pixel or two each, idling over the water; a
  // share (`share`) glint by day. `zones` places them: three quarters of the groups in the first,
  // the rest in the second. At night `glow` fireflies (FIREFLIES) wander on their own in the third,
  // along the bank. A is the midges' color, B the glints' and fireflies'.
  insects: {
    density: 18,
    min: 9,
    max: 30,
    fps: 60,
    defines: (t) => (t.glow > 0 ? ['FIREFLIES'] : []),
    vs: `${VS_HEAD}${WIND}${ZONES}${COLORS}
    uniform float u_share, u_glow, u_tempo;
    flat out vec4 v_color;
    flat out float v_firefly;
    // Wandering slowly along the bank.
    vec2 fireflyAt(float r1, float r2, float r4, float r5){
      vec4 zone = u_zones[2];
      float t = u_time * u_tempo * mix(.05, .09, r4);
      return vec2(mix(zone.x, zone.z, r1) + sin(t*2.1 + r4*6.28)*.04, mix(zone.w, zone.y, r2) + sin(t*3.3 + r5*6.28)*.015);
    }
    // Groups of three, each idling about a point that drifts slowly with the wind.
    vec2 midgeAt(float r2, float r3, float r4, float r5){
      float group = floor((float(gl_VertexID) - u_glow) / 3.0);
      float s1 = hash(group*7.3+1.0), s2 = hash2(group*3.1+2.0);
      vec4 zone = u_zones[hash(group*5.9+4.0) < .75 ? 0 : 1];
      vec2 c = vec2(mix(zone.x, zone.z, s1) + sin(u_time*.03 + s2*6.28)*.05 + windX(1.0), mix(zone.w, zone.y, s2));
      float t = u_time * u_tempo * mix(.4, .7, r4);
      vec2 o = vec2(sin(t*2.3 + r2*6.28) + .5*sin(t*4.1 + r3*6.28), cos(t*1.9 + r3*6.28) + .5*sin(t*3.7 + r2*6.28));
      return c + o * vec2(.03 * u_res.y / u_res.x, .03) * mix(.6, 1.2, r5);
    }
    void main() {
      float id = float(gl_VertexID) + 1.0;
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
    #ifdef FIREFLIES
      float firefly = step(float(gl_VertexID) + .5, u_glow);
      vec2 p = firefly > .5 ? fireflyAt(r1, r2, r4, r5) : midgeAt(r2, r3, r4, r5);
    #else
      float firefly = 0.0;
      vec2 p = midgeAt(r2, r3, r4, r5);
    #endif
      p.x = wrapX(p.x, .1);
      gl_Position = vec4(p, 0.0, 1.0);
      float z = mix(.4, 1.0, r3);
      float special = max(firefly, step(1.0 - u_share, hash(id*1.91+5.0)));
      // A firefly's glow: quick on, slower off, then dark for the rest of its cycle.
      float ph = fract(u_time / mix(4.0, 7.0, r5) + r1);
      float glow = smoothstep(0.0, .12, ph) * (1.0 - smoothstep(.18, .6, ph));
      float alpha = mix(mix(.5, .9, z) * (.8 + .2*sin(u_time*17.0 + r2*6.28)), glow, firefly) * u_opacity;
      gl_PointSize = alpha < .01 ? 0.0 : u_dpr * u_size * mix(max(1.0, mix(1.0, 2.2, z)), mix(9.0, 16.0, z), firefly);
      // A firefly has less alpha than color, so its glow adds light like it would at night.
      v_color = vec4(mix(u_colorA, u_colorB, special), mix(1.0, .7, firefly)) * alpha;
      v_firefly = firefly;
    }`,
    fs: `${FS_HEAD}
    flat in vec4 v_color;
    flat in float v_firefly;
    void main() {
      float d = length(gl_PointCoord - .5) * 2.0;
      float a = smoothstep(1.1, .2, d);
    #ifdef FIREFLIES
      a = mix(a, exp(-d*d*38.0) + exp(-d*d*5.0)*.6, v_firefly);
    #endif
      outColor = v_color * a;
    }`,
    colors: {
      dark: [
        [0.6, 0.66, 0.76],
        [1.0, 0.98, 0.72],
      ],
      image: [
        [0.16, 0.15, 0.12],
        [1.0, 0.96, 0.82],
      ],
      plain: [
        [0.3, 0.3, 0.28],
        [0.72, 0.58, 0.26],
      ],
    },
  },
  // Night mist: wide, soft banks of uneven density that drift through the image's zones. Each bank
  // is one quad. A is the thick parts' color, B the thin parts'.
  mist: {
    density: 16,
    min: 10,
    max: 24,
    // The banks barely move: at most 0.03 screen heights a second (coast November), about 3 px a
    // frame at 10 fps on a 900 px screen, which their soft, 100 px wide edges hide.
    fps: 10,
    // The costliest effect per pixel, and soft throughout: its finest noise spans over 100 CSS px,
    // so half a backing pixel per CSS pixel looks the same.
    resolution: 0.5,
    quads: true,
    defines: (t) =>
      t.gather > 0 ? [`ZONES ${zoneCount(t)}`, 'GATHER'] : [`ZONES ${zoneCount(t)}`],
    vs: `${VS_HEAD}${WIND}${ZONES}
    uniform float u_gather;
    out vec2 v_uv, v_p;
    out float v_alpha;
    const vec2 CORNERS[6] = vec2[6](vec2(-1, -1), vec2(1, -1), vec2(-1, 1), vec2(-1, 1), vec2(1, -1), vec2(1, 1));
    void main() {
      float id = float(gl_VertexID / 6) + 1.0;
      vec2 c = CORNERS[gl_VertexID % 6];
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
      float z = mix(.4, 1.0, r3);
      // Each bank keeps to one zone's rows, and fades out as it drifts past the zone's sides.
      int zi = min(int(hash(id*7.73+1.3) * float(ZONES)), ZONES - 1);
      vec4 zone = u_zones[zi];
      float gain = u_zoneGain[zi];
      // Half the bank's width and height in clip space: wide and low, up to half the band tall.
      float band = zone.y - zone.w;
      vec2 half_ = vec2(mix(.35, .75, r4) * u_size, band * mix(.25, .5, r5));
      float cy = mix(zone.w + half_.y * .6, zone.y - half_.y * .6, r2);
      float x = r1*2.0-1.0 + windX(z) + sin(u_time*.03 + r5*6.28) * .03;
      float cx = wrapX(x, half_.x);
      // A gathered bank is no wider than its zone and wraps within it, passing its sides once
      // faded out. Gathered banks thin out together over about 90 seconds, thickest at the
      // start, so the zone clears now and then.
      float breathe = 1.0;
    #ifdef GATHER
      if (hash(id*13.37+5.1) < u_gather) {
        half_.x = min(half_.x, (zone.z - zone.x) * .5);
        float lo = zone.x - half_.x;
        cx = lo + mod(x - lo, zone.z - zone.x + 2.0*half_.x);
        breathe = smoothstep(.15, .6, .5 + .5 * cos(u_time * .07 + r3 * .6));
      }
    #endif
      gl_Position = vec4(vec2(cx, cy) + c * half_, 0.0, 1.0);
      v_uv = c;
      // The texture's coordinates, in screen heights, move with the bank.
      v_p = c * half_ * vec2(u_res.x / u_res.y, 1.0) * .5 + r1 * 17.0;
      v_alpha = .22 * u_opacity * mix(.5, 1.0, z) * (.7 + .3 * sin(u_time * mix(.05, .12, r4) + r1 * 6.28));
      v_alpha *= gain * breathe * smoothstep(.35, 0.0, max(zone.x - cx, cx - zone.z));
    }`,
    // v_p and the noise need highp: in mediump the texture coordinate's fraction is too coarse at
    // 7 times its scale.
    fs: `${FS_HEAD}${COLORS}
    in vec2 v_uv;
    in highp vec2 v_p;
    in float v_alpha;
    // An integer hash of a lattice cell, exact at any precision; a sin() hash breaks down in
    // mediump.
    float vhash(highp vec2 cell){
      highp uvec2 q = uvec2(ivec2(cell) + 4096);
      highp uint x = q.x * 1664525u ^ (q.y * 1013904223u + 12345u);
      x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
      return float(x) / 4294967295.0;
    }
    float vnoise(highp vec2 p){
      highp vec2 i = floor(p);
      vec2 f = fract(p);
      f = f*f*(3.0 - 2.0*f);
      return mix(mix(vhash(i), vhash(i + vec2(1, 0)), f.x), mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      vec2 u = v_uv;
      // Soft all round, reaching zero at the quad's edge.
      float shape = exp(-(u.x*u.x*1.6 + u.y*u.y*3.0)) * (1.0 - u.x*u.x) * (1.0 - u.y*u.y);
      // Skipping the noise where the bank is too faint to show saves most of the quad's corners.
      // Zero rather than discard, which cost the Apple M1 up to a quarter more.
      if (shape * v_alpha < .004) { outColor = vec4(0); return; }
      float n = vnoise(v_p * 3.0) * .65 + vnoise(v_p * 7.0 + 4.0) * .35;
      float a = shape * smoothstep(.15, .85, n) * v_alpha;
      vec3 col = mix(u_colorB, u_colorA, n);
      outColor = vec4(col * a, a);
    }`,
    colors: {
      dark: [
        [0.66, 0.74, 0.84],
        [0.5, 0.58, 0.7],
      ],
      image: [
        [1.0, 1.0, 1.0],
        [0.92, 0.95, 0.98],
      ],
      plain: [
        [0.7, 0.78, 0.86],
        [0.8, 0.86, 0.92],
      ],
    },
  },
}

// The two colors the weather's effect mixes on the page: the image's or the preset's for the
// page, else the effect's.
export function weatherColors(
  weather: Weather & { effect: Effect },
  page: { dark: boolean; background: boolean },
): [Rgb, Rgb] {
  const key = page.dark ? 'dark' : page.background ? 'image' : 'plain'
  return weather.colors?.[key] ?? EFFECTS[weather.effect].colors[key]
}

// The photos' aspect ratio and `background-position` y (.scene-photo-image in src/styles.css), to
// map image rows and rectangles to the screen the way `cover` crops the photo.
const PHOTO_ASPECT = 1920 / 1084
const PHOTO_Y = 0.2
const FULL_BAND: [number, number] = [1.2, -1.2]

// Rows of the image, as fractions of its height, in clip space.
function bandClip(band: number[] | undefined, w: number, h: number) {
  if (!band) return FULL_BAND
  const shown = Math.max(h, w / PHOTO_ASPECT)
  const top = (h - shown) * PHOTO_Y
  return band.map((f) => 1 - (2 * (top + f * shown)) / h)
}

// A rectangle of the image in clip space. `cover` centers the photo across.
function zoneClip([left, top, right, bottom]: Zone, w: number, h: number) {
  const shown = Math.max(w, h * PHOTO_ASPECT)
  function x(f: number) {
    return (2 * ((w - shown) / 2 + f * shown)) / w - 1
  }
  const [t, b] = bandClip([top, bottom], w, h)
  return [x(left), t, x(right), b]
}

// How often each glitter speck glints, in seconds, so that about `peaks` glints show at once on a
// 1440 × 900 screen, proportionally more on a larger one. It leaves out the screen's size, so a
// resize doesn't move every speck to another point of its cycle.
function glitterCycle(t: typeof TUNING) {
  return (EFFECTS.glitter.density * t.amount * t.peakTime) / Math.max(t.peaks, 0.01)
}

export type WeatherRenderer = {
  // Draws `weather`, which has an effect (see weatherFor), with its two colors (weatherColors).
  // Throws if the effect's shaders don't compile.
  start(weather: Weather & { effect: Effect }, colors: [Rgb, Rgb]): void
  stop(): void
  // Stops and draws the frame at `seconds` of the weather's time, for the weather bench's golden
  // frames (perf/weather.ts).
  drawAt(seconds: number): void
  // Stops and frees the context.
  destroy(): void
}

const UNIFORMS = [
  'u_res',
  'u_band',
  'u_horizon',
  'u_time',
  'u_dpr',
  'u_wind',
  'u_gust',
  'u_shear',
  'u_size',
  'u_fall',
  'u_opacity',
  'u_share',
  'u_glow',
  'u_tempo',
  'u_gather',
  'u_zones',
  'u_zoneGain',
  'u_cycle',
  'u_shimmer',
  'u_peakTime',
  'u_peakSize',
  'u_colorA',
  'u_colorB',
] as const

// The tuning fields that go to the shaders as they are.
const TUNED = [
  'wind',
  'gust',
  'shear',
  'size',
  'fall',
  'opacity',
  'share',
  'glow',
  'tempo',
  'gather',
  'shimmer',
  'peakTime',
  'peakSize',
] as const

// The most backing pixels per CSS pixel the canvas has, whatever the screen's.
const MAX_DPR = 1.5

// A weather's tuning, with the defaults for what it leaves out.
function tuned(weather: Weather & { effect: Effect }) {
  return { ...TUNING, ...weather }
}

function fps(weather: Weather & { effect: Effect }) {
  return weather.fps ?? EFFECTS[weather.effect].fps
}

// One WebGL context for all effects; each effect's program compiles the first time it runs.
// `pace()` gives the factors for the point count and the speed. Null without WebGL 2, which
// weatherSupported() predicts without creating a context. `uncapped` draws on every animation
// frame, without the pacing below, so the weather bench can measure a frame's cost.
export function createWeatherRenderer(
  canvas: HTMLCanvasElement,
  pace: () => { density: number; speed: number },
  { uncapped = false } = {},
): WeatherRenderer | null {
  const context = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  })
  if (!context) return null
  const gl = context
  function compile(type: number, src: string) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed to compile')
    }
    return shader
  }
  type Program = {
    p: WebGLProgram
    u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>
  }
  // Compiled programs by effect and #defines.
  const programs = new Map<string, Program>()
  function program(effect: Effect, defines: string[]): Program {
    const key = [effect, ...defines].join(' ')
    const cached = programs.get(key)
    if (cached) return cached
    const fx = EFFECTS[effect]
    const head = `#version 300 es\n${defines.map((d) => `#define ${d}\n`).join('')}`
    const p = gl.createProgram()
    gl.attachShader(p, compile(gl.VERTEX_SHADER, head + fx.vs))
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, head + fx.fs))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) ?? 'Program failed to link')
    }
    const u = Object.fromEntries(
      UNIFORMS.map((n) => [n, gl.getUniformLocation(p, n)]),
    ) as Program['u']
    programs.set(key, { p, u })
    return { p, u }
  }
  function programFor(weather: Weather & { effect: Effect }) {
    return program(weather.effect, EFFECTS[weather.effect].defines?.(tuned(weather)) ?? [])
  }
  gl.bindVertexArray(gl.createVertexArray())
  gl.enable(gl.BLEND)
  // Premultiplied, as the canvas composites, so edges don't darken. A transparent pixel leaves the
  // canvas as it was, so the shaders don't discard.
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

  // The canvas's size in CSS pixels, kept by an observer so frames don't force a layout.
  let cssWidth = canvas.clientWidth
  let cssHeight = canvas.clientHeight
  const resize = new ResizeObserver(([entry]) => {
    cssWidth = entry.contentRect.width
    cssHeight = entry.contentRect.height
    setup = null
  })
  resize.observe(canvas)

  let raf = 0
  let last = 0
  let elapsed = 0
  let current: (Weather & { effect: Effect }) | null = null
  let colors: [Rgb, Rgb] | null = null

  // What a frame draws with, worked out again only on a start or a resize.
  type Setup = ReturnType<typeof prepare>
  let setup: Setup | null = null
  function prepare(weather: Weather & { effect: Effect }, w: number, h: number, dpr: number) {
    const t = tuned(weather)
    const fx = EFFECTS[weather.effect]
    const zones = (t.zones ?? [[0, t.horizon ?? 1, 1, 1] as Zone])
      .slice(0, 4)
      .map((zone) => zoneClip(zone, w, h))
    // Item counts scale with the drawn area. A band's effect keeps the count of its full-screen
    // version, so it's thicker in the band.
    const area = (cssWidth * cssHeight) / (1440 * 900)
    return {
      w,
      h,
      dpr,
      t,
      fx,
      program: programFor(weather),
      band: bandClip(t.band, w, h),
      horizon: t.horizon === undefined ? FULL_BAND[1] : bandClip([t.horizon], w, h)[0],
      zones: [...zones.flat(), ...Array<number>((4 - zones.length) * 4).fill(0)],
      zoneGain: [0, 1, 2, 3].map((i) => t.zones?.[i]?.[4] ?? 1),
      cycle: glitterCycle(t),
      count: Math.min(fx.max, Math.max(fx.min, fx.density * area)) * t.amount,
    }
  }

  // The weather draws every nth display refresh, so its frames are evenly spaced at any refresh
  // rate; a millisecond threshold gives uneven gaps wherever it falls near a multiple of the
  // refresh interval. The rate comes from the first frame gaps after each start: busy frames only
  // lengthen gaps, and under load they alternate between one refresh and two, so it takes the low
  // quartile rather than the median.
  const MEASURED_GAPS = 10
  let gaps: number[] = []
  let hz = 0
  let prev = 0
  // Refreshes added to each frame after dropped frames, until the next start or target.
  let slower = 0

  function fewestRefreshes(target: number) {
    return Math.max(1, Math.round(hz / target))
  }
  function mostRefreshes(target: number) {
    return Math.max(fewestRefreshes(target), Math.round(hz / 30))
  }
  function refreshesPerFrame(target: number) {
    return Math.min(fewestRefreshes(target) + slower, mostRefreshes(target))
  }

  // Frame gaps over half-second windows. Gaps longer than 1.5 refreshes are dropped frames: when
  // they make up a quarter of two windows in a row, frames step down a refresh, to about 30 fps
  // at the slowest; two windows, so a page load's long tasks don't count. Gaps shorter than a
  // refresh mean the measured rate is too low, so when they make up a quarter of a window, it's
  // measured again.
  const WINDOW = 500
  let windowStart = 0
  let windowGaps = 0
  let windowDrops = 0
  let windowShort = 0
  let droppedBefore = false
  function newWindow(now: number) {
    windowStart = now
    windowGaps = windowDrops = windowShort = 0
  }
  function watch(now: number, gap: number, target: number) {
    const refresh = 1000 / hz
    windowGaps++
    if (gap > refresh * 1.5) windowDrops++
    if (gap < refresh * 0.75) windowShort++
    if (now - windowStart < WINDOW) return
    const dropped = windowDrops * 4 >= windowGaps
    if (windowShort * 4 >= windowGaps) {
      hz = 0
      gaps = []
    } else if (dropped && droppedBefore && refreshesPerFrame(target) < mostRefreshes(target)) {
      slower++
    }
    droppedBefore = dropped && !droppedBefore
    newWindow(now)
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame)
    if (!current || !colors) return
    const target = fps(current)
    const gap = prev ? now - prev : 0
    prev = now
    if (gap && hz) watch(now, gap, target)
    else if (gap) {
      gaps.push(gap)
      if (gaps.length === MEASURED_GAPS) {
        hz = Math.round(1000 / gaps.sort((a, b) => a - b)[MEASURED_GAPS >> 2])
        newWindow(now)
        droppedBefore = false
      }
    }
    // Timestamps are whole refreshes apart, give or take jitter. Until the rate is known, frames
    // follow the target in milliseconds, with room for the jitter.
    const due = hz
      ? Math.round(((now - last) * hz) / 1000) >= refreshesPerFrame(target)
      : now - last >= (1000 / target) * 0.8
    if (!due && !uncapped) return
    elapsed += (Math.min(now - (last || now), 100) / 1000) * pace().speed
    last = now
    draw()
  }
  function draw() {
    if (!current || !colors) return
    const dpr = Math.min(devicePixelRatio || 1, EFFECTS[current.effect].resolution ?? MAX_DPR)
    const w = Math.max(1, Math.floor(cssWidth * dpr))
    const h = Math.max(1, Math.floor(cssHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      gl.viewport(0, 0, w, h)
    }
    if (!setup || setup.w !== w || setup.h !== h || setup.dpr !== dpr) {
      setup = prepare(current, w, h, dpr)
      upload(setup, colors)
    }
    const { u } = setup.program
    // The clear color is WebGL's default, transparent.
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform1f(u.u_time, elapsed)
    const count = Math.round(setup.count * pace().density)
    if (setup.fx.quads) gl.drawArrays(gl.TRIANGLES, 0, count * 6)
    else gl.drawArrays(gl.POINTS, 0, count)
  }
  // The uniforms that change only with the setup. A program keeps its uniforms, and only one
  // program is in use until the next start, which makes a new setup.
  function upload({ program: { p, u }, t, ...setup }: Setup, [a, b]: [Rgb, Rgb]) {
    gl.useProgram(p)
    gl.uniform3f(u.u_colorA, ...a)
    gl.uniform3f(u.u_colorB, ...b)
    gl.uniform2f(u.u_res, setup.w, setup.h)
    gl.uniform2f(u.u_band, setup.band[0], setup.band[1])
    gl.uniform1f(u.u_horizon, setup.horizon)
    gl.uniform4fv(u.u_zones, setup.zones)
    gl.uniform4fv(u.u_zoneGain, setup.zoneGain)
    gl.uniform1f(u.u_cycle, setup.cycle)
    gl.uniform1f(u.u_dpr, setup.dpr)
    for (const key of TUNED) gl.uniform1f(u[`u_${key}`], t[key])
  }
  function stop() {
    cancelAnimationFrame(raf)
    raf = 0
    gl.clear(gl.COLOR_BUFFER_BIT)
  }
  return {
    start(weather, pair) {
      programFor(weather)
      if (!current || fps(weather) !== fps(current)) slower = 0
      current = weather
      colors = pair
      setup = null
      if (raf) return
      last = 0
      prev = 0
      hz = 0
      gaps = []
      raf = requestAnimationFrame(frame)
    },
    stop,
    drawAt(seconds) {
      stop()
      elapsed = seconds
      draw()
    },
    destroy() {
      stop()
      resize.disconnect()
      for (const { p } of programs.values()) gl.deleteProgram(p)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
