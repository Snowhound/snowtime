// Quick checks, no browser: bundle budgets, query plans, and report reads against the
// baselines in perf/baselines/. `bun run perf`; `--update` rewrites the baselines.
// See perf/README.md.

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { checkBudgets } from './checks/budgets'
import { checkPlans } from './checks/plans'
import { checkReads } from './checks/reads'
import { openRecorder } from './checks/recorder'
import { buildApp } from './lib/app'
import { CACHE, seededDatabase } from './lib/database'

const update = process.argv.includes('--update')
const started = performance.now()

const [build, database] = [await buildApp(), await seededDatabase()]
const failures: string[] = []

failures.push(...(await checkBudgets(build, update)).failures)

const recorder = await openRecorder(database)
try {
  failures.push(...(await checkPlans(recorder, update)).failures)
  failures.push(...(await checkReads(recorder, update)).failures)
} finally {
  recorder.close()
  rmSync(join(CACHE, 'check.db'), { force: true })
}

const seconds = Math.round((performance.now() - started) / 1000)
if (update) {
  console.log(`\nBaselines updated in perf/baselines/ (${seconds} s)`)
} else if (failures.length > 0) {
  console.log(`\n${failures.length} failed (${seconds} s):`)
  for (const failure of failures) console.log(`  ${failure}`)
  process.exit(1)
} else {
  console.log(`\nAll checks passed (${seconds} s)`)
}
