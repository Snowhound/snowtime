// The timesheet card's Export menu (prototypes/reports.html): the report for the current
// filters, as XLSX with the entries and the timesheet, or either one as CSV. Entries come
// first, as the part a client or an invoice needs. The timesheet CSV is the report as shown.
// The entries load when chosen, together with the report they add up to, which the XLSX's
// timesheet then shows, so a running timer counts alike in both sheets.
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
import { type IsoDate, addDays } from '~/lib/calendar'
import { m } from '~/paraglide/messages.js'
import { getReportExport } from '~/server/reports/reports.functions'
import type { ReportInput } from '~/server/reports/reports.schemas'
import {
  EXPORT_LOCALE,
  type ExportKind,
  downloadFile,
  entriesTable,
  exportFileName,
  timesheetTable,
  toCsv,
  toXlsx,
} from './export'
import type { Group } from './filters'
import type { Report } from './queries'
import { type RowNames, reportRows } from './rows'

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

  async function run(kind: ExportKind) {
    props.onError(null)
    setBusy(true)
    try {
      let blob: Blob
      if (kind === 'csv') {
        blob = new Blob([toCsv(timesheet(props.report))], { type: 'text/csv;charset=utf-8' })
      } else {
        const data = await getReportExport({
          data: { ...props.input, organizationId: props.organizationId },
        })
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
        aria-label={m.export_menu()}
      >
        {busy() ? (
          <LoaderCircleIcon class="animate-spin" aria-hidden="true" />
        ) : (
          <DownloadIcon aria-hidden="true" />
        )}
        {m.export_button()}
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
