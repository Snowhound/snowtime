// The weather bench page (perf/weather.html): the app's weather renderer on a fixed background or
// the image's photo, under the glass surfaces of a page layout. URL parameters set the first view
// (perf/README.md, "Weather bench"); perf/weather.ts drives it through window.bench.

import { glassPhoto } from '~/lib/scene/glass'
import type { ImageId } from '~/lib/scene/images'
import { STRENGTHS, photoUrl, photoWidth } from '~/lib/scene/scene'
import { PACES, PRESETS, type Pace, type Weather, weatherFor } from '~/lib/scene/weather'
import { createWeatherRenderer, weatherCanvases, weatherColors } from '~/lib/scene/weather-renderer'
import { LAYOUTS, type Layout } from './layouts'
import '~/styles.css'

type Theme = 'light' | 'dark'

// One view: an image's weather, or a preset's without an image's horizon and zones.
type View = { image?: ImageId; preset?: keyof typeof PRESETS; theme: Theme; t?: number }

type Sample = { seconds: number; cpu: number[]; gpu: number[] }

type Bench = {
  renderer: string
  timerQuery: boolean
  variant: string | null
  // Starts the view's weather, or with `t`, draws only its frame at t seconds.
  show(view: View): void
  stop(): void
  // Starts the view, waits `warm` ms, then gives the CPU and GPU milliseconds of each frame drawn
  // in the next `window` ms, and stops. `mark` names the window in a trace, with
  // bench:start:<mark> and bench:end:<mark>.
  measure(view: View, warm: number, window: number, mark: string): Promise<Sample>
}

declare global {
  interface Window {
    bench: Bench
  }
}

const params = new URLSearchParams(location.search)
const pace = (params.get('pace') ?? 'calm') as Pace
const layout = (params.get('layout') ?? 'none') as Layout
const photo = params.get('photo') === '1'
const uncapped = params.get('uncapped') === '1'
// An A/B switch for work on the weather: perf/weather.ts --variant passes it through, for the code
// under test to pick what it draws, for example through an option of createWeatherRenderer.
const variant = params.get('variant')
// The harness sets the real pixel ratio; by hand, this changes only the canvas's.
const dpr = Number(params.get('dpr'))
if (dpr && dpr !== devicePixelRatio) {
  Object.defineProperty(window, 'devicePixelRatio', { value: dpr })
}

const frame = document.getElementById('frame')!
frame.style.setProperty('--scene-tint-light', String(STRENGTHS.full.light))
frame.style.setProperty('--scene-tint-dark', String(STRENGTHS.full.dark))
const scene = frame.appendChild(document.createElement('div'))
scene.className = 'scene'
scene.dataset.background = photo ? 'on' : 'off'
const photoLayer = scene.appendChild(document.createElement('div'))
photoLayer.dataset.ready = ''
const photoImage = photoLayer.appendChild(document.createElement('div'))
photoImage.className = 'scene-photo-image'
for (const name of ['scene-tint', 'scene-vignette']) {
  scene.appendChild(document.createElement('div')).className = name
}
function weatherCanvas() {
  const made = scene.appendChild(document.createElement('canvas'))
  made.className = 'scene-weather'
  made.dataset.on = ''
  return made
}
// As in the app's scene layer, an image's two effects draw on one canvas, or on two when they
// differ in resolution (weatherCanvases).
const canvases = [weatherCanvas(), weatherCanvas()]
for (const rect of LAYOUTS[layout]) {
  const surface = frame.appendChild(document.createElement('div'))
  surface.className = 'header' in rect ? 'scene-header' : 'surface'
  Object.assign(surface.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
    borderRadius: `${rect.radius}px`,
  })
  surface.appendChild(document.createElement('div')).className = 'glass'
}
// As in the app, the surfaces show a blurred copy of the photo (src/lib/scene/glass.ts) once it's
// made; the `live` variant keeps the backdrop blur.
async function showGlass(url: string) {
  frame.removeAttribute('data-glass')
  const copy =
    url && variant !== 'live' && (await glassPhoto(url, { width: innerWidth, height: innerHeight }))
  if (!copy) return
  frame.style.setProperty('--glass-photo', `url("${copy}")`)
  frame.setAttribute('data-glass', 'on')
}

