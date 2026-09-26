// The Entries card (prototypes/reports.html, 02 · Timesheet): the entries behind the report,
// or behind the timesheet part chosen, by day or merged by description. Read-only: only an
// entry's owner edits it, on the Timer page. It loads apart from the report, so the timesheet
// never waits for it.
import { useInfiniteQuery } from '@tanstack/solid-query'
import ChevronDownIcon from 'lucide-solid/icons/chevron-down'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import MoonIcon from 'lucide-solid/icons/moon'
import XIcon from 'lucide-solid/icons/x'
import { For, Match, Show, Switch, createMemo, createSignal } from 'solid-js'
import { Duration } from '~/components/duration'
import { ErrorAlert } from '~/components/error-alert'
import { ProjectDot } from '~/components/project-dot'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardHeader, CardTitle } from '~/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { useFormatHours, useHourCycle } from '~/lib/display-format'
import { errorMessage } from '~/lib/errors'
import { formatDateTime, formatIsoDate } from '~/lib/format'
import type { Member } from '~/lib/queries/members'
import type { Project } from '~/lib/queries/projects'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { EntryFilters, EntryView } from '../filters'
import { type ReportEntries, reportEntriesQuery } from '../queries'
import { memberName } from '../rows'
import { type DayPage, type EntryPiece, entryDays, peopleLabel } from './entry-groups'

// By description rows shown before "Show all".
const DESCRIPTION_ROWS = 25

type DescriptionRow = Extract<ReportEntries, { view: 'description' }>['rows'][number]

export function EntriesCard(props: {
  organizationId: string
  filters: EntryFilters
  // The timesheet part the list narrows to, named; null when it lists the whole report.
  narrowLabel: string | null
  userId: string
  zone: string
  projects: Project[]
  members: Member[]
  onView: (view: EntryView) => void
  onClear: () => void
}) {
  const entries = useInfiniteQuery(() =>
    reportEntriesQuery(props.organizationId, props.filters.input),
  )
  // The list whose By description rows all show, until the list changes.
  const [allOf, setAllOf] = createSignal<string>()
  function listKey() {
    return JSON.stringify(props.filters.input)
  }

  function first() {
    return entries.data?.pages[0]
  }
  function nameOf(userId: string) {
    return memberName(userId, { userId: props.userId, members: props.members })
  }
  const days = createMemo(() => {
    const pages = entries.data?.pages.filter((p): p is DayPage => p.view === 'day') ?? []
    return entryDays(pages, props.filters.many ? nameOf : null)
  })
  function allRows(): DescriptionRow[] {
    const page = first()
    return page?.view === 'description' ? page.rows : []
  }
  function rows() {
    return allOf() === listKey() ? allRows() : allRows().slice(0, DESCRIPTION_ROWS)
  }

  function project(id: string | null) {
    return id ? props.projects.find((p) => p.id === id) : undefined
  }

  return (
    <Card class="min-w-0 scroll-mt-4 overflow-hidden" id="report-entries">
      <CardHeader class="flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-4">
        <div class="grid min-w-0 gap-1.5">
          <CardTitle class="text-base">{m.reports_entries()}</CardTitle>
          <div class="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Show when={first()}>
              {(page) => (
                <span class="tabular-nums">
                  {m.reports_entries_count({ count: page().count })} ·{' '}
                  <Duration ms={page().total} />
                </span>
              )}
            </Show>
            <Show when={props.narrowLabel} fallback={<span>{m.reports_entries_hint()}</span>}>
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
      </CardHeader>
      <Show when={entries.error}>
        {(error) => (
          <div class="px-6 pb-4">
            <ErrorAlert message={errorMessage(error())} />
          </div>
        )}
      </Show>
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
              <Show when={allRows().length > rows().length}>
                <More busy={false} onClick={() => setAllOf(listKey())}>
                  {m.reports_entries_all({ count: allRows().length })}
                </More>
              </Show>
            </Match>
          </Switch>
        </div>
      </Show>
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

function DescriptionText(props: { text: string; class?: string }) {
  return (
    <Show
      when={props.text}
      fallback={
        <span class={cn('text-muted-foreground italic', props.class)}>
          {m.timer_no_description()}
        </span>
      }
    >
      <span class={cn('truncate', props.class)} title={props.text}>
        {props.text}
      </span>
    </Show>
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
      <DescriptionText text={props.piece.description} class="sm:col-start-2 sm:row-start-1" />
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

function DescriptionItem(props: {
  row: DescriptionRow
  many: boolean
  project: Project | undefined
  people: string
}) {
  return (
    <li class="flex items-start gap-4 border-b px-6 py-2.5 text-sm last:border-b-0">
      <div class="grid min-w-0 flex-1 gap-0.5">
        <DescriptionText text={props.row.description} />
        <div class="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
          <ProjectLabel project={props.project} />
          <span>
            {m.reports_entries_count({ count: props.row.entries })}{' '}
            {m.reports_entries_days({ count: props.row.days })}
          </span>
          <Show when={props.many}>
            <span class="min-w-0 truncate">{props.people}</span>
          </Show>
        </div>
      </div>
      <span class="w-14 shrink-0 text-right font-medium tabular-nums">
        <Duration ms={props.row.total} />
      </span>
    </li>
  )
}
