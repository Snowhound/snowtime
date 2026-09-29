// The seasonal scene's weather (prototypes/scene.js, prototypes/README.md, "Weather by image"): one
// WebGL 2 canvas that draws an image's effect as points, or rain and mist as quads, in one call
// with no buffers; each item's randomness comes from gl_VertexID and its position from the vertex
// shader. Each image's weather is a preset tuned for the picture (IMAGE_WEATHER). SceneLayer
// (src/components/scene/scene-layer.tsx) runs it.
import { createSignal } from 'solid-js'
import type { ImageId } from './images'

export type Effect =
  | 'snow'
  | 'rain'
  | 'seeds'
  | 'fireflies'
  | 'leaves'
  | 'glitter'
  | 'insects'
  | 'mist'

type Rgb = [number, number, number]

type Colors = (scene: { dark: boolean; background: boolean }) => [Rgb, Rgb]

type EffectDef = {
  // Items per 1440 × 900, and the bounds for other sizes.
  density: number
  min: number
  max: number
  vs: string
  fs: string
  // Draw each item as a quad of two triangles (six vertices) instead of a point.
  quads?: boolean
  // Target frames per second, unless a preset sets its own: 60 for what moves far enough per
  // frame that 30 looks steppy on fast screens, else 30 or less, since each frame also redraws
  // the blur of the glass surfaces over the canvas (task 063).
  fps: number
  // Backing pixels per CSS pixel, when less than the usual MAX_DPR: a soft effect draws fewer
  // pixels, and the browser scales the canvas up.
  resolution?: number
  // A and B: two colors each effect mixes, for dark pages and for the image or the plain page.
  colors: Colors
}

// Factors of the sign-in page's point count and speed. App pages run calm, since the full
// weather felt busy behind real work.
export const PACES = {
  full: { density: 1, speed: 1 },
  calm: { density: 0.5, speed: 0.7 },
} as const

export type Pace = keyof typeof PACES

