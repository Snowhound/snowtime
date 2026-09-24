// Seasonal scene for the sign-in page: a background image per season and theme, a tint that keeps
// text readable, and a weather effect. Winter's WebGL snow comes from
// design/backgrounds/snowtime_login_intro_with_backgrounds.html; the other seasons have no weather
// yet. `scene.create()` returns a controller; move `controller.el` to change where it draws.
//
// The user's choices are settings in the shared prototype settings key (app-frame.js):
// `sceneBackground`, `sceneStrength` ('full', 'dimmed'), `sceneWeather`, and `sceneIntro` (play it
// on the first visit), plus the app-wide `surfaces` ('glass', 'solid'): whether cards let a
// background show through. `scene.settings` reads and writes them for auth.html, which has no frame.
;(() => {
  const BASE = '../design/backgrounds/'
  const SETTINGS_KEY = 'snowtime.prototypeSettings'
  const INTRO_SEEN_KEY = 'snowtime.introSeen'
  const DEFAULTS = { sceneBackground: true, sceneStrength: 'full', surfaces: 'glass', sceneWeather: true, sceneIntro: true }
  const SEASONS = {
    winter: { label: 'Winter', weather: 'snow' },
    spring: { label: 'Spring', weather: null },
    summer: { label: 'Summer', weather: null },
    autumn: { label: 'Autumn', weather: null },
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

  // --- Snow: points in one draw call, positions computed in the vertex shader -----------------
  const VS = `#version 300 es
  precision highp float;
  uniform vec2 u_res;
  uniform float u_time, u_wind, u_speed, u_size;
  out float v_alpha, v_depth, v_rnd;
  float hash(float n){ return fract(sin(n*127.1)*43758.5453123); }
  float hash2(float n){ return fract(sin(n*269.5+31.7)*17358.5453123); }
  void main() {
    float id = float(gl_VertexID) + 1.0;
    float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0);
    float z = mix(.22, 1.0, pow(r3, 1.8));
    float t = u_time * u_speed * mix(.18, .60, z);
    float x = r1 * 2.0 - 1.0;
    float y = r2 * 2.0 - 1.0;
    y = 1.18 - mod((1.18-y) + t*(1.0+r4*.55), 2.36);
    x += u_wind * (1.0-z*.38) * t * .18;
    x += sin((y+r4*6.28)*4.5 + u_time*(.35+r3)) * (.008 + .035*(1.0-z));
    x = -1.15 + mod(x+1.15, 2.30);
    x *= mix(.88, 1.08, z);
    // The mock-up divided x by the aspect ratio, which left the sides of wide screens bare.
    gl_Position = vec4(x, y, 0.0, 1.0);
    gl_PointSize = u_size * mix(.8, 2.75, z);
    v_alpha = mix(.15,.82,z) * mix(.72,1.0,r4);
    v_depth = z;
    v_rnd = r4;
  }`
  const FS = `#version 300 es
  precision highp float;
  in float v_alpha, v_depth, v_rnd;
  uniform vec3 u_colorNear, u_colorFar;
  out vec4 outColor;
  void main() {
    float d = length(gl_PointCoord - .5);
    float a = smoothstep(.54,.22,d) * v_alpha;
    vec3 c = mix(u_colorFar, u_colorNear, v_depth) + v_rnd * 0.02;
    // Premultiplied, as the canvas composites; straight alpha would darken the flakes' edges.
    outColor = vec4(c * a, a);
    if (outColor.a < .02) discard;
  }`
  const SNOW = { wind: -2.5, speed: 0.15, size: 1.15 }
  // Flakes per 1440 x 900 viewport, scaled to the drawn area so the panel isn't denser than the page.
  const DENSITY = 500

  // `colors()` returns the near and far flake colors as RGB triples.
  function snow(canvas, colors) {
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
    if (!gl) return null
    const compile = (type, src) => {
      const sh = gl.createShader(type)
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
      return sh
    }
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    gl.useProgram(program)
    gl.bindVertexArray(gl.createVertexArray())
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const u = Object.fromEntries(['u_res', 'u_time', 'u_wind', 'u_speed', 'u_size', 'u_colorNear', 'u_colorFar'].map((n) => [n, gl.getUniformLocation(program, n)]))

    let raf = 0
    let last = 0
    let elapsed = 0
    function frame(now) {
      raf = requestAnimationFrame(frame)
      // About 45 fps is plenty for slow flakes and halves the GPU work on 120 Hz screens.
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
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform2f(u.u_res, w, h)
      gl.uniform1f(u.u_time, elapsed)
      gl.uniform1f(u.u_wind, SNOW.wind)
      gl.uniform1f(u.u_speed, SNOW.speed)
      gl.uniform1f(u.u_size, SNOW.size * dpr)
      const [near, far] = colors()
      gl.uniform3f(u.u_colorNear, ...near)
      gl.uniform3f(u.u_colorFar, ...far)
      const area = (canvas.clientWidth * canvas.clientHeight) / (1440 * 900)
      gl.drawArrays(gl.POINTS, 0, Math.round(Math.min(900, Math.max(150, DENSITY * area))))
    }
    return {
      start() {
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
    let fx = null
    try {
      // White flakes on the dark scene and on the light image; on the plain light page they'd
      // vanish, so they turn blue-grey there.
      fx = snow(el.querySelector('canvas'), () =>
        isDark()
          ? [[0.96, 0.98, 1.0], [0.66, 0.78, 0.9]]
          : state.background
            ? [[1.0, 1.0, 1.0], [0.9, 0.94, 0.98]]
            : [[0.44, 0.58, 0.69], [0.72, 0.83, 0.9]]
      )
    } catch (error) {
      console.warn('Snow effect unavailable:', error)
    }
    const state = { season, strength, background, weather }

    function render() {
      const s = SEASONS[state.season] ?? SEASONS.winter
      const dark = isDark()
      el.querySelector('.scene-photo-light').style.backgroundImage = `url("${BASE}${state.season}-light-01.webp")`
      el.querySelector('.scene-photo-dark').style.backgroundImage = `url("${BASE}${state.season}-dark-01.webp")`
      el.style.setProperty('--scene-tint', STRENGTHS[state.strength][dark ? 'dark' : 'light'])
      el.dataset.background = state.background ? 'on' : 'off'
      const snowing = state.weather && s.weather === 'snow' && !!fx && !reducedMotion.matches && !document.hidden
      el.dataset.weather = snowing ? 'on' : 'off'
      if (snowing) fx.start()
      else fx?.stop()
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
        if (!(SEASONS[state.season] ?? SEASONS.winter).weather) return `No weather for ${SEASONS[state.season].label.toLowerCase()} yet.`
        if (reducedMotion.matches) return 'Off while your device reduces motion.'
        if (!fx) return 'Your browser has no WebGL 2.'
        return null
      },
    }
  }

  window.scene = { create, settings, intro, SEASONS, STRENGTHS, DEFAULTS, reducedMotion }
})()
