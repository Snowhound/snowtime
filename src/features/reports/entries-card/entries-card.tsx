// The Entries card (prototypes/reports.html): the entries behind the report, or behind the
// part chosen in one of its views, by day or merged by description. Read-only: only an
// entry's owner edits it, on the Timer page. The list loads apart from the report, so the
// timesheet never waits for it, and only in the browser while the card is open. The header's
// count and total come from the report, or for a part of it from a query of their own.
import ChevronDownIcon from 'lucide-solid/icons/chevron-down'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import MoonIcon from 'lucide-solid/icons/moon'
import XIcon from 'lucide-solid/icons/x'
import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from 'solid-js'
import { Duration } from '~/components/duration'
import { ErrorAlert } from '~/components/error-alert'
import { ProjectDot } from '~/components/project-dot'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardHeader, CardTitle } from '~/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { readCookie, writeCookie } from '~/lib/cookies'
import { useFormatHours, useHourCycle } from '~/lib/display-format'
import { errorMessage } from '~/lib/errors'
import { formatDateTime, formatIsoDate } from '~/lib/format'
import type { Project } from '~/lib/queries/projects'
import { useInfiniteQuery, useQuery } from '~/lib/queries/use-query'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { EntryFilters, EntryView } from '../filters'
import { type ReportEntries, reportEntriesQuery, reportEntryTotalsQuery } from '../queries'
import { type RowNames, memberName } from '../rows'
import { type DayPage, type EntryPiece, entryDays, peopleLabel } from './entry-groups'

// Flags kept in this browser: whether the user has narrowed the list from the timesheet, after
// which the header's hint on how to do that no longer shows, and whether they left the list
// open. It starts closed, showing only the header, until they open it. They are cookies, so
// the server renders the card as the browser shows it.
const NARROWED_KEY = 'snowtime.reportEntriesNarrowed'
const OPEN_KEY = 'snowtime.reportEntriesOpen'

function readFlag(key: string) {
  return readCookie(key) === '1'
}

function writeFlag(key: string, on: boolean) {
  writeCookie(key, on ? '1' : null)
}

type DescriptionRow = Extract<ReportEntries, { view: 'description' }>['rows'][number]

