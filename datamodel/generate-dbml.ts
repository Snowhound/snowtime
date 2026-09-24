// Writes datamodel/snowtime.dbml from the Drizzle schema, so the diagram follows the
// migrations without hand edits (task 010). Columns, types, keys, indexes and references
// come from src/db/schema.ts, which `bun run db:drift` keeps in line with the migrations;
// groups and notes come from datamodel/notes.ts.
//
// Usage: bun datamodel/generate-dbml.ts [--check]
//   --check  write nothing; exit 1 if snowtime.dbml is not what the schema generates.

import { is, SQL } from 'drizzle-orm'
import { getTableConfig, SQLiteDialect, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { readFileSync, writeFileSync } from 'node:fs'
import * as schema from '../src/db/schema'
import { auditNotes, groups, projectNote, tables as tableNotes } from './notes'

const OUTPUT = 'datamodel/snowtime.dbml'
const WIDTH = 90

const dialect = new SQLiteDialect()
function sqlText(value: SQL) {
  return dialect.sqlToQuery(value).sql
}

const warnings: string[] = []
function warn(message: string) {
  return warnings.push(message)
}

type Config = ReturnType<typeof getTableConfig>

const configs = new Map<string, Config>()
for (const value of Object.values(schema)) {
  if (is(value, SQLiteTable)) {
    const config = getTableConfig(value)
    configs.set(config.name, config)
  }
}

// The ChartDB converter reads single-quoted strings with no escapes.
function quote(text: string, where: string) {
  if (text.includes("'")) throw new Error(`${where}: notes cannot contain apostrophes: ${text}`)
  return `'${text}'`
}

function defaultOf(column: Config['columns'][number]): string | null {
  const value = column.default
  if (value === undefined || value === null) return null
  if (is(value, SQL)) {
    const text = sqlText(value).replace(/^\((.*)\)$/, '$1')
    return /^-?\d+(\.\d+)?$/.test(text) ? text : `\`${text}\``
  }
  if (typeof value === 'string') return quote(value, `${column.name} default`)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  throw new Error(`Unsupported default on ${column.name}: ${String(value)}`)
}

function joinNotes(...parts: (string | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

function list(names: string[]) {
  return names.length === 1 ? names[0] : `(${names.join(', ')})`
}

function renderTable(config: Config): string[] {
  const notes = tableNotes[config.name] ?? {}
  const columnNames = new Set(config.columns.map((c) => c.name))
  const indexNames = new Set(config.indexes.map((i) => i.config.name))
  for (const name of Object.keys(notes.columns ?? {})) {
    if (!columnNames.has(name)) warn(`notes.ts: ${config.name}.${name} is not a column`)
  }
  for (const name of Object.keys(notes.indexes ?? {})) {
    if (!indexNames.has(name)) warn(`notes.ts: ${config.name} has no index ${name}`)
  }
  const appOwned = columnNames.has('created_by')

  // A single-column, full unique index shows as the column's unique flag.
  const uniqueColumns = new Set<string>()
  const indexes = config.indexes.filter((i) => {
    const columns = i.config.columns as { name: string }[]
    if (
      i.config.unique &&
      !i.config.where &&
      columns.length === 1 &&
      !notes.indexes?.[i.config.name]
    ) {
      uniqueColumns.add(columns[0].name)
      return false
    }
    return true
  })

  // Each foreign key draws one reference. A composite one (x_id, organization_id) draws
  // x_id's, and names the composite in its note.
  const references = new Map<string, { ref: string; note?: string }>()
  for (const fk of config.foreignKeys) {
    const r = fk.reference()
    const target = getTableConfig(r.foreignTable).name
    const pairs = r.columns.map((c, i) => [c.name, r.foreignColumns[i].name] as const)
    const [column, foreignColumn] =
      pairs.length === 1 ? pairs[0] : (pairs.find(([c]) => c !== 'organization_id') ?? pairs[0])
    const composite =
      pairs.length > 1
        ? `Composite FK (${pairs.map(([c]) => c).join(', ')}) to ${target} (${pairs.map(([, f]) => f).join(', ')}).`
        : undefined
    const onDelete =
      fk.onDelete && fk.onDelete !== 'no action'
        ? `ON DELETE ${fk.onDelete.toUpperCase()}.`
        : undefined
    if (references.has(column)) throw new Error(`${config.name}.${column} has two foreign keys`)
    references.set(column, {
      ref: `${target}.${foreignColumn}`,
      note: joinNotes(composite, onDelete) || undefined,
    })
  }

  const lines: string[] = []
  const tableNote = notes.note ? ` [note: ${quote(notes.note, config.name)}]` : ''
  if (!notes.note) warn(`notes.ts: ${config.name} has no table note`)
  lines.push(`Table ${config.name}${tableNote} {`)

  for (const column of config.columns) {
    const attrs: string[] = []
    if (column.primary) attrs.push('pk')
    else if (column.notNull) attrs.push('not null')
    if (uniqueColumns.has(column.name)) attrs.push('unique')
    const reference = references.get(column.name)
    if (reference) attrs.push(`ref: > ${reference.ref}`)
    const value = defaultOf(column)
    if (value !== null) attrs.push(`default: ${value}`)
    const own = notes.columns?.[column.name] ?? (appOwned ? auditNotes[column.name] : undefined)
    const note = joinNotes(own, reference?.note)
    if (note) attrs.push(`note: ${quote(note, `${config.name}.${column.name}`)}`)
    lines.push(
      `  ${column.name} ${column.getSQLType()}${attrs.length ? ` [${attrs.join(', ')}]` : ''}`,
    )
  }

  const indexLines: string[] = []
  for (const pk of config.primaryKeys) {
    indexLines.push(`    ${list(pk.columns.map((c) => c.name))} [pk]`)
  }
  for (const i of indexes) {
    const attrs: string[] = []
    if (i.config.unique) attrs.push('unique')
    const partial = i.config.where ? `Partial: WHERE ${sqlText(i.config.where)}.` : undefined
    const note = joinNotes(partial, notes.indexes?.[i.config.name])
    if (note) attrs.push(`note: ${quote(note, i.config.name)}`)
    const columns = (i.config.columns as { name: string }[]).map((c) => c.name)
    indexLines.push(`    ${list(columns)}${attrs.length ? ` [${attrs.join(', ')}]` : ''}`)
  }
  if (indexLines.length) lines.push('', '  indexes {', ...indexLines, '  }')
  lines.push('}')
  return lines
}

function heading(title: string) {
  const start = `// --- ${title} `
  return start + '-'.repeat(Math.max(3, WIDTH - start.length))
}

const out: string[] = [
  '// Generated from src/db/schema.ts and datamodel/notes.ts by datamodel/generate-dbml.ts.',
  '// Do not edit: run `bun run datamodel:generate`.',
  '',
  'Project Snowtime {',
  "  database_type: 'SQLite'",
  "  Note: '''",
  ...projectNote
    .trim()
    .split('\n')
    .map((line) => (line ? `    ${line}` : '')),
  "  '''",
  '}',
]

const grouped = new Set<string>()
for (const group of groups) {
  out.push('', heading(group.title), ...(group.comment ?? []).map((line) => `// ${line}`))
  for (const name of group.tables) {
    const config = configs.get(name)
    if (!config) {
      warn(`notes.ts: group ${group.name} lists ${name}, which schema.ts does not define`)
      continue
    }
    grouped.add(name)
    out.push('', ...renderTable(config))
  }
}

const ungrouped = [...configs.keys()].filter((name) => !grouped.has(name)).sort()
if (ungrouped.length) {
  warn(`Tables in no group (add them to groups in datamodel/notes.ts): ${ungrouped.join(', ')}`)
  out.push('', heading('Ungrouped'))
  for (const name of ungrouped) out.push('', ...renderTable(configs.get(name)!))
}

for (const group of groups) {
  const members = group.tables.filter((t) => configs.has(t))
  out.push(
    '',
    `TableGroup ${group.name} [color: ${group.color}] {`,
    ...members.map((t) => `  ${t}`),
    '}',
  )
}

const dbml = `${out.join('\n')}\n`
for (const message of warnings) console.warn(`[datamodel] ${message}`)

if (process.argv.includes('--check')) {
  if (readFileSync(OUTPUT, 'utf8') !== dbml) {
    console.error(`[datamodel] ${OUTPUT} is out of date. Run: bun run datamodel:generate`)
    process.exit(1)
  }
  console.log(`[datamodel] ${OUTPUT} is up to date.`)
} else {
  writeFileSync(OUTPUT, dbml)
  console.log(`[datamodel] Wrote ${configs.size} tables to ${OUTPUT}.`)
}
