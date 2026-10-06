import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { readFileSync } from 'node:fs'

interface Node {
  selfSize: number
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number }
  children: Node[]
}
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const map = new TraceMap(JSON.parse(readFileSync(process.argv[3], 'utf8')))
const count = Number(process.argv[4] ?? 500)
const sites = new Map<string, number>()
const buckets = new Map<string, number>()
const subsystems = new Map<string, number>()
let bytes = 0
function visit(node: Node) {
  const frame = node.callFrame
  const original =
    frame.url.endsWith('render.js') && frame.lineNumber >= 0
      ? originalPositionFor(map, {
          line: frame.lineNumber + 1,
          column: Math.max(0, frame.columnNumber),
        })
      : undefined
  const site =
    frame.functionName +
    ' ' +
    (original?.source ?? frame.url) +
    ':' +
    (original?.line ?? frame.lineNumber + 1)
  const source = original?.source ?? frame.url
  const bucket = source.includes('/node_modules/solid-js')
    ? 'Solid'
    : source.includes('/node_modules/@tanstack')
      ? 'TanStack'
      : source.startsWith('../../../../../src/')
        ? 'app'
        : source.startsWith('ext:')
          ? 'Deno'
          : source.includes('/Icon.tsx') ||
              source.includes('buildLucideIconNode') ||
              source.includes('mergeClasses')
            ? 'Lucide'
            : source.includes('/node_modules/')
              ? 'other dependencies'
              : 'native/bundle/unattributed'
  const subsystem = source.includes('/seroval/')
    ? 'serialization'
    : source.includes('/node_modules/@tanstack') && /query/.test(source)
      ? 'query'
      : source.includes('/node_modules/@tanstack')
        ? 'router'
        : source.includes('/lib/calendar.ts')
          ? 'calendar'
          : source.includes('/node_modules/solid-js') &&
              ['mergeProps', 'splitProps', 'split'].includes(frame.functionName)
            ? 'Solid prop helpers'
            : 'other'
  subsystems.set(subsystem, (subsystems.get(subsystem) ?? 0) + node.selfSize)
  buckets.set(bucket, (buckets.get(bucket) ?? 0) + node.selfSize)
  sites.set(site, (sites.get(site) ?? 0) + node.selfSize)
  bytes += node.selfSize
  for (const child of node.children) visit(child)
}
visit(input.head)
console.log(
  JSON.stringify({
    profile: process.argv[2],
    count,
    estimated_bytes_per_render: bytes / count,
    sample_count: input.samples.length,
    estimated_bytes_per_render_by_bucket: Object.fromEntries(
      [...buckets].map(([key, size]) => [key, size / count]),
    ),
    estimated_bytes_per_render_by_subsystem: Object.fromEntries(
      [...subsystems].map(([key, size]) => [key, size / count]),
    ),
    sites: [...sites]
      .filter(([, size]) => size > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([site, size]) => ({
        site,
        estimated_bytes_per_render: size / count,
        percent: (size * 100) / bytes,
      })),
  }),
)