export function EntriesCard(props: {
  organizationId: string
  filters: EntryFilters
  // The timesheet part the list narrows to, named; null when it lists the whole report.
  narrowLabel: string | null
  // The whole report's entries and time.
  whole: { count: number; total: number }
  zone: string
  projects: Project[]
  names: Pick<RowNames, 'userId' | 'members' | 'former'>
  onView: (view: EntryView) => void
  onClear: () => void
}) {
  const [hint, setHint] = createSignal(!readFlag(NARROWED_KEY))
  const [open, setOpen] = createSignal(readFlag(OPEN_KEY))
  const entries = useInfiniteQuery(() => ({
    ...reportEntriesQuery(props.organizationId, props.filters.input),
    enabled: open(),
  }))
  const narrowed = useQuery(() => ({
    ...reportEntryTotalsQuery(
      props.organizationId,
      props.filters.totals ?? { report: props.filters.input.report },
    ),
    enabled: props.filters.totals !== null,
  }))
  function toggle(next: boolean) {
    setOpen(next)
    writeFlag(OPEN_KEY, next)
  }
  // Choosing a part of the timesheet asks for its entries, so it opens the list.
  createEffect(() => {
    if (!props.narrowLabel) return
    writeFlag(NARROWED_KEY, true)
    setHint(false)
    toggle(true)
  })

  function summary() {
    return props.filters.totals ? narrowed.data : props.whole
  }
  function first() {
    return entries.data?.pages[0]
  }
  function nameOf(userId: string) {
    return memberName(userId, props.names)
  }
  const days = createMemo(() => {
    const pages = entries.data?.pages.filter((p): p is DayPage => p.view === 'day') ?? []
    return entryDays(pages, props.filters.many ? nameOf : null)
  })
  function rows(): DescriptionRow[] {
    return entries.data?.pages.flatMap((p) => (p.view === 'description' ? p.rows : [])) ?? []
  }
  function rowCount() {
    const page = first()
    return page?.view === 'description' ? page.rowCount : 0
  }

  function project(id: string | null) {
    return id ? props.projects.find((p) => p.id === id) : undefined
  }

  return (
    <Card class="min-w-0 scroll-mt-4 overflow-hidden" id="report-entries">
      <CardHeader
        class={cn(
          'flex-row flex-wrap items-start justify-between gap-2 space-y-0',
          open() && 'pb-4',
        )}
      >
        <div class="grid min-w-0 gap-1.5">
          <CardTitle class="text-base">
            <button
              type="button"
              class="hover:text-foreground/80 focus-visible:ring-ring -mx-1 flex items-center gap-1.5 rounded-sm px-1 focus-visible:ring-2 focus-visible:outline-none"
              aria-expanded={open()}
              aria-controls="report-entries-list"
              onClick={() => toggle(!open())}
            >
              <ChevronDownIcon
                class={cn('size-4 transition-transform', !open() && '-rotate-90')}
                aria-hidden="true"
              />
              {m.reports_entries()}
            </button>
          </CardTitle>
          <div class="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Show when={summary()}>
              {(s) => (
                <span class="tabular-nums">
                  {m.reports_entries_count({ count: s().count })} · <Duration ms={s().total} />
                </span>
              )}
            </Show>
            <Show
              when={props.narrowLabel}
              fallback={
                <Show when={hint()}>
                  <span>{m.reports_entries_hint()}</span>
                </Show>
              }
            >
              {(label) => (
                <Badge variant="secondary" class="max-w-full gap-1 py-0.5 pr-0.5 font-medium">
                  <span class="truncate">{label()}</span>
                  <button
                    type="button"
                    class="hover:bg-background/60 focus-visible:ring-ring rounded-sm p-0.5 focus-visible:ring-2 focus-visible:outline-none"
                    aria-label={m.reports_entries_clear()}
                    onClick={() => props.onClear()}
                  >
                    <XIcon class="size-3.5" aria-hidden="true" />
                  </button>
                </Badge>
              )}
            </Show>
          </div>
        </div>
        <Show when={open()}>
          <ToggleGroup
            variant="outline"
            size="sm"
            class="justify-start"
            aria-label={m.reports_entries_view()}
            value={props.filters.view}
            onChange={(value) => value && props.onView(value as EntryView)}
          >
            <ToggleGroupItem value="day">{m.reports_entries_by_day()}</ToggleGroupItem>
            <ToggleGroupItem value="description">
              {m.reports_entries_by_description()}
            </ToggleGroupItem>
          </ToggleGroup>
        </Show>
      </CardHeader>
      <Show when={entries.error ?? narrowed.error}>
        {(error) => (
          <div class="px-6 pb-4">
            <ErrorAlert message={errorMessage(error())} />
          </div>
        )}
      </Show>
      <div id="report-entries-list">
        <Show when={open()}>
          <Show
            when={first()}
            fallback={
              <Show when={entries.isPending}>
                <p class="text-muted-foreground border-t px-6 py-4 text-sm" role="status">
                  {m.reports_entries_loading()}
                </p>
              </Show>
            }
          >
            <div
              class={cn('border-t transition-opacity', entries.isPlaceholderData && 'opacity-60')}
              aria-busy={entries.isPlaceholderData || entries.isFetchingNextPage}
            >
              <Switch>
                <Match when={first()?.view === 'day'}>
                  <ul>
                    <For each={days()}>
                      {(day) => (
                        <li>
                          <h4 class="bg-muted/50 flex items-baseline justify-between gap-4 border-b px-6 py-1.5 text-sm font-medium">
                            <span>
                              {formatIsoDate(day.date, {
                                weekday: 'long',
                                day: 'numeric',
                                month: 'long',
                              })}
                            </span>
                            <span class="tabular-nums">
                              <Duration ms={day.total} />
                            </span>
                          </h4>
                          <ul>
                            <For each={day.pieces}>
                              {(piece) => (
                                <EntryRow
                                  piece={piece}
                                  many={props.filters.many}
                                  zone={props.zone}
                                  project={project(piece.projectId)}
                                  person={nameOf(piece.userId)}
                                />
                              )}
                            </For>
                          </ul>
                        </li>
                      )}
                    </For>
                  </ul>
                  <Show when={entries.hasNextPage}>
                    <More
                      busy={entries.isFetchingNextPage}
                      onClick={() => void entries.fetchNextPage()}
                    >
                      {m.reports_entries_more()}
                    </More>
                  </Show>
                </Match>
                <Match when={first()?.view === 'description'}>
                  <ul>
                    <DescriptionHeader many={props.filters.many} />
                    <For each={rows()}>
                      {(row) => (
                        <DescriptionItem
                          row={row}
                          many={props.filters.many}
                          project={project(row.projectId)}
                          people={peopleLabel(row.userIds, nameOf)}
                        />
                      )}
                    </For>
                  </ul>
                  <Show when={entries.hasNextPage}>
                    <More
                      busy={entries.isFetchingNextPage}
                      onClick={() => void entries.fetchNextPage()}
                    >
                      {m.reports_entries_all({ count: rowCount() })}
                    </More>
                  </Show>
                </Match>
              </Switch>
            </div>
          </Show>
        </Show>
      </div>
    </Card>
  )
}