// Every effect takes the image's tuning as uniforms (see Tuning below).
const HEAD = `#version 300 es
precision highp float;
uniform vec2 u_res;
// The band's top and bottom in clip space; the full screen and a margin without a band.
uniform vec2 u_band;
// The image's horizon in clip space; below the screen without one.
uniform float u_horizon;
uniform float u_time, u_dpr, u_wind, u_gust, u_shear, u_size, u_fall, u_opacity, u_share, u_glow, u_tempo;
// Up to three rectangles of the image in clip space (left, top, right, bottom), and how many.
uniform vec4 u_zones[3];
uniform float u_zoneCount;
// Each zone's factor of glitter's opacity.
uniform vec3 u_zoneGain;
float hash(float n){ return fract(sin(n*127.1)*43758.5453123); }
float hash2(float n){ return fract(sin(n*269.5+31.7)*17358.5453123); }
// An integer hash for a falling item's column on each pass. The pass count grows without bound,
// and sin() loses precision on large arguments, so hash() gave many items the same column.
float columnHash(int item, float pass){
  uint x = uint(item) * 1664525u + uint(pass) * 1013904223u + 12345u;
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return float(x) / 4294967295.0;
}
// The wind's strength now, around 1: gusts rise and fall with no fixed period.
float gustNow(){ float t = u_time; return 1.0 + u_gust*(.6*cos(t*.7) + .4*cos(t*1.9+1.3)); }
// The gusts' part of how far the wind has carried an item: the integral of gustNow, less its mean.
float gustTime(){ float t = u_time; return u_gust*(.6*sin(t*.7)/.7 + .4*(sin(t*1.9+1.3) - sin(1.3))/1.9); }
// The wind's speed in clip-space x per second, for an item at depth (1 for the nearest).
float windSpeed(float depth){ return u_wind * depth * 2.0 * u_res.y / u_res.x; }
// How far the wind has carried a floating item so far.
float windX(float depth){ return windSpeed(depth) * (u_time + gustTime()); }
// How much stronger the wind is at y: 1 down to the horizon, then rising to 1 + u_shear at the
// screen's foot, as wind picks up near the ground.
float shearAt(float y){
  if (u_horizon <= -1.0) return 1.0;
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
float wrapX(float x, float margin){ return -1.0 - margin + mod(x + 1.0 + margin, 2.0 + 2.0*margin); }
// An item that starts r (0 to 1) down the band and has fallen d, wrapping within the band: its y,
// and which pass it's on, so each pass can start in another column.
vec2 fallPass(float r, float d){ float span = u_band.x - u_band.y, p = (1.0-r)*span + d; return vec2(u_band.x - mod(p, span), floor(p/span)); }
// Fades items out at a band's edges, which are off-screen without a band.
float bandFade(float y){ return clamp(min(u_band.x - y, y - u_band.y) / .12, 0.0, 1.0); }
`
// mediump: the fragment shaders only shape an item's pixels, and it's cheaper on mobile GPUs. A
// uniform both stages use would have to match in precision, so values the fragment shader needs
// come in as varyings.
const FS_HEAD = `#version 300 es
precision mediump float;
uniform vec3 u_colorA, u_colorB;
out vec4 outColor;
`
export const EFFECTS: Record<Effect, EffectDef> = {
  // Snow. A is the near flakes' color, B the far ones'.
  snow: {
    density: 500,
    min: 150,
    max: 900,
    fps: 30,
    vs: `${HEAD}
    out float v_alpha, v_depth, v_rnd;
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
      v_alpha = mix(.15,.82,z) * mix(.72,1.0,r4) * u_opacity * bandFade(y);
      v_depth = z;
      v_rnd = r4;
    }`,
    fs: `${FS_HEAD}
    in float v_alpha, v_depth, v_rnd;
    void main() {
      float d = length(gl_PointCoord - .5);
      float a = smoothstep(.54,.22,d) * v_alpha;
      vec3 c = mix(u_colorB, u_colorA, v_depth) + v_rnd * 0.02;
      // Premultiplied, as the canvas composites; straight alpha would darken the flakes' edges.
      outColor = vec4(c * a, a);
    }`,
    // White on the dark scene and on the light image; on the plain light page white flakes would
    // vanish, so they turn blue-grey there.
    colors: ({ dark, background }) =>
      dark
        ? [
            [0.96, 0.98, 1.0],
            [0.66, 0.78, 0.9],
          ]
        : background
          ? [
              [1.0, 1.0, 1.0],
              [0.9, 0.94, 0.98],
            ]
          : [
              [0.44, 0.58, 0.69],
              [0.72, 0.83, 0.9],
            ],
  },
  // Autumn: leaves that sway as they fall and tumble, each turning on its own. A is rust, B ochre.
  leaves: {
    density: 45,
    min: 20,
    max: 60,
    fps: 60,
    vs: `${HEAD}
    out float v_alpha, v_rnd, v_angle, v_flip;
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
      gl_PointSize = u_dpr * mix(10.0, 26.0, z) * mix(.85, 1.15, r5) * u_size;
      v_angle = r1*6.28 + t*mix(-.7, .7, r2) + cos(swing)*.6;
      v_flip = cos(t*mix(.7, 1.8, r4) + r3*6.28);
      v_alpha = mix(.5, .95, z) * u_opacity;
      v_rnd = r5;
    }`,
    fs: `${FS_HEAD}
    in float v_alpha, v_rnd, v_angle, v_flip;
    void main() {
      vec2 q = (gl_PointCoord - .5) * 2.1;
      float c = cos(v_angle), s = sin(v_angle);
      q = mat2(c, -s, s, c) * q;
      float xr = q.x;
      // Tumbling: the leaf narrows as it turns edge-on.
      q.x /= mix(.3, 1.0, abs(v_flip));
      // A pointed leaf: where two offset circles overlap.
      float d = max(length(q - vec2(.5, 0.0)), length(q + vec2(.5, 0.0))) - 1.0;
      float fw = fwidth(d);
      float a = (1.0 - smoothstep(-fw, fw, d)) * v_alpha;
      vec3 col = mix(u_colorA, u_colorB, v_rnd);
      col *= mix(.7, 1.0, abs(v_flip));
      col = mix(col, col * 1.15 + .04, step(v_flip, 0.0) * .6);
      col *= 1.0 - .25 * (1.0 - smoothstep(.0, .05, abs(xr))) * step(abs(q.y), .8);
      outColor = vec4(col * a, a);
    }`,
    colors: ({ dark }) =>
      dark
        ? [
            [0.58, 0.27, 0.13],
            [0.7, 0.47, 0.18],
          ]
        : [
            [0.71, 0.32, 0.15],
            [0.85, 0.58, 0.2],
          ],
  },
  // Summer nights: fireflies that wander over the meadow and glow on and off. A is the core, B the
  // halo.
  fireflies: {
    density: 40,
    min: 18,
    max: 60,
    fps: 30,
    vs: `${HEAD}
    out float v_alpha;
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
    fs: `${FS_HEAD}
    in float v_alpha;
    void main() {
      float d = length(gl_PointCoord - .5) * 2.0;
      float core = exp(-d*d*38.0);
      float halo = exp(-d*d*5.0) * .75;
      float a = (core + halo) * v_alpha;
      vec3 col = mix(u_colorB, u_colorA, core / (core + halo + 1e-4));
      // Less alpha than color, so the glow adds light like it would at night.
      outColor = vec4(col * a, a * .7);
    }`,
    colors: () => [
      [1.0, 0.98, 0.72],
      [0.74, 0.9, 0.32],
    ],
  },
  // Summer days: soft dandelion fluff and pollen drifting on the breeze, the pollen catching the
  // light. A is the seeds' color, B the pollen's. Without fluff (`share` 0), it's motes in the sun.
  seeds: {
    density: 70,
    min: 30,
    max: 110,
    fps: 30,
    vs: `${HEAD}
    out float v_alpha, v_kind;
    void main() {
      float id = float(gl_VertexID) + 1.0;
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
      float seed = step(1.0 - u_share, r5);
      float z = mix(.3, 1.0, r3);
      float t = u_time;
      float x = r1*2.0-1.0 + windX(mix(.35, 1.0, z)) + sin(t*mix(.2, .5, r2) + r4*6.28) * .02;
      float y = r2*2.0-1.0 + t * mix(.004, .014, r4) * u_fall + sin(t*mix(.3, .7, r4) + r1*6.28) * .05;
      x = wrapX(x, .15);
      y = -1.15 + mod(y + 1.15, 2.3);
      gl_Position = vec4(x, y, 0.0, 1.0);
      gl_PointSize = max(1.0, u_dpr * (seed > .5 ? mix(8.0, 16.0, z) : mix(2.5, 5.5, z)) * u_size);
      float glint = seed > .5 ? 1.0 : .45 + .55 * pow(.5 + .5*sin(t*mix(1.0, 2.6, r4) + r2*6.28), 3.0);
      v_alpha = mix(.45, .95, z) * glint * u_opacity;
      v_kind = seed;
    }`,
    fs: `${FS_HEAD}
    in float v_alpha, v_kind;
    void main() {
      vec2 q = (gl_PointCoord - .5) * 2.0;
      float r = length(q);
      float a;
      vec3 col;
      if (v_kind > .5) {
        // A soft tuft of fluff around a small, brighter core.
        float fluff = smoothstep(1.0, .2, r) * .7;
        float core = smoothstep(.32, .08, r) * .8;
        a = clamp(fluff + core, 0.0, 1.0) * v_alpha;
        col = u_colorA;
      } else {
        a = smoothstep(1.0, .2, r) * v_alpha;
        col = u_colorB;
      }
      outColor = vec4(col * a, a);
    }`,
    colors: ({ dark, background }) =>
      dark || background
        ? [
            [1.0, 0.99, 0.93],
            [1.0, 0.93, 0.66],
          ]
        : [
            [0.54, 0.5, 0.4],
            [0.72, 0.58, 0.26],
          ],
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
    vs: `${HEAD}
    const vec2 CORNERS[6] = vec2[6](vec2(-1,-1), vec2(1,-1), vec2(1,1), vec2(-1,-1), vec2(1,1), vec2(-1,1));
    out float v_alpha, v_depth, v_width;
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
      v_width = .6 * u_dpr * 2.0 / size;
      // x: along the streak, toward its falling end; y: across it.
      vec2 corner = CORNERS[gl_VertexID % 6];
      v_q = vec2(corner.x, corner.y * v_width * 2.5);
      vec2 dir = normalize(vec2(slant, -1.0));
      vec2 offset = v_q.x * dir + v_q.y * vec2(-dir.y, dir.x);
      // A hidden streak collapses to its center, so it covers no pixels.
      gl_Position = vec4(vec2(x, y) + (shown < .01 ? vec2(0) : offset * size / u_res), 0.0, 1.0);
      v_alpha = mix(.25, .6, z) * shown * u_opacity * bandFade(y);
      v_depth = z;
    }`,
    fs: `${FS_HEAD}
    in float v_alpha, v_depth, v_width;
    in vec2 v_q;
    void main() {
      float along = v_q.x, across = abs(v_q.y);
      float a = (1.0 - smoothstep(v_width, v_width * 2.5, across)) * smoothstep(1.0, .1, abs(along)) * mix(.35, 1.0, along * .5 + .5) * v_alpha;
      vec3 col = mix(u_colorB, u_colorA, v_depth);
      outColor = vec4(col * a, a);
    }`,
    colors: ({ dark, background }) =>
      dark
        ? [
            [0.8, 0.87, 0.96],
            [0.56, 0.66, 0.8],
          ]
        : background
          ? [
              [0.4, 0.48, 0.6],
              [0.58, 0.65, 0.75],
            ]
          : [
              [0.4, 0.5, 0.63],
              [0.6, 0.68, 0.78],
            ],
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
    vs: `${HEAD}
    uniform float u_shimmer, u_peakTime, u_peakSize;
    // How often each speck glints, in seconds (glitterCycle).
    uniform float u_cycle;
    out float v_alpha;
    void main() {
      float id = float(gl_VertexID) + 1.0;
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
      int zi = int(min(floor(r5 * u_zoneCount), u_zoneCount - 1.0));
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
    fs: `${FS_HEAD}
    in float v_alpha;
    void main() {
      float d = length(gl_PointCoord - .5) * 2.0;
      float a = exp(-d * d * 4.0) * (1.0 - smoothstep(.8, 1.0, d)) * v_alpha;
      vec3 col = mix(u_colorB, u_colorA, exp(-d * d * 9.0));
      outColor = vec4(col * a, a);
    }`,
    colors: ({ dark, background }) =>
      dark || background
        ? [
            [1.0, 1.0, 1.0],
            [0.9, 0.95, 1.0],
          ]
        : [
            [0.36, 0.52, 0.7],
            [0.55, 0.68, 0.8],
          ],
  },
  // Summer by the water: small groups of midges, a pixel or two each, idling over the water; a
  // share (`share`) glint by day. `zones` places them: three quarters of the groups in the first,
  // the rest in the second. At night `glow` fireflies wander on their own in the third, along the
  // bank. A is the midges' color, B the glints' and fireflies'.
  insects: {
    density: 18,
    min: 9,
    max: 30,
    fps: 60,
    vs: `${HEAD}
    out float v_alpha, v_kind;
    void main() {
      float id = float(gl_VertexID) + 1.0;
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
      float firefly = step(float(gl_VertexID) + .5, u_glow);
      vec2 p;
      if (firefly > .5) {
        // Wandering slowly along the bank.
        vec4 zone = u_zones[2];
        float t = u_time * u_tempo * mix(.05, .09, r4);
        p = vec2(mix(zone.x, zone.z, r1) + sin(t*2.1 + r4*6.28)*.04, mix(zone.w, zone.y, r2) + sin(t*3.3 + r5*6.28)*.015);
      } else {
        // Groups of three, each idling about a point that drifts slowly with the wind.
        float group = floor((float(gl_VertexID) - u_glow) / 3.0);
        float s1 = hash(group*7.3+1.0), s2 = hash2(group*3.1+2.0);
        vec4 zone = u_zones[hash(group*5.9+4.0) < .75 ? 0 : 1];
        vec2 c = vec2(mix(zone.x, zone.z, s1) + sin(u_time*.03 + s2*6.28)*.05 + windX(1.0), mix(zone.w, zone.y, s2));
        float t = u_time * u_tempo * mix(.4, .7, r4);
        vec2 o = vec2(sin(t*2.3 + r2*6.28) + .5*sin(t*4.1 + r3*6.28), cos(t*1.9 + r3*6.28) + .5*sin(t*3.7 + r2*6.28));
        p = c + o * vec2(.03 * u_res.y / u_res.x, .03) * mix(.6, 1.2, r5);
      }
      p.x = wrapX(p.x, .1);
      gl_Position = vec4(p, 0.0, 1.0);
      float z = mix(.4, 1.0, r3);
      float special = max(firefly, step(1.0 - u_share, hash(id*1.91+5.0)));
      // A firefly's glow: quick on, slower off, then dark for the rest of its cycle.
      float ph = fract(u_time / mix(4.0, 7.0, r5) + r1);
      float glow = smoothstep(0.0, .12, ph) * (1.0 - smoothstep(.18, .6, ph));
      v_kind = special + firefly;
      v_alpha = mix(mix(.5, .9, z) * (.8 + .2*sin(u_time*17.0 + r2*6.28)), glow, firefly) * u_opacity;
      gl_PointSize = v_alpha < .01 ? 0.0 : u_dpr * u_size * mix(max(1.0, mix(1.0, 2.2, z)), mix(9.0, 16.0, z), firefly);
    }`,
    fs: `${FS_HEAD}
    // 0 for a midge, 1 for one that glints, 2 for a firefly.
    in float v_alpha, v_kind;
    void main() {
      float d = length(gl_PointCoord - .5) * 2.0;
      float firefly = step(1.5, v_kind);
      float a = mix(smoothstep(1.1, .2, d), exp(-d*d*38.0) + exp(-d*d*5.0)*.6, firefly) * v_alpha;
      vec3 col = mix(u_colorA, u_colorB, min(v_kind, 1.0));
      outColor = vec4(col * a, a * mix(1.0, .7, firefly));
    }`,
    colors: ({ dark, background }) =>
      dark
        ? [
            [0.6, 0.66, 0.76],
            [1.0, 0.98, 0.72],
          ]
        : background
          ? [
              [0.16, 0.15, 0.12],
              [1.0, 0.96, 0.82],
            ]
          : [
              [0.3, 0.3, 0.28],
              [0.72, 0.58, 0.26],
            ],
  },
  // Night mist: wide, soft banks of uneven density that drift along a band near the horizon. Each
  // bank is one quad. A is the thick parts' color, B the thin parts'.
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
    vs: `${HEAD}
    out vec2 v_uv, v_p;
    out float v_alpha;
    const vec2 CORNERS[6] = vec2[6](vec2(-1, -1), vec2(1, -1), vec2(-1, 1), vec2(-1, 1), vec2(1, -1), vec2(1, 1));
    void main() {
      float id = float(gl_VertexID / 6) + 1.0;
      vec2 c = CORNERS[gl_VertexID % 6];
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
      float z = mix(.4, 1.0, r3);
      // With zones, each bank keeps to one: its rows are the band, and it fades out as it drifts
      // past the zone's sides.
      vec4 zone = vec4(-1e3, u_band.x, 1e3, u_band.y);
      float gain = 1.0;
      if (u_zoneCount > .5) {
        int zi = int(min(floor(hash(id*7.73+1.3) * u_zoneCount), u_zoneCount - 1.0));
        zone = u_zones[zi];
        gain = u_zoneGain[zi];
      }
      // Half the bank's width and height in clip space: wide and low, up to half the band tall.
      float band = zone.y - zone.w;
      vec2 half_ = vec2(mix(.35, .75, r4) * u_size, band * mix(.25, .5, r5));
      float cy = mix(zone.w + half_.y * .6, zone.y - half_.y * .6, r2);
      float cx = wrapX(r1*2.0-1.0 + windX(z) + sin(u_time*.03 + r5*6.28) * .03, half_.x);
      gl_Position = vec4(vec2(cx, cy) + c * half_, 0.0, 1.0);
      v_uv = c;
      // The texture's coordinates, in screen heights, move with the bank.
      v_p = c * half_ * vec2(u_res.x / u_res.y, 1.0) * .5 + r1 * 17.0;
      v_alpha = .22 * u_opacity * mix(.5, 1.0, z) * (.7 + .3 * sin(u_time * mix(.05, .12, r4) + r1 * 6.28));
      v_alpha *= gain * smoothstep(.35, 0.0, max(zone.x - cx, cx - zone.z));
    }`,
    // v_p and the noise need highp: in mediump the texture coordinate's fraction is too coarse at
    // 7 times its scale.
    fs: `${FS_HEAD}
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
      // Pixels this faint are discarded below anyway; skipping the noise there saves most of the
      // quad's corners.
      if (shape * v_alpha < .004) discard;
      float n = vnoise(v_p * 3.0) * .65 + vnoise(v_p * 7.0 + 4.0) * .35;
      float a = shape * smoothstep(.15, .85, n) * v_alpha;
      vec3 col = mix(u_colorB, u_colorA, n);
      outColor = vec4(col * a, a);
      if (outColor.a < .004) discard;
    }`,
    colors: ({ dark, background }) =>
      dark
        ? [
            [0.66, 0.74, 0.84],
            [0.5, 0.58, 0.7],
          ]
        : background
          ? [
              [1.0, 1.0, 1.0],
              [0.92, 0.95, 0.98],
            ]
          : [
              [0.7, 0.78, 0.86],
              [0.8, 0.86, 0.92],
            ],
  },
}

