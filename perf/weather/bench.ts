// The weather bench page (perf/weather.html): the app's weather renderer on a fixed background or
// the image's photo, under the glass surfaces of a page layout. URL parameters set the first view
// (perf/README.md, "Weather bench"); perf/weather.ts drives it through window.bench.

import type { ImageId } from '~/lib/scene/images'
import { STRENGTHS, photoUrl, photoWidth } from '~/lib/scene/scene'
import { PACES, PRESETS, type Pace, type Weather, weatherFor } from '~/lib/scene/weather'
import { createWeatherRenderer, weatherColors } from '~/lib/scene/weather-renderer'
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
const scene = frame.appendChild(document.createElement('div'))
scene.className = 'scene'
scene.dataset.background = photo ? 'on' : 'off'
scene.style.setProperty('--scene-tint-light', String(STRENGTHS.full.light))
scene.style.setProperty('--scene-tint-dark', String(STRENGTHS.full.dark))
const photoLayer = scene.appendChild(document.createElement('div'))
photoLayer.dataset.ready = ''
const photoImage = photoLayer.appendChild(document.createElement('div'))
photoImage.className = 'scene-photo-image'
for (const name of ['scene-tint', 'scene-vignette']) {
  scene.appendChild(document.createElement('div')).className = name
}
const canvas = scene.appendChild(document.createElement('canvas'))
canvas.className = 'scene-weather'
canvas.dataset.on = ''
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
}

// Every animation frame callback is timed, and a GPU timer query wraps it, so each frame the
// renderer draws reports its cost; a callback that doesn't draw is left out.
//
// Uncapped, Chrome lets the page queue frames seconds ahead of the GPU: the page counts thousands
// of frames a second that the GPU finishes much later, and a call that waits for the GPU process,
// such as a compile or a canvas resize, stalls for seconds. So, like a swap chain, a frame waits
// while the GPU hasn't finished the one FRAMES_AHEAD before it, which a fence after each frame
// tells. WebGL updates a fence's status only every 10 ms or so, so the limit is loose enough not
// to cap the rate itself. The wrapper keeps its own ids, since a waiting frame asks again.
const FRAMES_AHEAD = 64
const sample: Sample = { seconds: 0, cpu: [], gpu: [] }
const fences: WebGLSync[] = []
const requests = new Map<number, number>()
let lastRequest = 0
let drew = false
const nativeFrame = requestAnimationFrame.bind(window)
const nativeCancel = cancelAnimationFrame.bind(window)
window.requestAnimationFrame = function timedFrame(callback) {
  const id = ++lastRequest
  function timed(now: number) {
    while (fences.length && gl.clientWaitSync(fences[0], 0, 0) !== gl.TIMEOUT_EXPIRED) {
      gl.deleteSync(fences.shift()!)
    }
    if (fences.length >= FRAMES_AHEAD) {
      requests.set(id, nativeFrame(timed))
      return
    }
    requests.delete(id)
    const query = beginQuery()
    const started = performance.now()
    drew = false
    callback(now)
    if (drew) sample.cpu.push(performance.now() - started)
    endQuery(query, drew)
    if (drew && uncapped) fences.push(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!)
    measured(performance.now())
  }
  requests.set(id, nativeFrame(timed))
  return id
}
window.cancelAnimationFrame = function cancelTimedFrame(id) {
  nativeCancel(requests.get(id) ?? 0)
  requests.delete(id)
}

const renderer = createWeatherRenderer(canvas, () => PACES[pace], { uncapped })
if (!renderer) throw new Error('No WebGL 2')
// The renderer's context; getContext returns the one it made.
const gl = canvas.getContext('webgl2')!
const draw = gl.drawArrays.bind(gl)
gl.drawArrays = function countedDraw(...args) {
  drew = true
  draw(...args)
}
const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2')
const queries: WebGLQuery[] = []

function beginQuery() {
  if (!timer) return null
  collectQueries()
  const query = gl.createQuery()
  gl.beginQuery(timer.TIME_ELAPSED_EXT, query)
  return query
}
function endQuery(query: WebGLQuery | null, keep: boolean) {
  if (!timer || !query) return
  gl.endQuery(timer.TIME_ELAPSED_EXT)
  if (keep) queries.push(query)
  else gl.deleteQuery(query)
}
// Results arrive a frame or more later, in order. A disjoint event (a GPU reset or throttle)
// spoils the ones in flight.
function collectQueries() {
  const disjoint = gl.getParameter(timer!.GPU_DISJOINT_EXT)
  while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
    const query = queries.shift()!
    if (!disjoint) sample.gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6)
    gl.deleteQuery(query)
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
    measurement.started = now
  } else if (started && now >= started + window) {
    performance.mark(`bench:end:${mark}`)
    measurement = null
    renderer!.stop()
    done({ ...sample, seconds: (now - started) / 1000 })
  }
}

function show({ image, preset, theme, t }: View) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  const weather: Weather = image ? weatherFor(image, theme) : PRESETS[preset!]
  photoLayer.className = `scene-photo scene-photo-${theme}`
  const width = photoWidth({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })
  photoImage.style.backgroundImage = photo && image ? `url("${photoUrl(image, theme, width)}")` : ''
  const { effect } = weather
  if (!effect) return renderer!.stop()
  const shown = { ...weather, effect }
  renderer!.start(shown, weatherColors(shown, { dark: theme === 'dark', background: true }))
  if (t !== undefined) renderer!.drawAt(t)
}

const debug = gl.getExtension('WEBGL_debug_renderer_info')
window.bench = {
  renderer: String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown'),
  timerQuery: !!timer,
  variant,
  show,
  stop() {
    renderer.stop()
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
