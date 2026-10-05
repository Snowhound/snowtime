import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface Frame {
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
}
interface Node {
  id: number
  callFrame: Frame
  children?: number[]
}
interface CpuProfile {
  nodes: Node[]
  samples: number[]
  timeDeltas?: number[]
}
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))
function cpuProfile(): CpuProfile {
  if (!input.stackTraces) return input
  const traces = input.stackTraces
  const sources = new Map<number, string>(
    traces.sources.map((source: { sourceID: number; url?: string }) => [
      source.sourceID,
      source.url ?? '',
    ]),
  )
  const frames = new Map<string, number>()
  const nodes: Node[] = []
  const samples: number[] = []
  for (const trace of traces.traces) {
    const first = trace.frames[0]
    const frame: Frame = first
      ? {
          functionName: first.name,
          url:
            first.line === 4294967295 ? '' : (first.sourceURL ?? sources.get(first.sourceID) ?? ''),
          lineNumber: first.line === 4294967295 ? -1 : first.line - 1,
          columnNumber: first.column === 4294967295 ? -1 : first.column - 1,
        }
      : { functionName: '(idle)', url: '', lineNumber: -1, columnNumber: -1 }
    const key = JSON.stringify(frame)
    let id = frames.get(key)
    if (!id) {
      id = nodes.length + 1
      frames.set(key, id)
      nodes.push({ id, callFrame: frame })
    }
    samples.push(id)
  }
  return { nodes, samples, timeDeltas: samples.map(() => traces.interval * 1e6) }
}
const profile = cpuProfile()
const mapPath = process.argv[3] ?? resolve(import.meta.dir, '../dist/render.js.map')
const map = new TraceMap(JSON.parse(readFileSync(mapPath, 'utf8')))
const nodes = new Map<number, Node>(profile.nodes.map((node) => [node.id, node]))
const buckets: Record<string, number> = {}
const frames: Record<string, number> = {}
function source(frame: Frame) {
  if (!frame.url?.endsWith('render.js') || frame.lineNumber < 0) return frame.url ?? ''
  const original = originalPositionFor(map, {
    line: frame.lineNumber + 1,
    column: Math.max(0, frame.columnNumber),
  })
  return original.source ?? frame.url
}
function bucket(node: Node): string {
  const frame = node.callFrame
  const name = frame.functionName ?? ''
  const path = source(frame)
  if (name === '(garbage collector)') return 'GC'
  if (name === '(idle)') return 'idle'
  if (path.includes('ext:deno_web/06_streams')) return 'Deno streams'
  if (path.includes('ext:deno_webidl')) return 'WebIDL'
  if (path.includes('ext:deno_web/00_url')) return 'URL'
  if (path.includes('ext:deno_web/08_text_encoding')) return 'encoding'
  if (path.startsWith('ext:deno_fetch')) return 'Request/Response/Headers'
  if (name.startsWith('op_') || path.includes('ext:core')) return 'native ops'
  if (path.startsWith('ext:')) return 'Deno other'
  if (path.includes('/lib/api/wire')) return 'API decoding'
  if (path.endsWith('/bundle/entry.tsx') && name.includes('send')) return 'host callback'
  if (/Intl|DateTimeFormat|NumberFormat|formatToParts/.test(name)) return 'Intl'
  if (path.includes('/node_modules/solid-js')) return 'Solid'
  if (path.includes('/node_modules/@tanstack')) return 'TanStack'
  if (path.includes('/node_modules/')) return 'other dependencies'
  if (path.includes('/src/')) return 'app'
  if (name === '(program)' || !path) return 'native/unattributed'
  return 'bundle/other'
}
let total = 0
for (let i = 0; i < profile.samples.length; i++) {
  const node = nodes.get(profile.samples[i])!
  const weight = profile.timeDeltas?.[i] ?? 1000
  const category = bucket(node)
  buckets[category] = (buckets[category] ?? 0) + weight
  const frame = node.callFrame
  const original =
    frame.url?.endsWith('render.js') && frame.lineNumber >= 0
      ? originalPositionFor(map, {
          line: frame.lineNumber + 1,
          column: Math.max(0, frame.columnNumber),
        })
      : undefined
  const label =
    frame.functionName + ' ' + source(frame) + ':' + (original?.line ?? frame.lineNumber + 1)
  frames[label] = (frames[label] ?? 0) + weight
  total += weight
}
console.log(
  JSON.stringify({
    profile: process.argv[2],
    sampled_ms: total / 1000,
    buckets_percent: Object.fromEntries(
      Object.entries(buckets)
        .sort((a, b) => b[1] - a[1])
        .map(([key, value]) => [key, Math.round((value * 10000) / total) / 100]),
    ),
    top_frames: Object.entries(frames)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([frame, us]) => ({ frame, percent: Math.round((us * 10000) / total) / 100 })),
  }),
)