// A rectangle of the image, [left, top, right, bottom] as fractions of its width and height, and
// optionally a factor of glitter's or mist's opacity there.
type Zone = [number, number, number, number] | [number, number, number, number, number]

// An image's tuning of its preset, all optional:
// - `wind`: the sideways speed of the nearest items, in screen heights per second, positive to the
//   right. Farther items move slower. Everything in the air moves with it, so seeds fly sideways
//   in a wind that barely slants the rain.
// - `gust` (0 to 1): how far the wind rises and falls around that speed.
// - `shear`: how much stronger the wind gets below the horizon, as it picks up near the ground: at
//   the screen's foot it's 1 + shear times the wind, so falling snow arcs toward the side.
// - `amount`, `size`, `fall`, `opacity`: factors of the effect's item count, item size, falling
//   speed, and opacity.
// - `band`: [top, bottom], the rows the effect keeps to, as fractions of the image's height, so a
//   mist stays on the water however the photo is cropped. Without a band the effect fills the
//   screen.
// - `share`: the share of special items: fluff among seeds, glints among midges. `glow`: how many
//   fireflies fly apart from the midges.
// - `zones`: up to three rectangles of the image: where glitter lies, so it misses water (without
//   them, the ground below the horizon), where midges and fireflies keep, or where mist lies: each
//   bank keeps to one zone, in place of the band.
// - `tempo`: a factor of the effect's own motion: glitter's shimmer, the midges' flight.
// - `shimmer`, `peaks`, `peakTime`, `peakSize`: glitter's faint shimmer, and how many full glints
//   show at once on a 1440 × 900 screen, for how many seconds, and how much larger.
// - `colors`: in place of the effect's colors.
type Tuning = {
  wind?: number
  gust?: number
  shear?: number
  amount?: number
  size?: number
  fall?: number
  opacity?: number
  band?: [number, number]
  share?: number
  glow?: number
  zones?: Zone[]
  tempo?: number
  shimmer?: number
  peaks?: number
  peakTime?: number
  peakSize?: number
  colors?: Colors
}

