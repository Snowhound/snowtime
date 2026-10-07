// The Entries card's list, by day or merged by description. It loads apart from the report, so
// the timesheet never waits for it, and the card mounts it only while open. `useInfiniteQuery`
// fetches only in the browser, so the server renders at most the loading line.
import ChevronDownIcon from 'lucide-solid/icons/chevron-down'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import MoonIcon from 'lucide-solid/icons/moon'
import { For, Match, Show, Switch, createMemo } from 'solid-js'
import { CopyableDuration } from '~/components/copy-duration'
import { ErrorAlert } from '~/components/error-alert'
import { ProjectDot } from '~/components/project-dot'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { useCopyControl, useFormatHours, useHourCycle } from '~/lib/display-format'
import { errorMessage } from '~/lib/errors'
import { formatDateTime, formatIsoDate } from '~/lib/format'
import type { Project } from '~/lib/queries/projects'
import { useInfiniteQuery } from '~/lib/queries/use-query'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { EntryFilters } from '../filters'
import { type ReportEntries, reportEntriesQuery } from '../queries'
import { type RowNames, memberName } from '../rows'
import { type DayPage, type EntryPiece, entryDays, peopleLabel } from './entry-groups'

type DescriptionRow = Extract<ReportEntries, { view: 'description' }>['rows'][number]

export function ReportEntryList(props: {
  organizationId: string
  filters: EntryFilters
  zone: string
  projects: Project[]
  names: Pick<RowNames, 'userId' | 'members' | 'former'>
}) {
  const entries = useInfiniteQuery(() =>
    reportEntriesQuery(props.organizationId, props.filters.input),
  )

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
    <>
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
                          <CopyableDuration ms={day.total} side="left" />
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
    </>
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
  const copyControl = useCopyControl()
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
        entryColumns(props.many, copyControl() === 'button'),
        hourCycle() === 'h12' ? '[--time:11.5rem]' : '[--time:9rem]',
      )}
    >
      <DescriptionText
        text={props.piece.description}
        ticket={props.piece.ticket}
        class="sm:col-start-2 sm:row-start-1"
      />
      <span class="col-start-2 row-start-1 text-right font-medium tabular-nums sm:col-start-auto sm:col-end-[-1]">
        <CopyableDuration ms={props.piece.ms} />
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
// The last column is the total: 3.5rem, or 5.25rem with room for the copy button. The class
// names are written out whole so Tailwind finds them.
function entryColumns(many: boolean, copyButton: boolean) {
  if (many) {
    return copyButton
      ? 'sm:grid-cols-[var(--time)_minmax(0,1fr)_minmax(0,12rem)_minmax(0,9rem)_5.25rem]'
      : 'sm:grid-cols-[var(--time)_minmax(0,1fr)_minmax(0,12rem)_minmax(0,9rem)_3.5rem]'
  }
  return copyButton
    ? 'sm:grid-cols-[var(--time)_minmax(0,1fr)_minmax(0,12rem)_5.25rem]'
    : 'sm:grid-cols-[var(--time)_minmax(0,1fr)_minmax(0,12rem)_3.5rem]'
}

function descriptionColumns(many: boolean, copyButton: boolean) {
  if (many) {
    return copyButton
      ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,12rem)_4.5rem_3.5rem_5.25rem]'
      : 'sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,12rem)_4.5rem_3.5rem_3.5rem]'
  }
  return copyButton
    ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_4.5rem_3.5rem_5.25rem]'
    : 'sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_4.5rem_3.5rem_3.5rem]'
}

// Names the columns once instead of on every row. Screen readers get each row's counts as a
// sentence instead, so the header is hidden from them.
function DescriptionHeader(props: { many: boolean }) {
  const copyControl = useCopyControl()
  return (
    <li
      aria-hidden="true"
      class={cn(
        'bg-muted/50 text-muted-foreground hidden gap-x-4 border-b px-6 py-1.5 text-xs font-medium sm:grid',
        descriptionColumns(props.many, copyControl() === 'button'),
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
  const copyControl = useCopyControl()
  return (
    <li
      class={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-b px-6 py-2.5 text-sm last:border-b-0 sm:items-center',
        descriptionColumns(props.many, copyControl() === 'button'),
      )}
    >
      <DescriptionText
        text={props.row.description}
        ticket={props.row.ticket}
        class="sm:col-start-1 sm:row-start-1"
      />
      <span class="col-start-2 row-start-1 text-right font-medium tabular-nums sm:col-start-auto sm:col-end-[-1]">
        <CopyableDuration ms={props.row.total} />
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
