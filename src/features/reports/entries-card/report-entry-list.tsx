// The Entries card's list, by day or merged by description. It loads apart from the report, so
// the timesheet never waits for it, and the card mounts it only while open. `useInfiniteQuery`
// fetches only in the browser, so the server renders at most the loading line.
import ChevronDownIcon from 'lucide-solid/icons/chevron-down'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import MoonIcon from 'lucide-solid/icons/moon'
import { For, Match, Show, Switch, createMemo } from 'solid-js'
import { CopyableDuration } from '~/components/copy-duration'
import { CopyText } from '~/components/copy-text'
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
  // The Ticket column shows only when a listed entry has a ticket.
  function dayTickets() {
    return days().some((day) => day.pieces.some((piece) => piece.ticket))
  }
  function rowTickets() {
    return rows().some((row) => row.ticket)
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
                              tickets={dayTickets()}
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
                <DescriptionHeader many={props.filters.many} tickets={rowTickets()} />
                <For each={rows()}>
                  {(row) => (
                    <DescriptionItem
                      row={row}
                      many={props.filters.many}
                      tickets={rowTickets()}
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

// The description, then the ticket, as the timer shows them. With a Ticket column the ticket
// shows here only below 640 px, where the columns wrap.
function DescriptionText(props: {
  text: string
  ticket: string | null
  column: boolean
  class?: string
}) {
  return (
    <span class={cn('flex min-w-0 items-center gap-1.5', props.class)}>
      <Show
        when={props.text}
        fallback={
          <Show when={!props.ticket || props.column}>
            <span class={cn('text-muted-foreground italic', props.ticket && 'hidden sm:inline')}>
              {m.timer_no_description()}
            </span>
          </Show>
        }
      >
        <CopyText
          text={props.text}
          label={m.reports_copy_description({ text: props.text })}
          side="start"
          control="text"
          class="min-w-0"
        >
          <span class="block truncate" title={props.text}>
            {props.text}
          </span>
        </CopyText>
      </Show>
      <Show when={props.ticket}>
        {(ticket) => <TicketBadge ticket={ticket()} class={cn(props.column && 'sm:hidden')} />}
      </Show>
    </span>
  )
}

function TicketBadge(props: { ticket: string; class?: string }) {
  return (
    <CopyText
      text={props.ticket}
      label={m.reports_copy_ticket({ ticket: props.ticket })}
      side="start"
      control="text"
      class={cn('min-w-0 shrink-0', props.class)}
    >
      <Badge variant="secondary" class="h-5 max-w-full px-1.5 font-medium tabular-nums">
        <span class="truncate">{props.ticket}</span>
      </Badge>
    </CopyText>
  )
}

// The Ticket column's cell, from 640 px.
function TicketCell(props: { ticket: string | null; class?: string }) {
  return (
    <span class={cn('hidden min-w-0 sm:flex', props.class)}>
      <Show when={props.ticket}>{(ticket) => <TicketBadge ticket={ticket()} />}</Show>
    </span>
  )
}

// One piece of an entry: its whole start and end, and the time that counts on the day. A moon
// marks an entry that crosses midnight, whose piece is only part of it.
function EntryRow(props: {
  piece: EntryPiece
  many: boolean
  tickets: boolean
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
        'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-b px-6 py-2.5 text-sm last:border-b-0 sm:grid-cols-(--cols) sm:items-center',
      )}
      style={{
        '--cols': columns([
          hourCycle() === 'h12' ? '11.5rem' : '9rem',
          'minmax(0,1fr)',
          props.tickets && TICKET_WIDTH,
          'minmax(0,12rem)',
          props.many && 'minmax(0,9rem)',
          totalWidth(copyControl() === 'button'),
        ]),
      }}
    >
      <DescriptionText
        text={props.piece.description}
        ticket={props.piece.ticket}
        column={props.tickets}
        class="sm:col-start-2 sm:row-start-1"
      />
      <Show when={props.tickets}>
        <TicketCell ticket={props.piece.ticket} class="sm:col-start-3 sm:row-start-1" />
      </Show>
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
        <ProjectLabel
          project={props.project}
          class={cn('sm:row-start-1', props.tickets ? 'sm:col-start-4' : 'sm:col-start-3')}
        />
        <Show when={props.many}>
          <span
            class={cn(
              'truncate sm:row-start-1',
              props.tickets ? 'sm:col-start-5' : 'sm:col-start-4',
            )}
          >
            {props.person}
          </span>
        </Show>
      </div>
    </li>
  )
}

// Column widths from 640 px, set as --cols on each row (and the By description header) so
// they line up. The last column is the total, with room for the copy button when it shows.
const TICKET_WIDTH = 'minmax(0,7rem)'

function totalWidth(copyButton: boolean) {
  return copyButton ? '5.25rem' : '3.5rem'
}

function columns(widths: (string | false)[]) {
  return widths.filter(Boolean).join(' ')
}

function descriptionColumns(many: boolean, tickets: boolean, copyButton: boolean) {
  return columns([
    'minmax(0,1fr)',
    tickets && TICKET_WIDTH,
    'minmax(0,12rem)',
    many && 'minmax(0,12rem)',
    '4.5rem',
    '3.5rem',
    totalWidth(copyButton),
  ])
}

// Names the columns once instead of on every row. Screen readers get each row's counts as a
// sentence instead, so the header is hidden from them.
function DescriptionHeader(props: { many: boolean; tickets: boolean }) {
  const copyControl = useCopyControl()
  return (
    <li
      aria-hidden="true"
      class="bg-muted/50 text-muted-foreground hidden grid-cols-(--cols) gap-x-4 border-b px-6 py-1.5 text-xs font-medium sm:grid"
      style={{
        '--cols': descriptionColumns(props.many, props.tickets, copyControl() === 'button'),
      }}
    >
      <span>{m.reports_entries_col_description()}</span>
      <Show when={props.tickets}>
        <span>{m.reports_group_ticket()}</span>
      </Show>
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
  tickets: boolean
  project: Project | undefined
  people: string
}) {
  const copyControl = useCopyControl()
  return (
    <li
      class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-b px-6 py-2.5 text-sm last:border-b-0 sm:grid-cols-(--cols) sm:items-center"
      style={{
        '--cols': descriptionColumns(props.many, props.tickets, copyControl() === 'button'),
      }}
    >
      <DescriptionText
        text={props.row.description}
        ticket={props.row.ticket}
        column={props.tickets}
        class="sm:col-start-1 sm:row-start-1"
      />
      <Show when={props.tickets}>
        <TicketCell ticket={props.row.ticket} class="sm:col-start-2 sm:row-start-1" />
      </Show>
      <span class="col-start-2 row-start-1 text-right font-medium tabular-nums sm:col-start-auto sm:col-end-[-1]">
        <CopyableDuration ms={props.row.total} />
      </span>
      <div class="text-muted-foreground col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 sm:contents">
        <ProjectLabel
          project={props.project}
          class={cn('sm:row-start-1', props.tickets ? 'sm:col-start-3' : 'sm:col-start-2')}
        />
        <span class="sm:sr-only">
          {m.reports_entries_count({ count: props.row.entries })}{' '}
          {m.reports_entries_days({ count: props.row.days })}
        </span>
        <Show when={props.many}>
          <span
            class={cn(
              'min-w-0 truncate sm:row-start-1',
              props.tickets ? 'sm:col-start-4' : 'sm:col-start-3',
            )}
          >
            {props.people}
          </span>
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