// The Weather hint's name for a preset: `scene_effect_<hint>` in messages/.
export type Hint =
  | 'snow'
  | 'flurries'
  | 'blowing'
  | 'spray'
  | 'rain'
  | 'squall'
  | 'seeds'
  | 'motes'
  | 'dust'
  | 'fireflies'
  | 'midges'
  | 'midges_night'
  | 'leaves'
  | 'glitter'
  | 'frost'
  | 'mist'
  | 'none'

// `effect: null` is no weather. `fps` is the preset's frame-rate target, by default its effect's.
type Preset = Tuning & { effect: Effect | null; hint: Hint; fps?: number }

// Uniform values for the fields a preset and its image leave out.
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
  shimmer: 0.3,
  peaks: 1.2,
  peakTime: 1.5,
  peakSize: 2,
}

export const PRESETS = {
  snow: { effect: 'snow', hint: 'snow' },
  flurries: { effect: 'snow', hint: 'flurries', amount: 0.22, size: 1.45, fall: 0.75 },
  // After Kait's weather prototype: fine grains, falling fast, in gusts, blown flatter near the
  // ground.
  blowing: {
    effect: 'snow',
    hint: 'blowing',
    fps: 60,
    amount: 2.2,
    size: 0.9,
    fall: 6,
    gust: 0.6,
    shear: 2.5,
  },
  // Droplets torn off the waves: a pixel or two, flying nearly flat.
  spray: {
    effect: 'snow',
    hint: 'spray',
    fps: 60,
    amount: 0.8,
    size: 0.4,
    fall: 2.5,
    gust: 0.9,
    shear: 1.5,
  },
  rain: { effect: 'rain', hint: 'rain' },
  squall: { effect: 'rain', hint: 'squall', amount: 1.2, size: 1.35, fall: 1.25, gust: 0.8 },
  seeds: { effect: 'seeds', hint: 'seeds' },
  // A few pixels across, for the open coast, where big tufts looked too near.
  'seeds-fine': { effect: 'seeds', hint: 'seeds', size: 0.4 },
  motes: { effect: 'seeds', hint: 'motes', share: 0, size: 0.75, amount: 1.4, opacity: 0.8 },
  // Dust of a pixel, for a sunny day with nothing else in the air.
  'motes-fine': { effect: 'seeds', hint: 'dust', share: 0, size: 0.3, amount: 1.2, opacity: 0.85 },
  // Near-white, since sunlit dust is brighter than the hay behind it.
  dust: {
    effect: 'seeds',
    hint: 'dust',
    share: 0,
    size: 1.1,
    amount: 4,
    opacity: 1,
    gust: 0.4,
    colors: ({ dark, background }) =>
      dark || background
        ? [
            [1.0, 1.0, 0.97],
            [1.0, 0.99, 0.93],
          ]
        : EFFECTS.seeds.colors({ dark, background }),
  },
  fireflies: { effect: 'fireflies', hint: 'fireflies' },
  midges: { effect: 'insects', hint: 'midges', share: 0.25 },
  'midges-night': { effect: 'insects', hint: 'midges_night', share: 0, glow: 2 },
  leaves: { effect: 'leaves', hint: 'leaves' },
  glitter: { effect: 'glitter', hint: 'glitter', opacity: 0.85 },
  // By day the glints need more size to show on the bright snow.
  'glitter-day': { effect: 'glitter', hint: 'glitter', size: 1.4, shimmer: 0.4, peakSize: 2.6 },
  frost: { effect: 'glitter', hint: 'frost', opacity: 0.85 },
  'frost-day': { effect: 'glitter', hint: 'frost', size: 1.4, shimmer: 0.4, peakSize: 2.6 },
  mist: { effect: 'mist', hint: 'mist' },
  none: { effect: null, hint: 'none' },
} satisfies Record<string, Preset>

