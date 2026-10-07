// Counts the code lines of each ported handler and helper in TypeScript and in each Rust
// rules crate: lines that aren't blank or only a comment, from the declaration to its end.
//
//   bun native/bench/lines.ts [rules crate ...]

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../../perf/lib/database'

// TypeScript [file, names] against Rust [module, names], per row.
const PAIRS: [string, string, string[], string, string[]][] = [
  [
    'createSettings',
    'src/server/settings/settings.server.ts',
    ['createSettings'],
    'settings/mod.rs',
    ['create_settings'],
  ],
  [
    'updateSettings',
    'src/server/settings/settings.server.ts',
    ['updateSettings'],
    'settings/mod.rs',
    ['update_settings'],
  ],
  [
    'signInMethods',
    'src/server/auth/sign-in.server.ts',
    ['signInMethods', 'passwordEnabled', 'socialProviders'],
    'auth/sign_in_page.rs',
    ['sign_in_methods'],
  ],
  [
    'getDeployment',
    'src/server/auth/auth.server.ts',
    ['getDeployment'],
    'auth/sign_in_page.rs',
    ['get_deployment'],
  ],
  [
    'getDevUsers',
    'src/server/auth/auth.server.ts',
    ['getDevUsers'],
    'auth/sign_in_page.rs',
    ['SEED_USERS', 'COMPANY_USERS', 'get_dev_users'],
  ],
  [
    'signOut',
    'node_modules/better-auth/dist/api/routes/sign-out.mjs',
    ['signOut'],
    'auth/sign_out.rs',
    ['sign_out'],
  ],
  [
    'signOut body validation',
    'node_modules/better-auth/dist/api/routes/sign-out.mjs',
    ['signOutBodySchema'],
    'auth/schemas.rs',
    ['sign_out_body_issues'],
  ],
  [
    'signOut URL checks',
    'node_modules/better-auth/dist/api/middlewares/origin-check.mjs',
    ['originCheckMiddleware'],
    'auth/sign_out.rs',
    ['truthy', 'check_urls'],
  ],
  [
    'report context',
    'src/server/reports/reports.server.ts',
    [
      'settingsOf',
      'reportTeams',
      'reportUsers',
      'reportContext',
      'rowWhere',
      'entriesWhere',
      'reportEntries',
      'listedEntries',
      'formerMembers',
      'piecesOf',
      'pagedDays',
    ],
    'reports/mod.rs',
    [
      'settings_of',
      'report_teams',
      'report_users',
      'report_context',
      'row_where',
      'entries_where',
      'filtered_where',
      'report_entries',
      'listed_entry',
      'listed_entries',
      'former_members',
      'pieces_of',
      'paged_days',
    ],
  ],
  [
    'getReport',
    'src/server/reports/reports.server.ts',
    ['getReport', 'reportOf'],
    'reports/mod.rs',
    ['get_report', 'get_report_at'],
  ],
  [
    'getReportBreakdown',
    'src/server/reports/reports.server.ts',
    ['getReportBreakdown'],
    'reports/mod.rs',
    ['get_report_breakdown'],
  ],
  [
    'getReportEntries',
    'src/server/reports/reports.server.ts',
    ['getReportEntries'],
    'reports/mod.rs',
    ['get_report_entries'],
  ],
  [
    'getReportEntryTotals',
    'src/server/reports/reports.server.ts',
    ['getReportEntryTotals'],
    'reports/mod.rs',
    ['get_report_entry_totals'],
  ],
  [
    'getReportExport',
    'src/server/reports/reports.server.ts',
    ['getReportExport'],
    'reports/mod.rs',
    ['get_report_export'],
  ],
  [
    'report aggregation',
    'src/server/reports/aggregation.server.ts',
    [
      'bucketsOf',
      'rangeOf',
      'add',
      'rows',
      'aggregate',
      'byMemberTotal',
      'breakdownOf',
      'placeOf',
      'byDay',
      'dayPage',
      'mergeByDescription',
    ],
    'reports/aggregation.rs',
    [
      'step',
      'buckets',
      'range',
      'rows',
      'or_null',
      'aggregate',
      'breakdown_of',
      'place_of',
      'by_day',
      'day_page',
      'compare_text',
      'merge_by_description',
    ],
  ],
  [
    'scope',
    'src/server/scope.server.ts',
    ['strongestRole', 'resolveScope', 'isAdmin', 'readableUserIds'],
    'scope.rs',
    ['strongest_role', 'resolve_scope', 'is_admin', 'readable_user_ids'],
  ],
  [
    'assertUsableProject',
    'src/server/projects/projects.server.ts',
    ['visibleProjects', 'assertUsableProject'],
    'projects/mod.rs',
    ['VISIBLE_PROJECTS', 'visible_projects', 'assert_usable_project'],
  ],
  [
    'entry columns',
    'src/server/entries/entries.server.ts',
    ['entryColumns'],
    'entries/mod.rs',
    ['ENTRY_COLUMNS', 'entry_of', 'entry_columns'],
  ],
  [
    'entry checks',
    'src/server/entries/entries.server.ts',
    ['assertCanWrite', 'assertMember', 'findEntry', 'assertEntryRoom', 'assertReadable'],
    'entries/mod.rs',
    ['assert_can_write', 'assert_member', 'find_entry', 'assert_entry_room', 'assert_readable'],
  ],
  [
    'createEntry',
    'src/server/entries/entries.server.ts',
    ['createEntry'],
    'entries/mod.rs',
    ['create_entry'],
  ],
  [
    'updateEntry',
    'src/server/entries/entries.server.ts',
    ['updateEntry'],
    'entries/mod.rs',
    ['update_entry'],
  ],
  [
    'deleteEntry',
    'src/server/entries/entries.server.ts',
    ['deleteEntry'],
    'entries/mod.rs',
    ['delete_entry'],
  ],
  [
    'getFirstEntryStart',
    'src/server/entries/entries.server.ts',
    ['getFirstEntryStart'],
    'entries/mod.rs',
    ['get_first_entry_start'],
  ],
  [
    'listEntries',
    'src/server/entries/entries.server.ts',
    ['listEntries'],
    'entries/mod.rs',
    ['list_entries'],
  ],
  [
    'timer helpers',
    'src/server/timer/timer.server.ts',
    ['runningOf', 'isMemberOfEntryOrganization', 'stopAt', 'stopRunning', 'assertStillMember'],
    'timer/mod.rs',
    [
      'RUNNING_OF',
      'IS_MEMBER_OF_ENTRY_ORGANIZATION',
      'STOP_AT',
      'stop_running',
      'assert_still_member',
      'running_of',
      'is_member_of_entry_organization',
      'stop_at',
    ],
  ],
  [
    'listProjects',
    'src/server/projects/projects.server.ts',
    ['projectColumns', 'listProjects'],
    'projects/mod.rs',
    ['PROJECT_COLUMNS', 'list_projects'],
  ],
  [
    'startTimer',
    'src/server/timer/timer.server.ts',
    ['startTimer'],
    'timer/mod.rs',
    ['start_timer'],
  ],
  ['stopTimer', 'src/server/timer/timer.server.ts', ['stopTimer'], 'timer/mod.rs', ['stop_timer']],
  [
    'getRunningTimer',
    'src/server/timer/timer.server.ts',
    ['getRunningTimer'],
    'timer/mod.rs',
    ['get_running_timer'],
  ],
]

