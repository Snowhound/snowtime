// The seasonal scene's weather (prototypes/scene.js, prototypes/README.md, "Weather"): one WebGL 2
// canvas that draws a season's effect as points, or rain as thin quads, in one call with no
// buffers; each item's randomness comes from gl_VertexID and its position from the vertex shader.
// SceneLayer (src/components/scene-layer.tsx) runs it.
import { createSignal } from 'solid-js'
import type { Season } from './scene'

export type Effect = 'snow' | 'rain' | 'seeds' | 'fireflies' | 'leaves'

type Rgb = [number, number, number]

type EffectDef = {
  // Points per 1440 × 900, and the bounds for other sizes.
  density: number
  min: number
  max: number
  vs: string
  fs: string
  // Draw each item as a quad of two triangles (six vertices) instead of a point.
  quads?: boolean
  // A and B: two colors each effect mixes, for dark pages and for the image or the plain page.
  colors: (scene: { dark: boolean; background: boolean }) => [Rgb, Rgb]
}

// Each season's effect on light and dark pages.
export const SEASON_EFFECTS: Record<Season, { light: Effect; dark: Effect }> = {
  winter: { light: 'snow', dark: 'snow' },
  spring: { light: 'rain', dark: 'rain' },
  summer: { light: 'seeds', dark: 'fireflies' },
  autumn: { light: 'leaves', dark: 'leaves' },
}

// Factors of the sign-in page's point count and speed. App pages run calm, since the full
// weather felt busy behind real work.
export const PACES = {
  full: { density: 1, speed: 1 },
  calm: { density: 0.5, speed: 0.7 },
} as const

export type Pace = keyof typeof PACES