type PresetName = keyof typeof PRESETS

// An image's weather in a theme: its preset and the fields it changes.
type Entry = Tuning & { preset: PresetName }

// Each Baltic image's horizon, as a fraction of its height: where the sea, the ice, or the ground
// meets the sky or the tree line. Glitter grows toward the viewer below it, and shear starts
// there. A recomposed image (task 065) updates these, the bands, and the zones.
export const HORIZONS: Partial<Record<ImageId, number>> = {
  'coast-january': 0.38,
  'coast-february': 0.43,
  'coast-march': 0.51,
  'coast-april': 0.55,
  'coast-may': 0.53,
  'coast-june': 0.47,
  'coast-july': 0.74,
  'coast-august': 0.45,
  'coast-september': 0.48,
  'coast-october': 0.58,
  'coast-november': 0.43,
  'coast-december': 0.36,
  'land-january': 0.35,
  'land-february': 0.43,
  'land-march': 0.31,
  'land-april': 0.75,
  'land-may': 0.75,
  'land-june': 0.44,
  'land-july': 0.76,
  'land-august': 0.39,
  'land-september': 0.68,
  'land-october': 0.77,
  'land-november': 0.57,
  'land-december': 0.74,
}

// Where snow or frost lies in the glitter images, away from open water, where insects keep, and
// where fog lies.
const ZONES = {
  // Brighter on the ice than on the snowy shore, and brightest on the sunny side by day and
  // around the moon's path by night: each zone gets a third of the specks.
  'coast-january-day': [
    [0, 0.4, 0.55, 0.82, 0.9],
    [0.55, 0.4, 1, 0.82, 1.25],
    [0, 0.82, 1, 1, 0.5],
  ],
  'coast-january': [
    [0, 0.4, 0.62, 0.82, 0.8],
    [0.62, 0.4, 0.92, 0.75, 1.2],
    [0, 0.82, 1, 1, 0.4],
  ],
  'coast-december': [[0, 0.6, 1, 1]],
  // Fog over the bay and the far shore, low in the reeds right of the haystack, and thinner over
  // the near grass at the haystack's foot, so it stays off the haystack itself.
  'coast-september': [
    [0.25, 0.4, 1, 0.58, 1.2],
    [0.33, 0.5, 1, 0.78],
    [0, 0.72, 1, 0.97, 0.6],
  ],
  // The lake's snow away from the jetty, which doesn't glint. Each zone gets a third of the
  // specks, so the small second one, around the sun's and the moon's reflection, glints most.
  'land-february': [
    [0, 0.46, 0.7, 0.62],
    [0.7, 0.46, 1, 0.8, 1.25],
    [0.36, 0.62, 1, 1],
  ],
  'land-november': [[0, 0.6, 1, 1]],
  // By night, midges mostly by the cliff, the rest over the river, and the fireflies on the far
  // bank. By day, all by the cliff, where they show.
  'land-july': [
    [0.05, 0.64, 0.33, 0.9],
    [0.34, 0.82, 0.88, 0.97],
    [0.58, 0.68, 1, 0.78],
  ],
  'land-july-day': [
    [0.05, 0.64, 0.33, 0.9],
    [0.05, 0.64, 0.33, 0.9],
  ],
} satisfies Record<string, Zone[]>

