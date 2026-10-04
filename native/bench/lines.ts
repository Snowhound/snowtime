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
    'projects.rs',
    ['VISIBLE_PROJECTS', 'visible_projects', 'assert_usable_project'],
  ],
  [
    'entry columns',
    'src/server/entries/entries.server.ts',
    ['entryColumns'],
    'entries.rs',
    ['ENTRY_COLUMNS', 'entry_of', 'entry_columns'],
  ],
  [
    'entry checks',
    'src/server/entries/entries.server.ts',
    ['assertCanWrite', 'assertMember', 'findEntry', 'assertEntryRoom', 'assertReadable'],
    'entries.rs',
    ['assert_can_write', 'assert_member', 'find_entry', 'assert_entry_room', 'assert_readable'],
  ],
  [
    'createEntry',
    'src/server/entries/entries.server.ts',
    ['createEntry'],
    'entries.rs',
    ['create_entry'],
  ],
  [
    'updateEntry',
    'src/server/entries/entries.server.ts',
    ['updateEntry'],
    'entries.rs',
    ['update_entry'],
  ],
  [
    'deleteEntry',
    'src/server/entries/entries.server.ts',
    ['deleteEntry'],
    'entries.rs',
    ['delete_entry'],
  ],
  [
    'getFirstEntryStart',
    'src/server/entries/entries.server.ts',
    ['getFirstEntryStart'],
    'entries.rs',
    ['get_first_entry_start'],
  ],
  [
    'listEntries',
    'src/server/entries/entries.server.ts',
    ['listEntries'],
    'entries.rs',
    ['list_entries'],
  ],
  [
    'timer helpers',
    'src/server/timer/timer.server.ts',
    ['runningOf', 'isMemberOfEntryOrganization', 'stopAt', 'stopRunning', 'assertStillMember'],
    'timer.rs',
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
  ['startTimer', 'src/server/timer/timer.server.ts', ['startTimer'], 'timer.rs', ['start_timer']],
  ['stopTimer', 'src/server/timer/timer.server.ts', ['stopTimer'], 'timer.rs', ['stop_timer']],
  [
    'getRunningTimer',
    'src/server/timer/timer.server.ts',
    ['getRunningTimer'],
    'timer.rs',
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
    new RegExp(`^\\s*(export )?(pub )?(async )?(function|fn|const|static) ${name}\\b`).test(line),
  )
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    for (const char of lines[i].replace(/\/\/.*$/, '')) {
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
const rules = crates.length > 0 ? crates : ['rules-sql']
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
