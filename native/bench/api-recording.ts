// Cuts a perf:stress recording down to the requests the native backend serves: the calls it
// ports and email sign-in. Both backends then replay the same requests, so their numbers
// compare (perf/README.md, "Load benchmark").
//
//   bun native/bench/api-recording.ts <recording.json> <out.json> [operation names]

import { readFileSync, writeFileSync } from 'node:fs'
import type { Recording } from '../../perf/stress/record'
import { CALLS, matchPath } from './calls'

const [source, out, ...names] = process.argv.slice(2)
if (!source || !out) {
  throw new Error('Usage: bun native/bench/api-recording.ts <recording.json> <out.json> [names]')
}
const ported = new Set<string>(names.length > 0 ? names : Object.keys(CALLS))

function served(method: string, path: string) {
  if (method === 'POST' && path === '/api/auth/sign-in/email') return true
  // Placeholders such as {{organizationId}} stand in for one path segment.
  const pathname = path.split('?')[0].replaceAll(/\{\{\w+\}\}/g, 'x')
  return Object.entries(CALLS).some(
    ([name, operation]) =>
      ported.has(name) && operation.method === method && matchPath(operation.path, pathname),
  )
}

const recording = JSON.parse(readFileSync(source, 'utf8')) as Recording
const actions = Object.fromEntries(
  Object.entries(recording.actions).map(([action, requests]) => [
    action,
    requests.filter((r) => served(r.method, r.path)),
  ]),
) as Recording['actions']
writeFileSync(out, JSON.stringify({ ...recording, actions }, null, 1))
for (const [action, requests] of Object.entries(actions)) {
  const kept = requests.map((r) => `${r.method} ${r.path.split('?')[0]}`).join(', ')
  console.log(`${action}: ${kept || 'nothing'}`)
}
