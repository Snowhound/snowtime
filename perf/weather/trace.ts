// Busy milliseconds per second on the threads that draw the weather and the glass over it, from a
// Chrome trace (task 063): the page's main and compositor threads, the display compositor (viz),
// and the GPU process's main thread, where the backdrop blur runs.

type TraceEvent = {
  name: string
  ph: string
  pid: number
  tid: number
  ts: number
  dur?: number
  args?: { name?: string }
}

export const TRACE_CATEGORIES = [
  'toplevel',
  'devtools.timeline',
  'blink.user_timing',
  'viz',
  'gpu',
  'cc',
]

const THREADS = {
  CrRendererMain: 'main',
  Compositor: 'compositor',
  VizCompositorThread: 'viz',
  CrGpuMain: 'gpu',
} as const

export type Busy = Record<(typeof THREADS)[keyof typeof THREADS], number>

// The spans of each thread, merged where they overlap, since trace events nest.
function busySpans(events: TraceEvent[]) {
  const names = new Map<string, string>()
  for (const event of events) {
    if (event.name === 'thread_name') names.set(`${event.pid}:${event.tid}`, event.args?.name ?? '')
  }
  const spans = new Map<keyof Busy, [number, number][]>()
  for (const event of events) {
    if (event.ph !== 'X' || !event.dur) continue
    const thread = THREADS[names.get(`${event.pid}:${event.tid}`) as keyof typeof THREADS]
    if (!thread) continue
    const list = spans.get(thread) ?? []
    list.push([event.ts, event.ts + event.dur])
    spans.set(thread, list)
  }
  for (const list of spans.values()) list.sort((a, b) => a[0] - b[0])
  return spans
}

// Splits a trace at the page's `bench:start:<name>` and `bench:end:<name>` marks and sums each
// thread's busy time between them.
export function busyPerWindow(trace: Buffer) {
  const events: TraceEvent[] = JSON.parse(trace.toString()).traceEvents
  const spans = busySpans(events)
  const starts = new Map<string, number>()
  const result = new Map<string, Busy>()
  for (const event of events.toSorted((a, b) => a.ts - b.ts)) {
    const [prefix, edge, name] = event.name.split(/:(start|end):/)
    if (prefix !== 'bench' || !name) continue
    if (edge === 'start') {
      starts.set(name, event.ts)
      continue
    }
    const start = starts.get(name)
    if (start === undefined) continue
    const seconds = (event.ts - start) / 1e6
    const busy = { main: 0, compositor: 0, viz: 0, gpu: 0 }
    for (const [thread, list] of spans) {
      let total = 0
      let end = start
      for (const [from, to] of list) {
        if (to <= end || from >= event.ts) continue
        total += Math.min(to, event.ts) - Math.max(from, end)
        end = Math.min(to, event.ts)
      }
      busy[thread] = total / 1000 / seconds
    }
    result.set(name, busy)
  }
  return result
}
