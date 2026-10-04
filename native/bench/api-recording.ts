// Cuts a perf:stress recording down to the requests the native backend serves: the calls it
// ports, email sign-in, and the pages it renders fully (the timer and the reports). Both
// backends then replay the same requests, so their numbers compare (perf/README.md, "Load
// benchmark"). --api-only leaves the pages out, as task 081.03's slice did.
//
//   bun native/bench/api-recording.ts <recording.json> <out.json> [--api-only] [operation names]

import { readFileSync, writeFileSync } from 'node:fs'
import type { Recording } from '../../perf/stress/record'
import { CALLS, matchPath } from './calls'

const [source, out, ...rest] = process.argv.slice(2)
const apiOnly = rest.includes('--api-only')
const names = rest.filter((name) => name !== '--api-only')
if (!source || !out) {
  throw new Error('Usage: bun native/bench/api-recording.ts <recording.json> <out.json> [names]')
}
const ported = new Set<string>(names.length > 0 ? names : Object.keys(CALLS))

// Pages whose server render reads only ported calls.
const PAGES = /^\/\{\{slug\}\}\/(timer|reports)(\?|$)/

function served(method: string, path: string) {
  if (method === 'POST' && path === '/api/auth/sign-in/email') return true
  if (method === 'GET' && PAGES.test(path)) return !apiOnly
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
