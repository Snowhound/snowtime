// The timesheet card's Export menu (prototypes/reports.html): the report as shown, for the
// current filters, as XLSX with the timesheet and the entries, or either one as CSV. The entries
// load when chosen; see export.ts for the files.
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
import type { Member } from '~/lib/members'
import type { Project } from '~/lib/projects'
import { m } from '~/paraglide/messages.js'
import { getReportEntries } from '~/server/reports/reports.functions'
import type { ReportInput } from '~/server/reports/reports.schemas'
import {
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
import type { Row } from './rows'

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
    kind: 'csv',
    label: m.export_csv,
    hint: m.export_csv_hint,
    icon: FileTextIcon,
  },
  {
    kind: 'entries',
    label: m.export_entries,
    hint: m.export_entries_hint,
    icon: FileTextIcon,
  },
]

export function ExportMenu(props: {
  report: Report
  rows: Row[]
  group: Group
  input: ReportInput
  organizationSlug: string
  projects: Project[]
  members: Member[]
  onError: (message: string | null) => void
}) {
  const [busy, setBusy] = createSignal(false)

  function fileName(kind: ExportKind) {
    const last: IsoDate = addDays(props.input.to, -1)
    return exportFileName(props.organizationSlug, props.input.from, last, kind)
  }

  async function entries() {
    const data = await getReportEntries({ data: props.input })
    return entriesTable(data, { projects: props.projects, members: props.members })
  }

  async function run(kind: ExportKind) {
    props.onError(null)
    setBusy(true)
    try {
      const timesheet = timesheetTable(props.report, props.rows, props.group)
      let blob: Blob
      if (kind === 'csv') blob = new Blob([toCsv(timesheet)], { type: 'text/csv;charset=utf-8' })
      else if (kind === 'entries') {
        blob = new Blob([toCsv(await entries())], { type: 'text/csv;charset=utf-8' })
      } else {
        blob = await toXlsx([
          { name: m.reports_timesheet(), table: timesheet },
          { name: m.export_sheet_entries(), table: await entries() },
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