function isCode(line: string) {
  const trimmed = line.trim()
  return trimmed !== '' && !trimmed.startsWith('//')
}

// The lines of a declaration: from its line until its brackets close and it ends.
function declaration(lines: string[], name: string): string[] | null {
  const start = lines.findIndex((line) =>
    new RegExp(
      `^\\s*(export )?(pub(?:\\([^)]*\\))? )?(async )?(function|fn|const|static) ${name}\\b`,
    ).test(line),
  )
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    for (const char of lines[i].replace(/"(?:\\.|[^"\\])*"|\/\/.*$/g, '')) {
      if ('({['.includes(char)) depth++
      if (')}]'.includes(char)) depth--
    }
    const end = lines[i].trimEnd()
    if (depth === 0 && (end.endsWith('}') || end.endsWith(';') || end.endsWith(')'))) {
      return lines.slice(start, i + 1)
    }
  }
  return lines.slice(start)
}

function count(file: string, names: string[]) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
  return names.reduce(
    (total, name) => total + (declaration(lines, name)?.filter(isCode).length ?? 0),
    0,
  )
}

const crates = process.argv.slice(2)
const rules = crates.length > 0 ? crates : ['server']
const header = ['Handler', 'TypeScript', ...rules]
const rows = PAIRS.map(([label, tsFile, tsNames, module, rustNames]) => [
  label,
  String(count(tsFile, tsNames)),
  ...rules.map((crate) => String(count(`native/crates/${crate}/src/${module}`, rustNames))),
])
const totals = header
  .slice(1)
  .map((_, column) => String(rows.reduce((total, row) => total + Number(row[column + 1]), 0)))
console.log(`| ${header.join(' | ')} |`)
console.log(`| ${header.map(() => '---').join(' | ')} |`)
for (const row of [...rows, ['Total', ...totals]]) console.log(`| ${row.join(' | ')} |`)