function More(props: { busy: boolean; onClick: () => void; children: string }) {
  return (
    <div class="border-t px-4 py-2">
      <Button variant="ghost" size="sm" disabled={props.busy} onClick={() => props.onClick()}>
        {props.busy ? (
          <LoaderCircleIcon class="animate-spin" aria-hidden="true" />
        ) : (
          <ChevronDownIcon aria-hidden="true" />
        )}
        {props.children}
      </Button>
    </div>
  )
}

function ProjectLabel(props: { project: Project | undefined; class?: string }) {
  return (
    <span class={cn('flex min-w-0 items-center gap-2', props.class)}>
      <ProjectDot color={props.project?.color ?? null} />
      <span class={cn('truncate', !props.project && 'text-muted-foreground')}>
        {props.project?.name ?? m.reports_no_project()}
      </span>
    </span>
  )
}

// The description, then the ticket, as the timer shows them.
function DescriptionText(props: { text: string; ticket: string | null; class?: string }) {
  return (
    <span class={cn('flex min-w-0 items-center gap-1.5', props.class)}>
      <Show
        when={props.text}
        fallback={
          <Show when={!props.ticket}>
            <span class="text-muted-foreground italic">{m.timer_no_description()}</span>
          </Show>
        }
      >
        <span class="truncate" title={props.text}>
          {props.text}
        </span>
      </Show>
      <Show when={props.ticket}>
        {(ticket) => (
          <Badge variant="secondary" class="h-5 min-w-0 shrink-0 px-1.5 font-medium tabular-nums">
            <span class="truncate">{ticket()}</span>
          </Badge>
        )}
      </Show>
    </span>
  )
}