function wx(preset: PresetName, tuning: Tuning = {}): Entry {
  return { preset, ...tuning }
}

// The mountain images' winds reproduce the drift each effect had before winds were per image.
function mountain(preset: 'snow' | 'rain' | 'seeds' | 'leaves' | 'fireflies') {
  const wind = { snow: -0.02, rain: 0.22, seeds: 0.028, leaves: 0.026, fireflies: 0 }[preset]
  return wx(preset, { wind })
}

// Early autumn's leaves, from land September's birches and rowans.
function birchLeaves({ dark }: { dark: boolean }): [Rgb, Rgb] {
  return dark
    ? [
        [0.66, 0.54, 0.16],
        [0.6, 0.3, 0.12],
      ]
    : [
        [0.84, 0.68, 0.18],
        [0.78, 0.36, 0.14],
      ]
}

// The coast's seeds and motes on a light page with the picture: warm mid-tones, since the default
// near-white vanishes against the pale coast skies.
function coastSpecks(scene: { dark: boolean; background: boolean }): [Rgb, Rgb] {
  if (scene.dark || !scene.background) return EFFECTS.seeds.colors(scene)
  return [
    [0.7, 0.68, 0.62],
    [0.62, 0.52, 0.34],
  ]
}

// Wet snow by day: the far flakes grey-blue, so they show against the pale sky.
function wetSnow(scene: { dark: boolean; background: boolean }): [Rgb, Rgb] {
  if (scene.dark || !scene.background) return EFFECTS.snow.colors(scene)
  return [
    [0.96, 0.97, 1],
    [0.64, 0.71, 0.8],
  ]
}

