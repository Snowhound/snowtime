// The report's export (task 034, prototypes/reports.html): the timesheet and the entries
// behind it, as CSV or as one XLSX file with a sheet for each. getReport and getReportExport
// apply the role rules; the browser names the rows from the cached lists, as the timesheet
// does, and builds the files, so the XLSX library loads only when someone exports.
import { type IsoDate, localTime } from '~/lib/calendar'
import type { Member } from '~/lib/members'
import type { Project } from '~/lib/projects'
import { m } from '~/paraglide/messages.js'
import type { getReportExport } from '~/server/reports/reports.functions'
import type { Group } from './filters'
import type { Report } from './queries'
import type { Row } from './rows'

export type ReportEntries = Pick<
  Awaited<ReturnType<typeof getReportExport>>,
  'timeZone' | 'entries'
>
export type ExportKind = 'xlsx' | 'csv' | 'entries'

const HOUR = 3_600_000
const DAY = 86_400_000

type Cell = string | number | null
// A duration in milliseconds, which each format writes its own way.
type Duration = { ms: number }
type TableCell = Cell | Duration

export interface Table {
  header: string[]
  rows: TableCell[][]
}

const GROUP_LABELS = {
  project: m.reports_group_project,
  team: m.reports_group_team,
  member: m.reports_group_member,
} satisfies Record<Group, () => string>

// The timesheet as shown: a row per group, a column per day or week (its first day), and the
// row and column totals.
export function timesheetTable(report: Report, rows: Row[], group: Group): Table {
  return {
    header: [GROUP_LABELS[group](), ...report.buckets, m.reports_total()],
    rows: [
      ...rows.map((row) => [row.name, ...row.perBucket.map((ms) => ({ ms })), { ms: row.total }]),
      [m.reports_total(), ...report.perBucket.map((ms) => ({ ms })), { ms: report.total }],
    ],
  }
}

// Each entry's time on each day of the report, oldest first, with its start and end in the
// user's time zone. A running entry has no end yet and counts up to now.
export function entriesTable(
  data: ReportEntries,
  names: { projects: Project[]; members: Member[] },
): Table {
  return {
    header: [
      m.export_column_date(),
      m.reports_group_member(),
      m.reports_group_project(),
      m.export_column_description(),
      m.export_column_start(),
      m.export_column_end(),
      m.export_column_duration(),
    ],
    rows: data.entries.map((entry) => [
      entry.date,
      names.members.find((member) => member.userId === entry.userId)?.name ?? '',
      entry.projectId
        ? (names.projects.find((p) => p.id === entry.projectId)?.name ?? '')
        : m.reports_no_project(),
      entry.description,
      localTime(entry.from.getTime(), data.timeZone),
      entry.running ? null : endTime(entry.to.getTime(), entry.from.getTime(), data.timeZone),
      { ms: entry.ms },
    ]),
  }
}

// A piece that ends at the next day's midnight ends at 24:00, not 00:00.
function endTime(to: number, from: number, zone: string) {
  const time = localTime(to, zone)
  return time === '00:00' && to > from ? '24:00' : time
}

// Decimal hours, to two places.
export function hours(ms: number) {
  return Math.round(ms / (HOUR / 100)) / 100
}

// A text cell that a spreadsheet would read as a formula gets a leading apostrophe, which
// spreadsheets show as text (OWASP's advice against CSV injection).
function safeText(text: string) {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

function csvCell(cell: TableCell) {
  if (cell === null) return ''
  if (typeof cell === 'number') return String(cell)
  if (typeof cell === 'object') return String(hours(cell.ms))
  const text = safeText(cell)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

// RFC 4180 CSV, UTF-8 with a byte order mark, so Excel reads non-ASCII names correctly.
// Durations are decimal hours.
export function toCsv(table: Table) {
  const lines = [table.header, ...table.rows].map((row) => row.map(csvCell).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

// Such as snowhound-2026-09-01-to-2026-09-30.csv; `last` is the range's last day.
export function exportFileName(slug: string, from: IsoDate, last: IsoDate, kind: ExportKind) {
  const base = `${slug}-${from}-to-${last}`
  if (kind === 'xlsx') return `${base}.xlsx`
  return kind === 'entries' ? `${base}-entries.csv` : `${base}.csv`
}

// One sheet per table. Durations are fractions of a day shown as [h]:mm, so they add up in the
// spreadsheet and read as the timesheet does; dates are text, as they are the user's days.
export async function toXlsx(sheets: { name: string; table: Table }[]) {
  const { default: writeXlsxFile } = await import('write-excel-file/universal')
  const bold = { fontWeight: 'bold' } as const
  return writeXlsxFile(
    sheets.map(({ name, table }) => ({
      sheet: name,
      data: [
        table.header.map((value) => ({ value, ...bold })),
        ...table.rows.map((row) =>
          row.map((cell) =>
            cell === null
              ? null
              : typeof cell === 'object'
                ? { value: cell.ms / DAY, type: Number, format: '[h]:mm' }
                : { value: cell },
          ),
        ),
      ],
      columns: table.header.map((_, i) => ({ width: i === 0 ? 28 : 12 })),
    })),
  ).toBlob()
}

export function downloadFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
