// The timesheet grid (prototypes/reports.html, 02 · Timesheet): a row per group and a
// column per day or week, with row and column totals and the current day or week shaded.
// It scrolls inside its card with the first and last columns sticky. Names and totals are
// buttons that narrow the Entries card to their row, day or week, or both.
import ChartColumnIcon from 'lucide-solid/icons/chart-column'
import {
  type JSX,
  For,
  Show,
  createMemo,
  createSelector,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js'
import { Duration } from '~/components/duration'
import { ProjectDot } from '~/components/project-dot'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { type IsoDate, type WeekStart, startOfWeek } from '~/lib/calendar'
import { formatIsoDate } from '~/lib/format'
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

// The body's rows and cells are plain elements with ui/table's classes. Its components split
// and spread their props, which a month by 40 projects does for 1,300 cells.
const ROW = 'border-b transition-colors hover:bg-muted/50'
const ROW_HEAD =
  'timesheet-start bg-card text-foreground sticky left-0 z-10 p-2 pl-6 text-left align-middle'
const CELL = 'p-2 align-middle text-right whitespace-nowrap tabular-nums'
const ROW_TOTAL =
  'timesheet-end bg-card sticky right-0 z-10 p-2 pr-6 text-right align-middle tabular-nums'

// A day or week in full, as screen readers and the Entries card name it.
export function bucketLabel(bucket: IsoDate, unit: Unit) {
  const date = formatIsoDate(bucket, { weekday: 'short', day: 'numeric', month: 'short' })
  return unit === 'week' ? m.reports_week_of({ date }) : date
}

// The timesheet part the Entries card lists: a row, a day or week, or both.
export interface TimesheetPart {
  row?: string
  bucket?: IsoDate
}

function partKey(part: TimesheetPart) {
  return `${part.row ?? ''}|${part.bucket ?? ''}`
}

export function Timesheet(props: {
  report: Report
  rows: Row[]
  group: Group
  unit: Unit
  today: IsoDate
  weekStart: WeekStart
  picked: TimesheetPart
  onPick: (part: TimesheetPart) => void
}) {
  // One comparison per change rather than one per button.
  const pressed = createSelector(() => partKey(props.picked))

  // One handler for every button, which carries its part in data attributes.
  function pick(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-pick]')
    if (!button) return
    const { row, bucket } = button.dataset
    props.onPick({ row: row || undefined, bucket: bucket || undefined })
  }

  function buckets() {
    return props.report.buckets
  }
  function longRange() {
    return props.unit === 'day' && buckets().length > WEEK_DAYS
  }

  // A memo, because every cell asks and `today` is worked out through Intl on each read.
  const currentBucket = createMemo(() =>
    props.unit === 'week' ? startOfWeek(props.today, props.weekStart) : props.today,
  )
  function current(bucket: IsoDate) {
    return bucket === currentBucket()
  }

  function shortLabel(bucket: IsoDate) {
    if (props.unit === 'week') return formatIsoDate(bucket, { day: 'numeric', month: 'short' })
    return formatIsoDate(
      bucket,
      longRange() ? { day: 'numeric' } : { weekday: 'short', day: 'numeric' },
    )
  }

  function Pick(part: TimesheetPart & { class?: string; children: JSX.Element }) {
    return (
      <button
        type="button"
        data-pick=""
        data-row={part.row}
        data-bucket={part.bucket}
        aria-pressed={pressed(partKey(part))}
        aria-describedby="timesheet-pick-hint"
        class={cn(
          'hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 -mx-1.5 -my-0.5 rounded-sm px-1.5 py-0.5 focus-visible:ring-2 focus-visible:outline-none',
          part.class,
        )}
      >
        {part.children}
      </button>
    )
  }

  function Cell(cell: { ms: number; bucket: IsoDate; row?: string; class?: string }) {
    return (
      <td
        class={cn(
          CELL,
          current(cell.bucket) && 'bg-muted/50',
          !cell.ms && 'text-muted-foreground/50',
          cell.class,
        )}
      >
        {cell.ms ? (
          <Pick row={cell.row} bucket={cell.bucket}>
            <Duration ms={cell.ms} />
          </Pick>
        ) : (
          '·'
        )}
      </td>
    )
  }

  // Whether cells are hidden left and right of the sticky columns.
  const [scrolled, setScrolled] = createSignal(false)
  const [more, setMore] = createSignal(false)
  function measure(scroller: HTMLElement) {
    setScrolled(scroller.scrollLeft > 0)
    setMore(scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1)
  }

  return (
    <Show when={props.rows.length} fallback={<EmptyState />}>
      {/* Marked while cells hide under a sticky column: on glass, that column is see-through
          like the card until then, and solid after, so the cells under it don't show. */}
      <div
        ref={(el) =>
          onMount(() => {
            // The Table's scrolling wrapper, measured again as it or its columns resize.
            const scroller = el.firstElementChild as HTMLElement
            const observer = new ResizeObserver(() => measure(scroller))
            observer.observe(scroller)
            if (scroller.firstElementChild) observer.observe(scroller.firstElementChild)
            onCleanup(() => observer.disconnect())
          })
        }
        class="timesheet border-t"
        data-scrolled={scrolled() ? '' : undefined}
        data-more={more() ? '' : undefined}
        on:scroll={{
          capture: true,
          handleEvent: (event) => measure(event.target as HTMLElement),
        }}
        onClick={pick}
      >
        <span id="timesheet-pick-hint" class="sr-only">
          {m.reports_entries_pick_hint()}
        </span>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                scope="col"
                class="timesheet-start bg-card sticky left-0 z-10 max-w-40 min-w-36 pl-6 sm:max-w-64"
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
                    <span class="sr-only">{bucketLabel(bucket, props.unit)}</span>
                    <Show when={longRange()}>
                      <span class="block text-[10px] font-normal" aria-hidden="true">
                        {formatIsoDate(bucket, { weekday: 'narrow' })}
                      </span>
                    </Show>
                  </TableHead>
                )}
              </For>
              <TableHead
                scope="col"
                class="timesheet-end bg-card sticky right-0 z-10 pr-6 text-right"
              >
                {m.reports_total()}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={props.rows}>
              {(row) => (
                <tr class={ROW}>
                  <th scope="row" class={`${ROW_HEAD} max-w-40 font-normal sm:max-w-64`}>
                    <Pick
                      row={row.key}
                      class="flex max-w-full min-w-0 items-center gap-2 text-left"
                    >
                      <Show when={props.group === 'project'}>
                        <ProjectDot color={row.color ?? null} />
                      </Show>
                      <span
                        class={cn('truncate', row.muted && 'text-muted-foreground')}
                        title={row.name}
                      >
                        {row.name}
                      </span>
                    </Pick>
                  </th>
                  <For each={buckets()}>
                    {(bucket, i) => <Cell ms={row.perBucket[i()]} bucket={bucket} row={row.key} />}
                  </For>
                  <td class={`${ROW_TOTAL} font-medium`}>
                    <Pick row={row.key}>
                      <Duration ms={row.total} />
                    </Pick>
                  </td>
                </tr>
              )}
            </For>
            <tr class="border-t-2 border-b font-medium">
              <th scope="row" class={`${ROW_HEAD} font-medium`}>
                {m.reports_total()}
              </th>
              <For each={buckets()}>
                {(bucket, i) => (
                  <Cell ms={props.report.perBucket[i()]} bucket={bucket} class="font-medium" />
                )}
              </For>
              <td class={ROW_TOTAL}>
                <Duration ms={props.report.total} />
              </td>
            </tr>
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