const HEAD = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_dpr;
float hash(float n){ return fract(sin(n*127.1)*43758.5453123); }
float hash2(float n){ return fract(sin(n*269.5+31.7)*17358.5453123); }
`
// mediump: the fragment shaders only shape a point's pixels, and it's cheaper on mobile GPUs.
const FS_HEAD = `#version 300 es
precision mediump float;
uniform vec3 u_colorA, u_colorB;
out vec4 outColor;
`
export const EFFECTS: Record<Effect, EffectDef> = {
  // Winter's snow, from the mock-up. A is the near flakes' color, B the far ones'.
  snow: {
    density: 500,
    min: 150,
    max: 900,
    vs: `${HEAD}
    out float v_alpha, v_depth, v_rnd;
    void main() {
      float id = float(gl_VertexID) + 1.0;
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0);
      float z = mix(.22, 1.0, pow(r3, 1.8));
      float t = u_time * .15 * mix(.18, .60, z);
      float x = r1 * 2.0 - 1.0;
      float y = r2 * 2.0 - 1.0;
      y = 1.18 - mod((1.18-y) + t*(1.0+r4*.55), 2.36);
      x += -2.5 * (1.0-z*.38) * t * .18;
      x += sin((y+r4*6.28)*4.5 + u_time*(.35+r3)) * (.008 + .035*(1.0-z));
      x = -1.15 + mod(x+1.15, 2.30);
      x *= mix(.88, 1.08, z);
      // The mock-up divided x by the aspect ratio, which left the sides of wide screens bare.
      gl_Position = vec4(x, y, 0.0, 1.0);
      gl_PointSize = 1.15 * u_dpr * mix(.8, 2.75, z);
      v_alpha = mix(.15,.82,z) * mix(.72,1.0,r4);
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
    vs: `${HEAD}
    out float v_alpha, v_rnd, v_angle, v_flip;
    void main() {
      float id = float(gl_VertexID) + 1.0;
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
      float z = mix(.35, 1.0, pow(r3, 1.5));
      float t = u_time;
      float y = 1.25 - mod((1.25 - (r2*2.0-1.0)) + t * mix(.05, .12, z) * (.8 + r4*.5), 2.5);
      float swing = t * mix(1.0, 1.8, r5) + r4*6.28;
      // Drift with the wind, plus a pendulum sway that's wider for near leaves.
      float x = r1*2.0-1.0 + t*.02*(.6+z) + sin(swing) * mix(.03, .08, z) * u_res.y / u_res.x;
      x = -1.15 + mod(x + 1.15, 2.3);
      gl_Position = vec4(x, y, 0.0, 1.0);
      gl_PointSize = u_dpr * mix(10.0, 26.0, z) * mix(.85, 1.15, r5);
      v_angle = r1*6.28 + t*mix(-.7, .7, r2) + cos(swing)*.6;
      v_flip = cos(t*mix(.7, 1.8, r4) + r3*6.28);
      v_alpha = mix(.5, .95, z);
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
  // Summer nights: fireflies that wander over the meadow and glow on and off. A is the core, B the halo.
  fireflies: {
    density: 40,
    min: 18,
    max: 60,
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
      v_alpha = glow * mix(.6, 1.0, z);
      gl_PointSize = v_alpha < .01 ? 0.0 : u_dpr * mix(9.0, 18.0, z);
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
  // Summer days: soft dandelion fluff and pollen drifting on the breeze, the pollen catching the light.
  // A is the seeds' color, B the pollen's.
  seeds: {
    density: 70,
    min: 30,
    max: 110,
    vs: `${HEAD}
    out float v_alpha, v_kind;
    void main() {
      float id = float(gl_VertexID) + 1.0;
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
      float seed = step(.7, r5);
      float z = mix(.3, 1.0, r3);
      float t = u_time;
      float x = r1*2.0-1.0 + t * mix(.012, .035, z) + sin(t*mix(.2, .5, r2) + r4*6.28) * .02;
      float y = r2*2.0-1.0 + t * mix(.004, .014, r4) + sin(t*mix(.3, .7, r4) + r1*6.28) * .05;
      x = -1.15 + mod(x + 1.15, 2.3);
      y = -1.15 + mod(y + 1.15, 2.3);
      gl_Position = vec4(x, y, 0.0, 1.0);
      gl_PointSize = u_dpr * (seed > .5 ? mix(8.0, 16.0, z) : mix(2.5, 5.5, z));
      float glint = seed > .5 ? 1.0 : .45 + .55 * pow(.5 + .5*sin(t*mix(1.0, 2.6, r4) + r2*6.28), 3.0);
      v_alpha = mix(.45, .95, z) * glint;
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
  // Spring: a light shower of thin slanted streaks that comes in soft bursts. A is the near
  // streaks' color, B the far ones'.
  rain: {
    density: 260,
    min: 90,
    max: 450,
    // Each streak is a thin quad along its slant, since a point covering it would shade about
    // 15 times as many pixels, nearly all of them transparent.
    quads: true,
    vs: `${HEAD}
    const float SLANT = .22; // sideways pixels per pixel of fall
    const vec2 CORNERS[6] = vec2[6](vec2(-1,-1), vec2(1,-1), vec2(1,1), vec2(-1,-1), vec2(1,1), vec2(-1,1));
    out float v_alpha, v_depth, v_width;
    out vec2 v_q;
    void main() {
      float id = float(gl_VertexID / 6) + 1.0;
      float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0);
      float z = mix(.35, 1.0, pow(r3, 1.3));
      float fall = u_time * mix(1.0, 1.7, z);
      float y = 1.2 - mod((1.2 - (r2*2.0-1.0)) + fall, 2.4);
      float x = r1*2.0-1.0 + fall * SLANT * u_res.y / u_res.x;
      x = -1.15 + mod(x + 1.15, 2.3);
      // Bursts: the shower's strength rises and falls, and each streak shows above its own level.
      float level = mix(.1, 1.0, smoothstep(.15, .85, .5 + .5*sin(u_time*.23 + sin(u_time*.07)*2.0)));
      float shown = smoothstep(r4 - .1, r4, level);
      // The streak's length in pixels; it spans -1 to 1 along its slant.
      float size = u_dpr * mix(14.0, 30.0, z);
      // Half a streak's width in the same units: about 0.6 px, fading out by 2.5 times that.
      v_width = .6 * u_dpr * 2.0 / size;
      // x: along the streak, toward its falling end; y: across it.
      vec2 corner = CORNERS[gl_VertexID % 6];
      v_q = vec2(corner.x, corner.y * v_width * 2.5);
      vec2 dir = normalize(vec2(SLANT, -1.0));
      vec2 offset = v_q.x * dir + v_q.y * vec2(-dir.y, dir.x);
      // A hidden streak collapses to its center, so it covers no pixels.
      gl_Position = vec4(vec2(x, y) + (shown < .01 ? vec2(0) : offset * size / u_res), 0.0, 1.0);
      v_alpha = mix(.22, .45, z) * shown;
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
  // Throws if the effect's shaders don't compile.
  start(effect: Effect, colors: () => [Rgb, Rgb]): void
  stop(): void
  // Stops and frees the context.
  destroy(): void
}

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
  const UNIFORMS = ['u_res', 'u_time', 'u_dpr', 'u_colorA', 'u_colorB'] as const
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
  })
  resize.observe(canvas)

  let raf = 0
  let last = 0
  let elapsed = 0
  let current: Effect | null = null
  let colors: (() => [Rgb, Rgb]) | null = null
  function frame(now: number) {
    raf = requestAnimationFrame(frame)
    // About 30 fps on 60, 90, 120, and 144 Hz screens: plenty for slow effects, and each frame
    // also redraws the blur of the glass surfaces over the canvas.
    if (now - last < 30 || !current || !colors) return
    elapsed += (Math.min(now - (last || now), 100) / 1000) * pace().speed
    last = now
    const dpr = Math.min(devicePixelRatio || 1, 1.5)
    const w = Math.max(1, Math.floor(cssWidth * dpr))
    const h = Math.max(1, Math.floor(cssHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      gl.viewport(0, 0, w, h)
    }
    const fx = EFFECTS[current]
    const { p, u } = program(current)
    gl.useProgram(p)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform2f(u.u_res, w, h)
    gl.uniform1f(u.u_time, elapsed)
    gl.uniform1f(u.u_dpr, dpr)
    const [a, b] = colors()
    gl.uniform3f(u.u_colorA, ...a)
    gl.uniform3f(u.u_colorB, ...b)
    // Point counts scale with the drawn area, relative to a 1440 × 900 viewport.
    const area = (cssWidth * cssHeight) / (1440 * 900)
    const count = Math.min(fx.max, Math.max(fx.min, fx.density * area)) * pace().density
    if (fx.quads) gl.drawArrays(gl.TRIANGLES, 0, Math.round(count) * 6)
    else gl.drawArrays(gl.POINTS, 0, Math.round(count))
  }
  function stop() {
    cancelAnimationFrame(raf)
    raf = 0
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }
  return {
    start(name, colorsFn) {
      program(name)
      current = name
      colors = colorsFn
      if (raf) return
      last = 0
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