// Every animation frame's callbacks are timed together, and a GPU timer query on each context
// wraps each callback, so each frame the renderers draw reports its cost; a frame that doesn't
// draw is left out.
//
// Uncapped, Chrome lets the page queue frames seconds ahead of the GPU: the page counts thousands
// of frames a second that the GPU finishes much later, and a call that waits for the GPU process,
// such as a compile or a canvas resize, stalls for seconds. So, like a swap chain, a frame waits
// while the GPU hasn't finished the one FRAMES_AHEAD before it, which a fence after each frame
// tells. WebGL updates a fence's status only every 10 ms or so, so the limit is loose enough not
// to cap the rate itself. The wrapper keeps its own ids, since a waiting frame asks again.
const FRAMES_AHEAD = 64
const sample: Sample = { seconds: 0, cpu: [], gpu: [] }
const requests = new Map<number, number>()
let lastRequest = 0
// The frame whose callbacks are running and its CPU time so far, and the GPU time and queries
// still out of each frame.
let frameAt = -1
let frameCpu = 0
const frameGpu = new Map<number, { ms: number; pending: number }>()
const nativeFrame = requestAnimationFrame.bind(window)
const nativeCancel = cancelAnimationFrame.bind(window)

type Timed = {
  gl: WebGL2RenderingContext
  timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
  queries: { query: WebGLQuery; frame: number }[]
  fences: WebGLSync[]
  drew: boolean
}
const contexts: Timed[] = []

