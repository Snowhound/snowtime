// Seasonal scene for the sign-in page: a background image per season and theme, a tint that keeps
// text readable, and a WebGL weather effect per season. Winter's snow comes from
// design/backgrounds/snowtime_login_intro_with_backgrounds.html; the others follow its pattern.
// `scene.create()` returns a controller; `controller.el` is the element to place.
//
// The user's choices are settings in the shared prototype settings key (app-frame.js):
// `sceneSeason` ('auto' or a season, see seasons.js), `sceneBackground`, `sceneStrength` ('full',
// 'dimmed'), `sceneWeather`, and `sceneIntro` (play it
// on the first visit), plus the app-wide `surfaces` ('glass', 'solid'): whether cards let a
// background show through. `scene.settings` reads and writes them for auth.html, which has no frame.
;(() => {
  const BASE = '../design/backgrounds/'
  const SETTINGS_KEY = 'snowtime.prototypeSettings'
  const INTRO_SEEN_KEY = 'snowtime.introSeen'
  const DEFAULTS = { sceneSeason: 'auto', sceneBackground: true, sceneStrength: 'full', surfaces: 'glass', sceneWeather: true, sceneIntro: true }
  // `weather` names the effect for light and dark pages. The intro's lines and the tagline are in
  // seasons.js.
  const SEASONS = {
    winter: {
      label: 'Winter',
      weather: { light: 'snow', dark: 'snow' },
      hint: 'Falling snow.',
    },
    spring: {
      label: 'Spring',
      weather: { light: 'rain', dark: 'rain' },
      hint: 'A light spring shower.',
    },
    summer: {
      label: 'Summer',
      weather: { light: 'seeds', dark: 'fireflies' },
      hint: 'Drifting seeds by day, fireflies at night.',
    },
    autumn: {
      label: 'Autumn',
      weather: { light: 'leaves', dark: 'leaves' },
      hint: 'Falling leaves.',
    },
  }
  // How much of the page color covers the image, dark / light.
  const STRENGTHS = {
    full: { label: 'Full', dark: 0.3, light: 0.2 },
    dimmed: { label: 'Dimmed', dark: 0.55, light: 0.5 },
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const isDark = () => document.documentElement.classList.contains('dark')

  const settings = {
    get() {
      try {
        const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }
        return {
          sceneSeason: s.sceneSeason in SEASONS ? s.sceneSeason : 'auto',
          sceneBackground: s.sceneBackground !== false,
          sceneStrength: s.sceneStrength in STRENGTHS ? s.sceneStrength : DEFAULTS.sceneStrength,
          surfaces: s.surfaces === 'solid' ? 'solid' : 'glass',
          sceneWeather: s.sceneWeather !== false,
          sceneIntro: s.sceneIntro !== false,
        }
      } catch {
        return { ...DEFAULTS }
      }
    },
    set(patch) {
      try {
        const all = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...all, ...patch }))
      } catch {}
    },
  }
  const intro = {
    seen() {
      try {
        return localStorage.getItem(INTRO_SEEN_KEY) === '1'
      } catch {
        return false
      }
    },
    markSeen() {
      try {
        localStorage.setItem(INTRO_SEEN_KEY, '1')
      } catch {}
    },
    // Whether the intro plays on this visit.
    due() {
      return !reducedMotion.matches && settings.get().sceneIntro && !intro.seen()
    },
  }

  const style = document.createElement('style')
  style.textContent = `
    .scene { position: absolute; inset: 0; overflow: hidden; pointer-events: none; background: var(--background); transition: background-color .6s ease; }
    .scene-photo { position: absolute; inset: 0; background-size: cover; background-position: center; opacity: 0; transform: scale(1.02); transition: opacity .9s ease, transform 1.2s ease; }
    .scene[data-background='on'] .scene-photo-light { opacity: 1; transform: scale(1.01); }
    .dark .scene[data-background='on'] .scene-photo-light { opacity: 0; }
    .dark .scene[data-background='on'] .scene-photo-dark { opacity: 1; transform: scale(1.01); }
    /* The page color over the image, stronger toward the bottom, where the text sits. */
    .scene-tint { position: absolute; inset: 0; transition: background .8s ease;
      background: linear-gradient(180deg, color-mix(in srgb, var(--background) calc(var(--scene-tint) * 70%), transparent), color-mix(in srgb, var(--background) min(100%, calc(var(--scene-tint) * 115%)), transparent)); }
    .scene[data-background='off'] .scene-tint, .scene[data-background='off'] .scene-vignette { opacity: 0; }
    .scene-vignette { position: absolute; inset: 0; background: radial-gradient(circle at 50% 50%, transparent 0 35%, rgb(0 0 0 / .14) 75%, rgb(0 0 0 / .32) 100%); transition: opacity .8s ease; }
    :root:not(.dark) .scene-vignette { background: radial-gradient(circle at 50% 50%, transparent 0 35%, rgb(216 227 239 / .28) 100%); }
    .scene canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; opacity: 0; transition: opacity .5s ease; }
    .scene[data-weather='on'] canvas { opacity: 1; }
    @media (prefers-reduced-motion: reduce) { .scene, .scene * { transition: none !important; } }
  `
  document.head.append(style)

  // --- Weather: points in one draw call, positions computed in the vertex shader ----------------
  // Every effect draws `count` points with no buffers: each point's randomness comes from
  // gl_VertexID. Colors come from `colors({ dark, background })` as two RGB triples.
  const HEAD = `#version 300 es
  precision highp float;
  uniform vec2 u_res;
  uniform float u_time, u_dpr;
  float hash(float n){ return fract(sin(n*127.1)*43758.5453123); }
  float hash2(float n){ return fract(sin(n*269.5+31.7)*17358.5453123); }
  `
  const FS_HEAD = `#version 300 es
  precision highp float;
  uniform vec3 u_colorA, u_colorB;
  out vec4 outColor;
  `
  const EFFECTS = {
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
        if (outColor.a < .02) discard;
      }`,
      // White on the dark scene and on the light image; on the plain light page white flakes would
      // vanish, so they turn blue-grey there.
      colors: ({ dark, background }) =>
        dark ? [[0.96, 0.98, 1.0], [0.66, 0.78, 0.9]] : background ? [[1.0, 1.0, 1.0], [0.9, 0.94, 0.98]] : [[0.44, 0.58, 0.69], [0.72, 0.83, 0.9]],
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
        gl_PointSize = u_dpr * mix(12.0, 30.0, z) * mix(.85, 1.15, r5);
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
        if (outColor.a < .02) discard;
      }`,
      colors: ({ dark }) => (dark ? [[0.58, 0.27, 0.13], [0.7, 0.47, 0.18]] : [[0.71, 0.32, 0.15], [0.85, 0.58, 0.2]]),
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
        if (a < .01) discard;
      }`,
      colors: () => [[1.0, 0.98, 0.72], [0.74, 0.9, 0.32]],
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
        if (outColor.a < .02) discard;
      }`,
      colors: ({ dark, background }) =>
        dark || background ? [[1.0, 0.99, 0.93], [1.0, 0.93, 0.66]] : [[0.54, 0.5, 0.4], [0.72, 0.58, 0.26]],
    },
    // Spring: a light shower of thin slanted streaks that comes in soft bursts. A is the near
    // streaks' color, B the far ones'.
    rain: {
      density: 260,
      min: 90,
      max: 450,
      vs: `${HEAD}
      const float SLANT = .22; // sideways pixels per pixel of fall
      out float v_alpha, v_depth, v_width;
      void main() {
        float id = float(gl_VertexID) + 1.0;
        float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0);
        float z = mix(.35, 1.0, pow(r3, 1.3));
        float fall = u_time * mix(1.1, 2.0, z);
        float y = 1.2 - mod((1.2 - (r2*2.0-1.0)) + fall, 2.4);
        float x = r1*2.0-1.0 + fall * SLANT * u_res.y / u_res.x;
        x = -1.15 + mod(x + 1.15, 2.3);
        gl_Position = vec4(x, y, 0.0, 1.0);
        // Bursts: the shower's strength rises and falls, and each streak shows above its own level.
        float level = mix(.1, 1.0, smoothstep(.15, .85, .5 + .5*sin(u_time*.23 + sin(u_time*.07)*2.0)));
        float shown = smoothstep(r4 - .1, r4, level);
        float size = u_dpr * mix(14.0, 30.0, z);
        gl_PointSize = shown < .01 ? 0.0 : size;
        v_alpha = mix(.25, .6, z) * shown;
        v_depth = z;
        // Half a streak's width in point coordinates: about 0.6 px.
        v_width = .6 * u_dpr * 2.0 / size;
      }`,
      fs: `${FS_HEAD}
      in float v_alpha, v_depth, v_width;
      void main() {
        vec2 q = (gl_PointCoord - .5) * 2.0;
        vec2 dir = normalize(vec2(.22, 1.0));
        float across = abs(dot(q, vec2(-dir.y, dir.x)));
        float along = dot(q, dir);
        float a = (1.0 - smoothstep(v_width, v_width * 2.5, across)) * smoothstep(1.0, .1, abs(along)) * mix(.35, 1.0, along * .5 + .5) * v_alpha;
        vec3 col = mix(u_colorB, u_colorA, v_depth);
        outColor = vec4(col * a, a);
        if (outColor.a < .01) discard;
      }`,
      colors: ({ dark, background }) =>
        dark ? [[0.8, 0.87, 0.96], [0.56, 0.66, 0.8]] : background ? [[0.4, 0.48, 0.6], [0.58, 0.65, 0.75]] : [[0.4, 0.5, 0.63], [0.6, 0.68, 0.78]],
    },
  }

  // One WebGL context for all effects; each effect's program compiles the first time it runs.
  function renderer(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
    if (!gl) return null
    const compile = (type, src) => {
      const sh = gl.createShader(type)
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
      return sh
    }
    const programs = {}
    function program(name) {
      if (programs[name]) return programs[name]
      const fx = EFFECTS[name]
      const p = gl.createProgram()
      gl.attachShader(p, compile(gl.VERTEX_SHADER, fx.vs))
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fx.fs))
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
      const u = Object.fromEntries(['u_res', 'u_time', 'u_dpr', 'u_colorA', 'u_colorB'].map((n) => [n, gl.getUniformLocation(p, n)]))
      return (programs[name] = { p, u })
    }
    gl.bindVertexArray(gl.createVertexArray())
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    let raf = 0
    let last = 0
    let elapsed = 0
    let current = null
    let colors = null
    function frame(now) {
      raf = requestAnimationFrame(frame)
      // About 45 fps is plenty for slow effects and halves the GPU work on 120 Hz screens.
      if (now - last < 22) return
      elapsed += Math.min(now - (last || now), 100) / 1000
      last = now
      const dpr = Math.min(devicePixelRatio || 1, 1.5)
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
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
      // Point counts scale with the drawn area, relative to a 1440 x 900 viewport.
      const area = (canvas.clientWidth * canvas.clientHeight) / (1440 * 900)
      gl.drawArrays(gl.POINTS, 0, Math.round(Math.min(fx.max, Math.max(fx.min, fx.density * area))))
    }
    return {
      // Throws if the effect's shaders don't compile.
      start(name, colorsFn) {
        program(name)
        current = name
        colors = colorsFn
        if (raf) return
        last = 0
        raf = requestAnimationFrame(frame)
      },
      stop() {
        cancelAnimationFrame(raf)
        raf = 0
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
      },
    }
  }

  // --- Controller ------------------------------------------------------------------------------
  function create({ season = 'winter', strength = 'full', background = true, weather = true } = {}) {
    const el = document.createElement('div')
    el.className = 'scene'
    el.setAttribute('aria-hidden', 'true')
    el.innerHTML = `<div class="scene-photo scene-photo-light"></div><div class="scene-photo scene-photo-dark"></div>
      <div class="scene-tint"></div><div class="scene-vignette"></div><canvas></canvas>`
    const state = { season, strength, background, weather }
    const fx = renderer(el.querySelector('canvas'))
    const failed = new Set()
    const colors = () => EFFECTS[effect()].colors({ dark: isDark(), background: state.background })
    const effect = () => (SEASONS[state.season] ?? SEASONS.winter).weather[isDark() ? 'dark' : 'light']

    function render() {
      const dark = isDark()
      el.querySelector('.scene-photo-light').style.backgroundImage = `url("${BASE}${state.season}-light-01.webp")`
      el.querySelector('.scene-photo-dark').style.backgroundImage = `url("${BASE}${state.season}-dark-01.webp")`
      el.style.setProperty('--scene-tint', STRENGTHS[state.strength][dark ? 'dark' : 'light'])
      el.dataset.background = state.background ? 'on' : 'off'
      let on = state.weather && !!fx && !failed.has(effect()) && !reducedMotion.matches && !document.hidden
      if (on) {
        try {
          fx.start(effect(), colors)
        } catch (error) {
          console.warn(`Weather effect ${effect()} unavailable:`, error)
          failed.add(effect())
          on = false
        }
      }
      if (!on) fx?.stop()
      el.dataset.weather = on ? 'on' : 'off'
    }
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    document.addEventListener('visibilitychange', render)
    reducedMotion.addEventListener('change', render)
    render()

    return {
      el,
      set(patch) {
        Object.assign(state, patch)
        render()
      },
      get: () => ({ ...state }),
      // Why the weather can't show right now, or null.
      weatherBlocked() {
        if (reducedMotion.matches) return 'Off while your device reduces motion.'
        if (!fx) return 'Your browser has no WebGL 2.'
        if (failed.has(effect())) return "This season's weather didn't start in your browser."
        return null
      },
    }
  }

  window.scene = { create, settings, intro, SEASONS, EFFECTS, STRENGTHS, DEFAULTS, reducedMotion }
})()
