// EXPLAIN QUERY PLAN for the hot queries, taken from the statements the real server
// functions run, and compared with a snapshot. A new full scan of time_entry or a new
// temporary B-tree for sorting fails; any other change is printed.

import { listEntries } from '~/server/entries/entries.server'
import { getReport, getReportEntries } from '~/server/reports/reports.server'
import { getRunningTimer } from '~/server/timer/timer.server'
import { readBaseline, type Result, writeBaseline } from './baseline'
import type { Recorder } from './recorder'

// One entry per statement the call runs, in order. `sql` is the statement's start, to tell
// them apart in the snapshot.
interface Plan {
  sql: string
  scans: number
  sorts: number
  plan: string[]
}
type Plans = Record<string, Plan[]>

const DAY = 86_400_000

// A scan of time_entry under its own name or an alias the statement gives it (Drizzle's
// relational queries call it d0, t, and so on).
function isFullScan(line: string, sql: string) {
  const aliases = [
    'time_entry',
    ...[...sql.matchAll(/"time_entry"(?: as)? "(\w+)"/g)].map((m) => m[1]),
  ]
  const scanned = /^SCAN (\w+)/.exec(line)?.[1]
  return scanned !== undefined && aliases.includes(scanned)
}

function flagged(sql: string, plan: string[]) {
  return {
    scans: plan.filter((line) => isFullScan(line, sql)).length,
    sorts: plan.filter((line) => line.includes('USE TEMP B-TREE')).length,
  }
}

async function collect(recorder: Recorder): Promise<Plans> {
  const { db, scopes, userIds, now } = recorder
  const week = { from: '2026-09-24', to: '2026-10-01', unit: 'day' as const }
  const year = { from: '2025-10-02', to: '2026-10-01', unit: 'week' as const }
  const from = new Date(now.getTime() - 7 * DAY)
  const calls: Record<string, () => Promise<unknown>> = {
    'scope (admin)': async () => {
      const { resolveScope } = await import('~/server/scope.server')
      return resolveScope(db, userIds.admin, scopes.admin.organizationId)
    },
    'scope (member)': async () => {
      const { resolveScope } = await import('~/server/scope.server')
      return resolveScope(db, userIds.member, scopes.member.organizationId)
    },
    'running timer': () => getRunningTimer(db, userIds.member),
    'timer entries, own week (member)': () =>
      listEntries(db, scopes.member, { from, to: now, userId: userIds.member }),
    'timer entries, own week (admin)': () =>
      listEntries(db, scopes.admin, { from, to: now, userId: userIds.admin }),
    'report, week (admin)': () => getReport(db, scopes.admin, week, now),
    'report, year (admin)': () => getReport(db, scopes.admin, year, now),
    'report, year (member)': () => getReport(db, scopes.member, year, now),
    'report entries, year (admin)': () =>
      getReportEntries(db, scopes.admin, { report: year, view: 'description' }, now),
  }

  const plans: Plans = {}
  for (const [name, call] of Object.entries(calls)) {
    const { statements } = await recorder.record(call)
    const seen = new Set<string>()
    plans[name] = []
    for (const statement of statements) {
      if (seen.has(statement.sql)) continue
      seen.add(statement.sql)
      const plan = await recorder.explain(statement)
      plans[name].push({
        sql: statement.sql.replace(/\s+/g, ' ').slice(0, 80),
        ...flagged(statement.sql, plan),
        plan,
      })
    }
  }
  return plans
}

function total(plans: Plan[] | undefined, key: 'scans' | 'sorts'): number {
  return (plans ?? []).reduce((sum, p) => sum + p[key], 0)
}

export async function checkPlans(recorder: Recorder, update: boolean): Promise<Result> {
  const current = await collect(recorder)
  const baseline = readBaseline('plans.json') as Plans | null
  const failures: string[] = []
  const notes: string[] = []

  for (const [name, plans] of Object.entries(current)) {
    const before = baseline?.[name]
    if (baseline && !before) notes.push(`${name}: new query`)
    const scans = total(plans, 'scans')
    const sorts = total(plans, 'sorts')
    if (before && scans > total(before, 'scans')) failures.push(`${name}: new SCAN time_entry`)
    if (before && sorts > total(before, 'sorts')) failures.push(`${name}: new USE TEMP B-TREE`)
    if (before && JSON.stringify(before) !== JSON.stringify(plans)) {
      notes.push(`${name}: plan changed`)
    }
  }
  for (const name of Object.keys(baseline ?? {})) {
    if (!current[name]) notes.push(`${name}: no longer checked`)
  }

  console.log('\nQuery plans')
  for (const [name, plans] of Object.entries(current)) {
    const scans = total(plans, 'scans')
    const sorts = total(plans, 'sorts')
    console.log(
      `  ${name.padEnd(36)} ${String(plans.length).padStart(2)} statements, ${scans} scans, ${sorts} temp sorts`,
    )
  }
  for (const note of notes) console.log(`  note: ${note}`)
  if (update) writeBaseline('plans.json', current)
  else if (!baseline) failures.push('No plans.json baseline; run with --update')
  return { failures }
}
