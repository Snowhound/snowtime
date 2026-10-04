// Cuts a perf:stress recording down to the requests the native backend serves: the calls it
// ports and email sign-in. Both backends then replay the same requests, so their numbers
// compare (perf/README.md, "Load benchmark").
//
//   bun native/bench/api-recording.ts <recording.json> <out.json> [operation names]

import { readFileSync, writeFileSync } from 'node:fs'
import { type OperationName, operations } from '~/lib/api/operations'
import { matchPath } from '~/lib/api/wire'
import type { Recording } from '../../perf/stress/record'

// The calls native/crates/core/src/operations.rs lists.
const PORTED: OperationName[] = [
  'checkAvailability',
  'getRunningTimer',
  'startTimer',
  'stopTimer',
  'listEntries',
  'getFirstEntryStart',
  'createEntry',
  'updateEntry',
  'deleteEntry',
]

const [source, out, ...names] = process.argv.slice(2)
if (!source || !out) {
  throw new Error('Usage: bun native/bench/api-recording.ts <recording.json> <out.json> [names]')
}
const ported = new Set<string>(names.length > 0 ? names : PORTED)

function served(method: string, path: string) {
  if (method === 'POST' && path === '/api/auth/sign-in/email') return true
  // Placeholders such as {{organizationId}} stand in for one path segment.
  const pathname = path.split('?')[0].replaceAll(/\{\{\w+\}\}/g, 'x')
  return Object.entries(operations).some(
    ([name, operation]) =>
      ported.has(name) &&
      operation.method === method &&
      matchPath(operation.path, pathname) !== null,
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
