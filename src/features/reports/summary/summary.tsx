// The Summary view (prototypes/reports.html, Summary): a line with the total, the average per
// tracked day, and the top project; time per day or week by project, as a chart or a table;
// and each row's share by the chosen grouping. It reads on a phone, where the timesheet
// scrolls sideways. A column narrows the Entries card to its day or week, and a row's total to
// its row.
import { For, Show } from 'solid-js'
import { CopyableDuration } from '~/components/copy-duration'
import { Duration } from '~/components/duration'
import { ProjectDot } from '~/components/project-dot'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { type IsoDate, type WeekStart, startOfWeek } from '~/lib/calendar'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { type ReportPart, bucketLabel } from '../buckets'
import { EmptyState } from '../empty-state'
import { type Group, SHARE_TITLES } from '../filters'
import { PickHint } from '../pick-button'
import type { Report } from '../queries'
import type { Range } from '../range'
import type { Row } from '../rows'
import { ShareRow, sharePercent } from '../share-bar'
import { type Series, chartSeries } from './chart-series'
import { summaryStats } from './stats'
import { SeriesDot, TimeChart } from './time-chart'

export function Summary(props: {
  report: Report
  // Always by project, for the chart; `rows` follow the grouping.
  projectRows: Row[]
  rows: Row[]
  group: Group
  range: Range
  today: IsoDate
  weekStart: WeekStart
  picked: ReportPart
  onPick: (part: ReportPart) => void
}) {
  function unit() {
    return props.report.unit
  }
  function series() {
    return chartSeries(props.projectRows)
  }
  function current() {
    return unit() === 'week' ? startOfWeek(props.today, props.weekStart) : props.today
  }
  function chartTitle() {
    return unit() === 'week' ? m.reports_chart_title_week() : m.reports_chart_title_day()
  }

  return (
    <Show
      when={props.report.total > 0}
      fallback={
        <Card class="min-w-0">
          <CardHeader class="pb-4">
            <CardTitle class="text-base">{chartTitle()}</CardTitle>
          </CardHeader>
          <EmptyState />
        </Card>
      }
    >
      <div class="grid grid-cols-[minmax(0,1fr)] gap-6">
        <PickHint id="summary-pick-hint" />
        <Card class="min-w-0">
          <Tabs defaultValue="chart">
            <CardHeader class="flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-4">
              <div class="grid min-w-0 gap-1.5">
                <CardTitle class="text-base">{chartTitle()}</CardTitle>
                <Stats
                  report={props.report}
                  range={props.range}
                  today={props.today}
                  top={props.projectRows[0]}
                />
              </div>
              <TabsList aria-label={m.reports_chart_views()} class="h-9">
                <TabsTrigger value="chart" class="py-1">
                  {m.reports_chart()}
                </TabsTrigger>
                <TabsTrigger value="table" class="py-1">
                  {m.reports_chart_table()}
                </TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent>
              <TabsContent value="chart" class="mt-0 grid grid-cols-[minmax(0,1fr)] gap-4">
                <ul
                  class="flex flex-wrap gap-x-4 gap-y-1.5 text-xs"
                  aria-label={m.reports_chart_projects()}
                >
                  <For each={series()}>
                    {(s) => (
                      <li class="flex max-w-full min-w-0 items-center gap-1.5">
                        <SeriesDot color={s.color} />
                        <span
                          class={cn('truncate sm:max-w-56', s.muted && 'text-muted-foreground')}
                        >
                          {s.name}
                        </span>
                        <span class="text-muted-foreground tabular-nums">
                          <CopyableDuration ms={s.total} />
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
                <TimeChart
                  series={series()}
                  buckets={props.report.buckets}
                  totals={props.report.perBucket}
                  unit={unit()}
                  current={current()}
                  picked={props.picked.row ? undefined : props.picked.bucket}
                  onPick={(bucket) => props.onPick({ bucket })}
                />
              </TabsContent>
              <TabsContent value="table" class="mt-0">
                <ChartTable report={props.report} series={series()} />
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
        <Card class="min-w-0">
          <CardHeader class="pb-4">
            <CardTitle class="text-base">{SHARE_TITLES[props.group]()}</CardTitle>
            <Show when={props.group === 'team'}>
              <CardDescription>{m.reports_team_note()}</CardDescription>
            </Show>
          </CardHeader>
          <CardContent>
            <ul class="grid gap-3">
              <For each={props.rows}>
                {(row) => (
                  <li>
                    <ShareRow
                      row={row}
                      of={props.report.total}
                      dot={props.group === 'project'}
                      pick={{
                        pressed: props.picked.row === row.key && !props.picked.bucket,
                        hint: 'summary-pick-hint',
                        onClick: () => props.onPick({ row: row.key }),
                      }}
                    />
                  </li>
                )}
              </For>
            </ul>
          </CardContent>
        </Card>
      </div>
    </Show>
  )
}

function Stats(props: { report: Report; range: Range; today: IsoDate; top?: Row }) {
  function stats() {
    return summaryStats(props.report, props.range, props.today)
  }
  return (
    <div class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-sm">
      <span>
        {m.reports_total()} <Value ms={stats().total} />
      </span>
      <Dot />
      <span>
        {m.reports_stats_average()} <Value ms={stats().average} />{' '}
        {m.reports_stats_per_day({ tracked: stats().tracked, count: stats().days })}
      </span>
      <Show when={props.top}>
        {(top) => (
          <>
            <Dot />
            <span class="inline-flex max-w-full min-w-0 items-center gap-1.5">
              {m.reports_stats_top()}
              <ProjectDot color={top().color ?? null} />
              <span
                class={cn(
                  'truncate font-medium sm:max-w-56',
                  top().muted ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {top().name}
              </span>
              {sharePercent(top().total, stats().total)}%
            </span>
          </>
        )}
      </Show>
    </div>
  )
}

function Value(props: { ms: number }) {
  return (
    <span class="text-foreground font-medium tabular-nums">
      <CopyableDuration ms={props.ms} />
    </span>
  )
}

function Dot() {
  return (
    <span aria-hidden="true" class="hidden sm:inline">
      ·
    </span>
  )
}

// The chart's values as a table, for reading exact numbers and for screen readers.
function ChartTable(props: { report: Report; series: Series[] }) {
  return (
    <div class="rounded-md border">
      <Table class="min-w-[28rem]">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">
              {props.report.unit === 'week' ? m.reports_unit_week() : m.reports_unit_day()}
            </TableHead>
            <For each={props.series}>
              {(s) => (
                <TableHead scope="col" class="text-right">
                  <span class="inline-flex max-w-40 items-center gap-1.5">
                    <SeriesDot color={s.color} />
                    <span class="truncate" title={s.name}>
                      {s.name}
                    </span>
                  </span>
                </TableHead>
              )}
            </For>
            <TableHead scope="col" class="text-right">
              {m.reports_total()}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <For each={props.report.buckets}>
            {(bucket, i) => (
              <TableRow>
                <TableCell class="whitespace-nowrap">
                  {bucketLabel(bucket, props.report.unit)}
                </TableCell>
                <For each={props.series}>
                  {(s) => (
                    <TableCell
                      class={cn(
                        'text-right tabular-nums',
                        !s.perBucket[i()] && 'text-muted-foreground',
                      )}
                    >
                      {s.perBucket[i()] ? <CopyableDuration ms={s.perBucket[i()]} /> : '—'}
                    </TableCell>
                  )}
                </For>
                <TableCell class="text-right font-medium tabular-nums">
                  {/* An empty day's 0:00 is read, not copied. */}
                  <Show when={props.report.perBucket[i()]} fallback={<Duration ms={0} />}>
                    <CopyableDuration ms={props.report.perBucket[i()]} />
                  </Show>
                </TableCell>
              </TableRow>
            )}
          </For>
        </TableBody>
      </Table>
    </div>
  )
}