// One piece of an entry: its whole start and end, and the time that counts on the day. A moon
// marks an entry that crosses midnight, whose piece is only part of it.
function EntryRow(props: {
  piece: EntryPiece
  many: boolean
  zone: string
  project: Project | undefined
  person: string
}) {
  const hourCycle = useHourCycle()
  const formatHours = useFormatHours()
  function clock(at: Date) {
    return formatDateTime(at, props.zone, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: hourCycle(),
    })
  }
  function split() {
    const p = props.piece
    // A running entry's last piece ends now; its earlier ones end at midnight.
    return p.startedAt < p.from || (p.stoppedAt ? p.stoppedAt > p.to : !p.running)
  }
  // One grid: below 640 px the time, project, and member wrap under the description; from
  // 640 px each has a column, the time first, fixed so the rows line up.
  return (
    <li
      class={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-b px-6 py-2.5 text-sm last:border-b-0 sm:items-center',
        props.many
          ? 'sm:grid-cols-[var(--time)_minmax(0,1fr)_minmax(0,12rem)_minmax(0,9rem)_3.5rem]'
          : 'sm:grid-cols-[var(--time)_minmax(0,1fr)_minmax(0,12rem)_3.5rem]',
        hourCycle() === 'h12' ? '[--time:11.5rem]' : '[--time:9rem]',
      )}
    >
      <DescriptionText
        text={props.piece.description}
        ticket={props.piece.ticket}
        class="sm:col-start-2 sm:row-start-1"
      />
      <span class="col-start-2 row-start-1 text-right font-medium tabular-nums sm:col-start-auto sm:col-end-[-1]">
        <Duration ms={props.piece.ms} />
      </span>
      <div class="text-muted-foreground col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 sm:contents">
        <span class="flex items-center gap-1.5 whitespace-nowrap tabular-nums sm:col-start-1 sm:row-start-1">
          {clock(props.piece.startedAt)} –{' '}
          {props.piece.stoppedAt ? clock(props.piece.stoppedAt) : m.reports_entries_now()}
          <Show when={split()}>
            <span title={m.reports_entries_split({ duration: formatHours(props.piece.ms) })}>
              <MoonIcon class="size-3.5" aria-hidden="true" />
              <span class="sr-only">
                , {m.reports_entries_split({ duration: formatHours(props.piece.ms) })}
              </span>
            </span>
          </Show>
          <Show when={!props.piece.stoppedAt}>
            <Badge variant="secondary" class="px-1.5 py-0 text-[10px]">
              {m.reports_entries_running()}
            </Badge>
          </Show>
        </span>
        <ProjectLabel project={props.project} class="sm:col-start-3 sm:row-start-1" />
        <Show when={props.many}>
          <span class="truncate sm:col-start-4 sm:row-start-1">{props.person}</span>
        </Show>
      </div>
    </li>
  )
}

// Column widths shared by the By description header and rows, from 640 px.
function descriptionColumns(many: boolean) {
  return many
    ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,12rem)_4.5rem_3.5rem_3.5rem]'
    : 'sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_4.5rem_3.5rem_3.5rem]'
}

// Names the columns once instead of on every row. Screen readers get each row's counts as a
// sentence instead, so the header is hidden from them.
function DescriptionHeader(props: { many: boolean }) {
  return (
    <li
      aria-hidden="true"
      class={cn(
        'bg-muted/50 text-muted-foreground hidden gap-x-4 border-b px-6 py-1.5 text-xs font-medium sm:grid',
        descriptionColumns(props.many),
      )}
    >
      <span>{m.reports_entries_col_description()}</span>
      <span>{m.reports_group_project()}</span>
      <Show when={props.many}>
        <span>{m.reports_people()}</span>
      </Show>
      <span class="text-right">{m.reports_entries()}</span>
      <span class="text-right">{m.reports_entries_col_days()}</span>
      <span class="text-right">{m.reports_total()}</span>
    </li>
  )
}

// Below 640 px the project, counts, and people wrap under the description; from 640 px each has
// a column and the counts show as bare numbers under the header.
function DescriptionItem(props: {
  row: DescriptionRow
  many: boolean
  project: Project | undefined
  people: string
}) {
  return (
    <li
      class={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-b px-6 py-2.5 text-sm last:border-b-0 sm:items-center',
        descriptionColumns(props.many),
      )}
    >
      <DescriptionText
        text={props.row.description}
        ticket={props.row.ticket}
        class="sm:col-start-1 sm:row-start-1"
      />
      <span class="col-start-2 row-start-1 text-right font-medium tabular-nums sm:col-start-auto sm:col-end-[-1]">
        <Duration ms={props.row.total} />
      </span>
      <div class="text-muted-foreground col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 sm:contents">
        <ProjectLabel project={props.project} class="sm:col-start-2 sm:row-start-1" />
        <span class="sm:sr-only">
          {m.reports_entries_count({ count: props.row.entries })}{' '}
          {m.reports_entries_days({ count: props.row.days })}
        </span>
        <Show when={props.many}>
          <span class="min-w-0 truncate sm:col-start-3 sm:row-start-1">{props.people}</span>
        </Show>
        <span
          aria-hidden="true"
          class="hidden text-right tabular-nums sm:col-start-[-4] sm:row-start-1 sm:block"
        >
          {props.row.entries}
        </span>
        <span
          aria-hidden="true"
          class="hidden text-right tabular-nums sm:col-start-[-3] sm:row-start-1 sm:block"
        >
          {props.row.days}
        </span>
      </div>
    </li>
  )
}