// Each image's weather on light and dark pages, from what it shows; task 066 records why.
export const IMAGE_WEATHER: Record<ImageId, { light: Entry; dark: Entry }> = {
  winter: { light: mountain('snow'), dark: mountain('snow') },
  spring: { light: mountain('rain'), dark: mountain('rain') },
  summer: { light: mountain('seeds'), dark: mountain('fireflies') },
  autumn: { light: mountain('leaves'), dark: mountain('leaves') },
  'coast-january': {
    light: wx('glitter-day', {
      zones: ZONES['coast-january-day'],
      amount: 4,
      size: 2.3,
      opacity: 1.05,
      shimmer: 0.8,
      tempo: 1.3,
      peaks: 3.3,
      peakTime: 2.6,
      peakSize: 2.3,
    }),
    // As land February's night.
    dark: wx('glitter', {
      zones: ZONES['coast-january'],
      size: 1.35,
      shimmer: 0.72,
      tempo: 1.15,
      peaks: 5.1,
      peakTime: 2.8,
    }),
  },
  'coast-february': {
    light: wx('blowing', {
      amount: 0.55,
      size: 1.2,
      opacity: 1.3,
      fall: 2.35,
      wind: 0.2,
      gust: 1,
      shear: 5,
    }),
    dark: wx('blowing', { amount: 0.2, size: 1.15, opacity: 0.85, fall: 3, wind: -0.24 }),
  },
  // Wet snow blowing in off the sea, on the right, falling faster than dry flakes.
  'coast-march': {
    light: wx('flurries', {
      wind: -0.15,
      gust: 0.5,
      shear: 1,
      amount: 0.6,
      size: 1.4,
      fall: 1.3,
      colors: wetSnow,
    }),
    dark: wx('flurries', { wind: -0.15, gust: 0.5, shear: 1, amount: 0.25, size: 1.2, fall: 1.3 }),
  },
  'coast-april': {
    light: wx('motes-fine', { wind: -0.02, size: 0.9, opacity: 0.95, colors: coastSpecks }),
    // Sea fog below the moon, clear of the cliff.
    dark: wx('mist', {
      wind: -0.01,
      band: [0.48, 0.72],
      zones: [[0, 0.48, 0.68, 0.72]],
      opacity: 0.8,
    }),
  },
  'coast-may': {
    light: wx('seeds-fine', { wind: 0.03, amount: 0.6, colors: coastSpecks }),
    dark: wx('seeds-fine', { wind: 0.03, amount: 0.45, opacity: 0.55 }),
  },
  'coast-june': {
    light: wx('seeds-fine', { wind: -0.08, gust: 0.4, colors: coastSpecks }),
    dark: wx('seeds-fine', { wind: -0.08, gust: 0.4, amount: 0.75, opacity: 0.75 }),
  },
  'coast-july': {
    light: wx('seeds-fine', { wind: 0.03, colors: coastSpecks }),
    dark: wx('fireflies', { amount: 0.3 }),
  },
  'coast-august': {
    light: wx('motes', { wind: 0.008, colors: coastSpecks }),
    // On the open water, fading out at the rocks on the left: across the rocks it lay as a flat
    // smear.
    dark: wx('mist', {
      wind: 0.01,
      zones: [[0.34, 0.42, 1, 0.6]],
      amount: 1.3,
      size: 1.3,
      opacity: 1.2,
    }),
  },
  'coast-september': {
    light: wx('seeds-fine', {
      wind: 0.16,
      gust: 0.5,
      fall: 0.5,
      size: 0.3,
      amount: 0.7,
      colors: coastSpecks,
    }),
    // Thick fog over the bay and the reed meadow, drifting the way the grass leans.
    dark: wx('mist', {
      wind: 0.012,
      zones: ZONES['coast-september'],
      amount: 1.6,
      size: 1.3,
      opacity: 1.1,
    }),
  },
  // The waves break from the right.
  'coast-october': {
    light: wx('squall', { wind: -0.6, amount: 1 }),
    dark: wx('squall', { wind: -0.6, amount: 1 }),
  },
  'coast-november': {
    light: wx('spray', { wind: -0.5, band: [0.3, 1.05] }),
    dark: wx('mist', { wind: -0.03, band: [0.32, 0.58] }),
  },
  'coast-december': {
    light: wx('frost-day', { zones: ZONES['coast-december'] }),
    dark: wx('frost', { zones: ZONES['coast-december'] }),
  },
  // Sparse snow on the stream; February's open lake has the room for glitter.
  'land-january': { light: wx('flurries'), dark: wx('flurries') },
  // Strong, or it doesn't show on the bright snow; very little snow instead if it still doesn't.
  'land-february': {
    light: wx('glitter-day', {
      zones: ZONES['land-february'],
      amount: 4,
      size: 2.8,
      opacity: 1.5,
      shimmer: 1,
      tempo: 1.7,
      peaks: 6,
      peakTime: 2.6,
      peakSize: 3,
    }),
    dark: wx('glitter', {
      zones: ZONES['land-february'],
      size: 1.35,
      opacity: 0.85,
      shimmer: 0.72,
      tempo: 1.15,
      peaks: 5.1,
      peakTime: 2.8,
    }),
  },
  // Wet snow over the thawing bog, in a gentler wind than on the coast.
  'land-march': {
    light: wx('flurries', {
      wind: 0.06,
      gust: 0.4,
      shear: 0.5,
      amount: 0.5,
      size: 1.3,
      fall: 1.3,
      colors: wetSnow,
    }),
    dark: wx('mist', { wind: 0.008, band: [0.3, 0.68], amount: 1.3, opacity: 1.3 }),
  },
  // By day, clear skies, as on the coast.
  'land-april': {
    light: wx('motes-fine', { wind: 0.01, size: 0.9, opacity: 0.95 }),
    // Ground mist at the foot of the near trunks, just above the flower bed, fainter along the far
    // trees, and hardly any by the manor.
    dark: wx('mist', {
      wind: 0.006,
      zones: [
        [0, 0.67, 0.42, 0.79, 1.1],
        [0.35, 0.64, 0.78, 0.76, 0.6],
      ],
      amount: 1.1,
      opacity: 0.75,
    }),
  },
  'land-may': {
    light: wx('seeds', { wind: 0.015, share: 0.5, amount: 2.5, size: 0.5 }),
    dark: wx('mist', { wind: 0.008, band: [0.66, 0.86] }),
  },
  'land-june': {
    light: wx('seeds', { wind: 0.015, amount: 2.5, size: 0.6, opacity: 0.9, gust: 0 }),
    dark: wx('fireflies', { amount: 2.2, size: 0.5, opacity: 0.75 }),
  },
  'land-july': {
    light: wx('midges', { wind: 0.005, zones: ZONES['land-july-day'], amount: 1.95, tempo: 1.15 }),
    dark: wx('midges-night', { wind: 0.005, zones: ZONES['land-july'] }),
  },
  'land-august': {
    light: wx('dust', { wind: 0.03 }),
    dark: wx('mist', { wind: 0.01, band: [0.32, 0.56] }),
  },
  'land-september': {
    light: wx('leaves', { wind: 0.07, gust: 0.5, amount: 0.15, colors: birchLeaves }),
    dark: wx('mist', { wind: 0.008, band: [0.57, 0.9], amount: 1.4, size: 1.2 }),
  },
  // Smaller and fainter, so they sit in the tinted picture rather than in front of it.
  'land-october': {
    light: wx('leaves', { wind: 0.04, amount: 1.3, size: 0.7, opacity: 0.65 }),
    // The moonlit trees are near grey, so the leaves are dull rust and olive, not bright orange.
    dark: wx('leaves', {
      wind: 0.04,
      size: 0.7,
      opacity: 0.6,
      colors: () => [
        [0.42, 0.3, 0.18],
        [0.5, 0.44, 0.26],
      ],
    }),
  },
  'land-november': {
    light: wx('frost-day', {
      zones: ZONES['land-november'],
      amount: 2.9,
      size: 2.4,
      opacity: 1.05,
      shimmer: 1,
      peaks: 2.9,
      peakTime: 2.6,
      peakSize: 3.1,
    }),
    // No moon, so the frost barely catches light: few, faint specks that change slowly.
    dark: wx('frost', {
      zones: ZONES['land-november'],
      amount: 1.8,
      size: 2.2,
      opacity: 0.55,
      tempo: 0.45,
      peaks: 0.5,
      peakTime: 3.6,
    }),
  },
  'land-december': {
    light: wx('snow', { amount: 0.3, fall: 0.8 }),
    dark: wx('snow', { amount: 0.2, fall: 0.8, opacity: 0.4 }),
  },
}

