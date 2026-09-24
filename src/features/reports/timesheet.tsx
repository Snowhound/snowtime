// The timesheet grid (prototypes/reports.html, 02 · Timesheet): a row per group and a
// column per day or week, with row and column totals and the current day or week shaded.
// It scrolls inside its card with the first column sticky.
import ChartColumnIcon from 'lucide-solid/icons/chart-column'
import { For, Show } from 'solid-js'
import { ProjectDot } from '~/components/project-dot'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { type IsoDate, type WeekStart, startOfWeek } from '~/lib/calendar'
import { formatHours, formatIsoDate } from '~/lib/format'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { Group, Unit } from './filters'
import type { Report } from './queries'
import type { Row } from './rows'

const GROUP_LABELS = {
  project: m.reports_group_project,
  team: m.reports_group_team,
  member: m.reports_group_member,
} satisfies Record<Group, () => string>

// Short day labels up to a week; longer ranges show the day number over its weekday.
const WEEK_DAYS = 7

export function Timesheet(props: {
  report: Report
  rows: Row[]
  group: Group
  unit: Unit
  today: IsoDate
  weekStart: WeekStart
}) {
  function buckets() {
    return props.report.buckets
  }
  function longRange() {
    return props.unit === 'day' && buckets().length > WEEK_DAYS
  }

  function current(bucket: IsoDate) {
    return props.unit === 'week'
      ? bucket === startOfWeek(props.today, props.weekStart)
      : bucket === props.today
  }

  function shortLabel(bucket: IsoDate) {
    if (props.unit === 'week') return formatIsoDate(bucket, { day: 'numeric', month: 'short' })
    return formatIsoDate(
      bucket,
      longRange() ? { day: 'numeric' } : { weekday: 'short', day: 'numeric' },
    )
  }

  function fullLabel(bucket: IsoDate) {
    const date = formatIsoDate(bucket, { weekday: 'short', day: 'numeric', month: 'short' })
    return props.unit === 'week' ? m.reports_week_of({ date }) : date
  }

  function Cell(cell: { ms: number; bucket: IsoDate; class?: string }) {
    return (
      <TableCell
        class={cn(
          'text-right whitespace-nowrap tabular-nums',
          current(cell.bucket) && 'bg-muted/50',
          !cell.ms && 'text-muted-foreground/50',
          cell.class,
        )}
      >
        {cell.ms ? formatHours(cell.ms) : '·'}
      </TableCell>
    )
  }

  return (
    <Show when={props.rows.length} fallback={<EmptyState />}>
      <div class="border-t">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                scope="col"
                class="bg-card sticky left-0 z-10 max-w-40 min-w-36 pl-6 sm:max-w-64"
              >
                {GROUP_LABELS[props.group]()}
              </TableHead>
              <For each={buckets()}>
                {(bucket) => (
                  <TableHead
                    scope="col"
                    class={cn(
                      'min-w-16 text-right whitespace-nowrap',
                      current(bucket) && 'text-foreground',
                    )}
                  >
                    <span aria-hidden="true">{shortLabel(bucket)}</span>
                    <span class="sr-only">{fullLabel(bucket)}</span>
                    <Show when={longRange()}>
                      <span class="block text-[10px] font-normal" aria-hidden="true">
                        {formatIsoDate(bucket, { weekday: 'narrow' })}
                      </span>
                    </Show>
                  </TableHead>
                )}
              </For>
              <TableHead scope="col" class="pr-6 text-right">
                {m.reports_total()}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={props.rows}>
              {(row) => (
                <TableRow>
                  <TableHead
                    scope="row"
                    class="bg-card text-foreground sticky left-0 z-10 h-auto max-w-40 p-2 pl-6 font-normal sm:max-w-64"
                  >
                    <span class="flex min-w-0 items-center gap-2">
                      <Show when={props.group === 'project'}>
                        <ProjectDot color={row.color ?? null} />
                      </Show>
                      <span
                        class={cn('truncate', row.muted && 'text-muted-foreground')}
                        title={row.name}
                      >
                        {row.name}
                      </span>
                    </span>
                  </TableHead>
                  <For each={buckets()}>
                    {(bucket, i) => <Cell ms={row.perBucket[i()]} bucket={bucket} />}
                  </For>
                  <TableCell class="pr-6 text-right font-medium tabular-nums">
                    {formatHours(row.total)}
                  </TableCell>
                </TableRow>
              )}
            </For>
            <TableRow class="border-t-2 font-medium hover:bg-transparent">
              <TableHead
                scope="row"
                class="bg-card text-foreground sticky left-0 z-10 h-auto p-2 pl-6"
              >
                {m.reports_total()}
              </TableHead>
              <For each={buckets()}>
                {(bucket, i) => (
                  <Cell ms={props.report.perBucket[i()]} bucket={bucket} class="font-medium" />
                )}
              </For>
              <TableCell class="pr-6 text-right tabular-nums">
                {formatHours(props.report.total)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Show>
  )
}

function EmptyState() {
  return (
    <div class="px-6 pb-6">
      <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
        <ChartColumnIcon class="text-muted-foreground size-6" aria-hidden="true" />
        <p class="font-medium">{m.reports_empty_title()}</p>
        <p class="text-muted-foreground text-sm">{m.reports_empty_description()}</p>
      </div>
    </div>
  )
}
