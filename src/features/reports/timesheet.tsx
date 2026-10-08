// The timesheet grid (prototypes/reports.html, 02 · Timesheet): a row per group and a
// column per day or week, with row and column totals and the current day or week shaded.
// It scrolls inside its card with the first and last columns sticky. Names and totals are
// buttons that narrow the Entries card to their row, day or week, or both.
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
import { CopyableDuration } from '~/components/copy-duration'
import { Duration } from '~/components/duration'
import { ProjectDot } from '~/components/project-dot'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { type IsoDate, type WeekStart, startOfWeek } from '~/lib/calendar'
import { formatIsoDate } from '~/lib/format'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { type ReportPart, bucketLabel, longRange, shortBucketLabel } from './buckets'
import { EmptyState } from './empty-state'
import { GROUP_LABELS, type Group, type Unit } from './filters'
import { PickHint } from './pick-button'
import type { Report } from './queries'
import type { Row } from './rows'

// The body's rows and cells are plain elements with ui/table's classes. Its components split
// and spread their props, which a month by 40 projects does for 1,300 cells.
const ROW = 'border-b transition-colors hover:bg-muted/50'
const ROW_HEAD =
  'timesheet-start bg-card text-foreground sticky left-0 z-10 p-2 pl-6 text-left align-middle'
const ROW_TOTAL =
  'timesheet-end bg-card sticky right-0 z-10 p-2 pr-6 text-right align-middle tabular-nums'

function partKey(part: ReportPart) {
  return `${part.row ?? ''}|${part.bucket ?? ''}`
}

export function Timesheet(props: {
  report: Report
  rows: Row[]
  group: Group
  unit: Unit
  today: IsoDate
  weekStart: WeekStart
  picked: ReportPart
  onPick: (part: ReportPart) => void
}) {
  // One comparison per change rather than one per button.
  const pressed = createSelector(() => partKey(props.picked))

  // One handler for every button. Its row is its <tr>'s `data-row`, none in the totals row, and
  // its day or week is its column's; the first and last columns are names and totals.
  function pick(event: MouseEvent) {
    const cell = (event.target as HTMLElement).closest('button')?.parentElement
    if (!(cell instanceof HTMLTableCellElement)) return
    const row = (cell.parentElement as HTMLTableRowElement).dataset.row
    props.onPick({ row, bucket: buckets()[cell.cellIndex - 1] })
  }

  function buckets() {
    return props.report.buckets
  }
  // Long ranges show the day number over its weekday.
  function long() {
    return longRange(props.unit, buckets().length)
  }

  // A memo, because every cell asks and `today` is worked out through Intl on each read.
  const currentBucket = createMemo(() =>
    props.unit === 'week' ? startOfWeek(props.today, props.weekStart) : props.today,
  )
  function current(bucket: IsoDate) {
    return bucket === currentBucket()
  }

  function Pick(part: ReportPart & { class?: string; children: JSX.Element }) {
    return (
      <button
        type="button"
        aria-pressed={pressed(partKey(part))}
        aria-describedby="timesheet-pick-hint"
        class={cn('pick', part.class)}
      >
        {part.children}
      </button>
    )
  }

  // The button is written out rather than a Pick, so that the cell and its button are one
  // template, which hydrates by one key rather than two.
  function Cell(cell: { ms: number; bucket: IsoDate; row?: string; class?: string }) {
    function shade() {
      return cn('timesheet-cell', current(cell.bucket) && 'bg-muted/50', cell.class)
    }
    return (
      <Show when={cell.ms} fallback={<td class={cn(shade(), 'text-muted-foreground/50')}>·</td>}>
        <td class={shade()}>
          <button
            type="button"
            aria-pressed={pressed(partKey(cell))}
            aria-describedby="timesheet-pick-hint"
            class="pick"
          >
            <Duration ms={cell.ms} />
          </button>
        </td>
      </Show>
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
        <PickHint id="timesheet-pick-hint" />
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
                    <span aria-hidden="true">
                      {shortBucketLabel(bucket, props.unit, buckets().length)}
                    </span>
                    <span class="sr-only">{bucketLabel(bucket, props.unit)}</span>
                    <Show when={long()}>
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
                <tr class={ROW} data-row={row.key}>
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
                <CopyableDuration ms={props.report.total} />
              </td>
            </tr>
          </TableBody>
        </Table>
      </div>
    </Show>
  )
}