// An image's weather in a theme, resolved: its preset, then the image's horizon and fields.
export type Weather = Preset & { horizon?: number }

export function weatherFor(id: ImageId, theme: 'light' | 'dark'): Weather {
  const { preset, ...tuning } = IMAGE_WEATHER[id][theme]
  return { ...PRESETS[preset], horizon: HORIZONS[id], ...tuning }
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

// Why the weather can't run here, for the Weather hint: 'webgl' without WebGL 2, 'failed' when
// the shown effect didn't compile. SceneLayer sets it.
const [weatherProblem, setWeatherProblem] = createSignal<'webgl' | 'failed' | null>(null)
export { setWeatherProblem, weatherProblem }

// Whether the browser has WebGL 2 at all. A context can still fail to start, for example on a
// blocked GPU; createWeatherRenderer returns null then.
export function weatherSupported() {
  return typeof WebGL2RenderingContext !== 'undefined'
}

export type WeatherRenderer = {
  // Draws `weather`, which has an effect (see weatherFor), with its two colors. Throws if the
  // effect's shaders don't compile.
  start(weather: Weather & { effect: Effect }, colors: () => [Rgb, Rgb]): void
  stop(): void
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
  'u_zones',
  'u_zoneCount',
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
  'shimmer',
  'peakTime',
  'peakSize',
] as const

// The most backing pixels per CSS pixel the canvas has, whatever the screen's.
const MAX_DPR = 1.5

// One WebGL context for all effects; each effect's program compiles the first time it runs.
// `pace()` gives the factors for the point count and the speed. Null without WebGL 2, which
// weatherSupported() predicts without creating a context.
export function createWeatherRenderer(
  canvas: HTMLCanvasElement,
  pace: () => { density: number; speed: number },
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
  const programs: Partial<Record<Effect, Program>> = {}
  function program(name: Effect): Program {
    const cached = programs[name]
    if (cached) return cached
    const fx = EFFECTS[name]
    const p = gl.createProgram()
    gl.attachShader(p, compile(gl.VERTEX_SHADER, fx.vs))
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fx.fs))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) ?? 'Program failed to link')
    }
    const u = Object.fromEntries(
      UNIFORMS.map((n) => [n, gl.getUniformLocation(p, n)]),
    ) as Program['u']
    return (programs[name] = { p, u })
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
  let colors: (() => [Rgb, Rgb]) | null = null

  // What a frame draws with, worked out again only on a start or a resize.
  type Setup = ReturnType<typeof prepare>
  let setup: Setup | null = null
  function prepare(weather: Weather & { effect: Effect }, w: number, h: number, dpr: number) {
    const t = { ...TUNING, ...weather }
    const fx = EFFECTS[weather.effect]
    const zones = (t.zones ?? [[0, t.horizon ?? 1, 1, 1] as Zone])
      .slice(0, 3)
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
      program: program(weather.effect),
      band: bandClip(t.band, w, h),
      horizon: t.horizon === undefined ? FULL_BAND[1] : bandClip([t.horizon], w, h)[0],
      zones: [...zones.flat(), ...Array<number>((3 - zones.length) * 4).fill(0)],
      zoneCount: zones.length,
      zoneGain: [0, 1, 2].map((i) => t.zones?.[i]?.[4] ?? 1),
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
  function fps(weather: Weather & { effect: Effect }) {
    return weather.fps ?? EFFECTS[weather.effect].fps
  }
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
    if (!due) return
    elapsed += (Math.min(now - (last || now), 100) / 1000) * pace().speed
    last = now
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
      upload(setup)
    }
    const { u } = setup.program
    // The clear color is WebGL's default, transparent.
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform1f(u.u_time, elapsed)
    const [a, b] = colors()
    gl.uniform3f(u.u_colorA, ...a)
    gl.uniform3f(u.u_colorB, ...b)
    const count = Math.round(setup.count * pace().density)
    if (setup.fx.quads) gl.drawArrays(gl.TRIANGLES, 0, count * 6)
    else gl.drawArrays(gl.POINTS, 0, count)
  }
  // The uniforms that change only with the setup. A program keeps its uniforms, and only one
  // program is in use until the next start, which makes a new setup.
  function upload({ program: { p, u }, t, ...setup }: Setup) {
    gl.useProgram(p)
    gl.uniform2f(u.u_res, setup.w, setup.h)
    gl.uniform2f(u.u_band, setup.band[0], setup.band[1])
    gl.uniform1f(u.u_horizon, setup.horizon)
    gl.uniform4fv(u.u_zones, setup.zones)
    gl.uniform1f(u.u_zoneCount, setup.zoneCount)
    gl.uniform3fv(u.u_zoneGain, setup.zoneGain)
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
    start(weather, colorsFn) {
      program(weather.effect)
      if (!current || fps(weather) !== fps(current)) slower = 0
      current = weather
      colors = colorsFn
      setup = null
      if (raf) return
      last = 0
      prev = 0
      hz = 0
      gaps = []
      raf = requestAnimationFrame(frame)
    },
    stop,
    destroy() {
      stop()
      resize.disconnect()
      for (const { p } of Object.values(programs)) gl.deleteProgram(p)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