window.requestAnimationFrame = function timedFrame(callback) {
  const id = ++lastRequest
  function timed(now: number) {
    for (const c of contexts) {
      while (c.fences.length && c.gl.clientWaitSync(c.fences[0], 0, 0) !== c.gl.TIMEOUT_EXPIRED) {
        c.gl.deleteSync(c.fences.shift()!)
      }
    }
    if (contexts.some((c) => c.fences.length >= FRAMES_AHEAD)) {
      requests.set(id, nativeFrame(timed))
      return
    }
    requests.delete(id)
    if (now !== frameAt) {
      if (frameCpu > 0) sample.cpu.push(frameCpu)
      frameCpu = 0
      frameAt = now
    }
    const queries = contexts.map(beginQuery)
    const started = performance.now()
    for (const c of contexts) c.drew = false
    callback(now)
    if (contexts.some((c) => c.drew)) frameCpu += performance.now() - started
    for (const [i, c] of contexts.entries()) {
      endQuery(c, queries[i], now)
      if (c.drew && uncapped) c.fences.push(c.gl.fenceSync(c.gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!)
    }
    measured(performance.now())
  }
  requests.set(id, nativeFrame(timed))
  return id
}
window.cancelAnimationFrame = function cancelTimedFrame(id) {
  nativeCancel(requests.get(id) ?? 0)
  requests.delete(id)
}

function timedRenderer(target: HTMLCanvasElement) {
  const made = createWeatherRenderer(target, () => PACES[pace], { uncapped })
  if (!made) throw new Error('No WebGL 2')
  // The renderer's context; getContext returns the one it made.
  const gl = target.getContext('webgl2')!
  const c: Timed = {
    gl,
    timer: gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    queries: [],
    fences: [],
    drew: false,
  }
  const draw = gl.drawArrays.bind(gl)
  gl.drawArrays = function countedDraw(...args) {
    c.drew = true
    draw(...args)
  }
  contexts.push(c)
  return made
}

// The second canvas's context starts only when a weather needs it, as in the app.
const renderers = [timedRenderer(canvases[0])]
const gl = contexts[0].gl
const timer = contexts[0].timer

function beginQuery(c: Timed) {
  if (!c.timer) return null
  collectQueries(c)
  const query = c.gl.createQuery()
  c.gl.beginQuery(c.timer.TIME_ELAPSED_EXT, query)
  return query
}
function endQuery(c: Timed, query: WebGLQuery | null, frame: number) {
  if (!c.timer || !query) return
  c.gl.endQuery(c.timer.TIME_ELAPSED_EXT)
  if (!c.drew) return c.gl.deleteQuery(query)
  c.queries.push({ query, frame })
  const entry = frameGpu.get(frame) ?? { ms: 0, pending: 0 }
  entry.pending++
  frameGpu.set(frame, entry)
}
// Results arrive a frame or more later, in order. A disjoint event (a GPU reset or throttle)
// spoils the ones in flight, and their frames are left out.
function collectQueries(c: Timed) {
  const disjoint = c.gl.getParameter(c.timer!.GPU_DISJOINT_EXT)
  while (
    c.queries.length &&
    c.gl.getQueryParameter(c.queries[0].query, c.gl.QUERY_RESULT_AVAILABLE)
  ) {
    const { query, frame } = c.queries.shift()!
    const entry = frameGpu.get(frame)
    if (entry && disjoint) frameGpu.delete(frame)
    else if (entry) {
      entry.ms += c.gl.getQueryParameter(query, c.gl.QUERY_RESULT) / 1e6
      if (--entry.pending === 0) {
        sample.gpu.push(entry.ms)
        frameGpu.delete(frame)
      }
    }
    c.gl.deleteQuery(query)
  }
}

// The measurement in progress, moved on by frames rather than timers, which a page drawing
// thousands of frames a second runs late.
let measurement: {
  warmUntil: number
  window: number
  mark: string
  started: number
  done: (sample: Sample) => void
} | null = null
function measured(now: number) {
  if (!measurement) return
  const { warmUntil, window, mark, started, done } = measurement
  if (!started && now >= warmUntil) {
    performance.mark(`bench:start:${mark}`)
    sample.cpu = []
    sample.gpu = []
    frameGpu.clear()
    frameCpu = 0
    measurement.started = now
  } else if (started && now >= started + window) {
    performance.mark(`bench:end:${mark}`)
    measurement = null
    stopAll()
    done({ ...sample, seconds: (now - started) / 1000 })
  }
}

function stopAll() {
  for (const renderer of renderers) renderer.stop()
}

// The `alone` variant draws only an image's first effect, and `also` only its second, to time a
// pair against each of its effects.
function effectsOf(weather: Weather): Weather {
  if (variant === 'alone') return { ...weather, also: undefined }
  if (variant === 'also' && weather.also) return { ...weather.also }
  return weather
}

function show({ image, preset, theme, t }: View) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  const weather = effectsOf(image ? weatherFor(image, theme) : PRESETS[preset!])
  photoLayer.className = `scene-photo scene-photo-${theme}`
  const width = photoWidth({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })
  const url = photo && image ? photoUrl(image, theme, width) : ''
  photoImage.style.backgroundImage = url && `url("${url}")`
  void showGlass(url)
  const page = { dark: theme === 'dark', background: true }
  const groups = weatherCanvases(weather)
  if (groups.length > renderers.length) renderers.push(timedRenderer(canvases[1]))
  for (const [i, renderer] of renderers.entries()) {
    const group = groups[i] ?? []
    renderer.start(group.map((shown) => ({ weather: shown, colors: weatherColors(shown, page) })))
    if (t !== undefined && group.length) renderer.drawAt(t)
  }
}

const debug = gl.getExtension('WEBGL_debug_renderer_info')
window.bench = {
  renderer: String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown'),
  timerQuery: !!timer,
  variant,
  show,
  stop() {
    stopAll()
  },
  measure(view, warm, window, mark) {
    show(view)
    return new Promise((done) => {
      measurement = { warmUntil: performance.now() + warm, window, mark, started: 0, done }
    })
  },
}

const t = params.get('t')
const preset = (params.get('preset') as keyof typeof PRESETS | null) ?? undefined
show({
  image: (params.get('image') as ImageId | null) ?? (preset ? undefined : 'winter'),
  preset,
  theme: params.get('theme') === 'dark' ? 'dark' : 'light',
  t: t === null ? undefined : Number(t),
})
