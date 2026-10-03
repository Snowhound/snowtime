// The timesheet card's Export menu (prototypes/reports.html): the report for the current
// filters, as XLSX with the entries and the timesheet, or either one as CSV. Entries come
// first, as the part a client or an invoice needs. The timesheet CSV is the report as shown.
// The entries load when chosen, a month at a time, together with the report they add up to,
// which the XLSX's timesheet then shows, so a running timer counts alike in both sheets.
// The rows are named for a client: in English, and with no "(you)". See export.ts for the files.
import DownloadIcon from 'lucide-solid/icons/download'
import FileSpreadsheetIcon from 'lucide-solid/icons/file-spreadsheet'
import FileTextIcon from 'lucide-solid/icons/file-text'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import { type Component, For, createSignal } from 'solid-js'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { call } from '~/lib/api/client'
import { type IsoDate, addDays } from '~/lib/calendar'
import { m } from '~/paraglide/messages.js'
import type { ReportInput } from '~/server/reports/reports.schemas'
import {
  EXPORT_LOCALE,
  type ExportKind,
  downloadFile,
  entriesTable,
  exportFileName,
  exportPieces,
  type ReportEntries,
  timesheetTable,
  toCsv,
  toXlsx,
} from './export'
import type { Group } from './filters'
import type { Report } from './queries'
import { type RowNames, reportRows } from './rows'

// How many of an export's months load at once after the first.
const EXPORT_PARALLEL = 3

const ITEMS: {
  kind: ExportKind
  label: () => string
  hint: () => string
  icon: Component<{ 'aria-hidden'?: 'true' }>
}[] = [
  {
    kind: 'xlsx',
    label: m.export_xlsx,
    hint: m.export_xlsx_hint,
    icon: FileSpreadsheetIcon,
  },
  {
    kind: 'entries',
    label: m.export_entries,
    hint: m.export_entries_hint,
    icon: FileTextIcon,
  },
  {
    kind: 'csv',
    label: m.export_csv,
    hint: m.export_csv_hint,
    icon: FileTextIcon,
  },
]

export function ExportMenu(props: {
  report: Report
  group: Group
  names: RowNames
  input: ReportInput
  organizationId: string
  organizationSlug: string
  onError: (message: string | null) => void
}) {
  const [busy, setBusy] = createSignal(false)
  const [progress, setProgress] = createSignal<{ done: number; total: number }>()

  // Shown only for an export of more than one piece.
  function progressLabel() {
    const p = progress()
    return p && p.total > 1 ? m.export_progress(p) : undefined
  }

  function fileName(kind: ExportKind) {
    const last: IsoDate = addDays(props.input.to, -1)
    return exportFileName(props.organizationSlug, props.input.from, last, kind)
  }

  function names(): RowNames {
    return { ...props.names, userId: undefined, locale: EXPORT_LOCALE }
  }

  function timesheet(report: Report) {
    return timesheetTable(report, reportRows(report, props.group, names()), props.group)
  }

  // The entries a month at a time, so each response stays small. The first piece brings the
  // report and the moment it counts up to, which the rest count up to as well, so they
  // follow it EXPORT_PARALLEL at a time.
  async function exportData() {
    const pieces = exportPieces(props.input.from, props.input.to)
    const total = pieces.length
    let done = 0
    setProgress({ done, total })
    function fetchPiece(piece: (typeof pieces)[number], now?: Report['now']) {
      return call('getReportExport', {
        organizationId: props.organizationId,
        report: props.input,
        ...piece,
        now,
      }).then((data) => {
        setProgress({ done: ++done, total })
        return data
      })
    }

    const first = await fetchPiece(pieces[0])
    const { report } = first
    if (!report) throw new Error('The export has no report')
    const entries: ReportEntries['entries'] = [...first.entries]
    for (let i = 1; i < total; i += EXPORT_PARALLEL) {
      const batch = pieces.slice(i, i + EXPORT_PARALLEL)
      const results = await Promise.all(batch.map((piece) => fetchPiece(piece, report.now)))
      for (const data of results) entries.push(...data.entries)
    }
    return { report, entries }
  }

  async function run(kind: ExportKind) {
    props.onError(null)
    setBusy(true)
    try {
      let blob: Blob
      if (kind === 'csv') {
        blob = new Blob([toCsv(timesheet(props.report))], { type: 'text/csv;charset=utf-8' })
      } else {
        const data = await exportData()
        const entries = entriesTable(data, props.names, { hours: kind === 'xlsx' })
        const locale = { locale: EXPORT_LOCALE }
        blob =
          kind === 'entries'
            ? new Blob([toCsv(entries)], { type: 'text/csv;charset=utf-8' })
            : await toXlsx([
                { name: m.export_sheet_entries({}, locale), table: entries },
                { name: m.reports_timesheet({}, locale), table: timesheet(data.report) },
              ])
      }
      downloadFile(blob, fileName(kind))
    } catch {
      props.onError(m.export_failed())
    } finally {
      setBusy(false)
      setProgress(undefined)
    }
  }

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        as={Button<'button'>}
        variant="outline"
        size="sm"
        class="shrink-0"
        disabled={busy()}
        aria-label={progressLabel() ?? m.export_menu()}
      >
        {busy() ? (
          <LoaderCircleIcon class="animate-spin" aria-hidden="true" />
        ) : (
          <DownloadIcon aria-hidden="true" />
        )}
        {progressLabel() ?? m.export_button()}
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-60">
        <For each={ITEMS}>
          {(item) => (
            <DropdownMenuItem
              class="items-start gap-2 [&_svg]:mt-0.5 [&_svg]:size-4"
              onSelect={() => void run(item.kind)}
            >
              <item.icon aria-hidden="true" />
              <span class="grid">
                <span>{item.label()}</span>
                <span class="text-muted-foreground text-xs">{item.hint()}</span>
              </span>
            </DropdownMenuItem>
          )}
        </For>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
