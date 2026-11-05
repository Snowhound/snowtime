// The day cards of the Bar and Focus layouts (prototypes/timer.html): a card per day,
// newest first, with the day's total, and per entry its fields (entry-fields.tsx) and the
// continue and delete actions. The ticket chip follows the text, or with the Wide page setting
// has a column of its own. The parts the Table layout shares are exported.
import CheckIcon from 'lucide-solid/icons/check'
import ClockIcon from 'lucide-solid/icons/clock'
import EllipsisVerticalIcon from 'lucide-solid/icons/ellipsis-vertical'
import PlayIcon from 'lucide-solid/icons/play'
import RepeatIcon from 'lucide-solid/icons/repeat'
import TrashIcon from 'lucide-solid/icons/trash'
import Undo2Icon from 'lucide-solid/icons/undo-2'
import { For, Show, createEffect, on } from 'solid-js'
import { CopyableDuration } from '~/components/copy-duration'
import { PlainButton } from '~/components/plain-button'
import { Glass } from '~/components/scene/glass'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { type WeekStart, addDays } from '~/lib/calendar'
import { formatIsoDate } from '~/lib/format'
import type { Project } from '~/lib/queries/projects'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { CalendarEvent } from '~/server/calendar/calendar.schemas'
import type { DayGroup } from './entries'
import { entryName } from './entries'
import {
  DateField,
  DurationField,
  InlineDescription,
  NextDayMark,
  ProjectField,
  ClockRoom,
  REVEAL,
  RowError,
  type SaveEntry,
  TicketCell,
  TimeField,
  createEntryEditor,
} from './entry-fields'
import { createLazyDays } from './lazy-days'
import { MeetingRow } from './meetings/meeting-row'
import type { Entry, StoppedEntry } from './queries'
import { createRowActivation } from './row-activation'

export function dayLabel(date: string, today: string) {
  if (date === today) return m.timer_today()
  if (date === addDays(today, -1)) return m.timer_yesterday()
  return formatIsoDate(date, { weekday: 'short', day: 'numeric', month: 'short' })
}

export interface EntryRowProps {
  tickets: readonly string[]
  projects: readonly Project[]
  zone: string
  weekStart: WeekStart
  // The compactRows setting.
  compact: boolean
  // The wideTimer setting: tickets get a column of their own.
  wide: boolean
  // The organization's Issue links setting, for the chips.
  issueLinks: string | null
  onSave: SaveEntry
  // Whether the entry's last save was confirmed a moment ago.
  justSaved: (id: string) => boolean
  // Whether a change to the entry waits for the busy server, and the retry that sends it.
  pending: (id: string) => boolean
  onRetry: () => void
  onContinue: (entry: Entry) => void
  onDelete: (entry: Entry) => void
  // Opens the entry popover at Repeat, by the row.
  onRepeat: (entry: Entry, anchor: HTMLElement) => void
  // The Undo of the change that just added the entry, while it can still be taken back.
  undo?: (id: string) => (() => void) | undefined
}

// Brings a row the server just confirmed into view, such as one a new date moved to
// another day, also when its day mounts for it (lazy-days.ts). Returns the row's ref.
export function revealWhenSaved(props: EntryRowProps & { entry: Entry }) {
  let row: HTMLElement | undefined
  createEffect(
    on(
      () => props.justSaved(props.entry.id),
      (saved) => saved && row?.scrollIntoView({ block: 'nearest' }),
    ),
  )
  return (el: HTMLElement) => (row = el)
}

// The row's tint while it shows "Saved".
export function savedTint(saved: boolean) {
  return cn('transition-colors duration-700', saved && 'bg-primary/10')
}

// Rows are keyed by date and id, not by object: every save replaces the entry objects,
// and a new row would lose the focus of the field being tabbed to.
export function groupDates(groups: readonly DayGroup<StoppedEntry>[]) {
  return groups.map((g) => g.date)
}

export function groupIds(group: DayGroup<StoppedEntry> | undefined) {
  return group?.entries.map((e) => e.id) ?? []
}

export function hasJustSaved(props: EntryRowProps, group: DayGroup<StoppedEntry> | undefined) {
  return group?.entries.some((e) => props.justSaved(e.id)) ?? false
}

// Rows' heights as rendered, with their divider, for a day's placeholder until it mounts. Below
// 768 px a row wraps onto three lines, 72 px taller. A wrong height only moves content off
// screen.
function rowHeight(rows: { compact: boolean; focus?: boolean }) {
  return rows.compact ? 41 : rows.focus ? 57 : 65
}

// Unlogged meetings, shown as rows among a day's entries.
export interface ListMeetings {
  on: (date: string) => readonly CalendarEvent[]
  formatTime: (ms: number) => string
  now: () => number
  onOpen: (event: CalendarEvent, anchor: HTMLElement) => void
  onLog: (event: CalendarEvent, untilNow?: boolean) => void
}

// A day's rows newest first: entry ids, and meeting keys prefixed `event:`.
function rowKeys(group: DayGroup<StoppedEntry> | undefined, meetings: readonly CalendarEvent[]) {
  if (!meetings.length) return groupIds(group)
  return [
    ...(group?.entries.map((e) => ({ key: e.id, at: e.startedAt.getTime() })) ?? []),
    ...meetings.map((e) => ({ key: `event:${e.key}`, at: e.startedAt.getTime() })),
  ]
    .sort((a, b) => b.at - a.at)
    .map((row) => row.key)
}

export function EntryList(
  props: EntryRowProps & {
    groups: readonly DayGroup<StoppedEntry>[]
    today: string
    focus?: boolean
    meetings?: ListMeetings
  },
) {
  const lazyDay = createLazyDays(() => props.groups)
  return (
    <For each={groupDates(props.groups)}>
      {(date) => {
        function group() {
          return props.groups.find((g) => g.date === date)
        }
        const lazy = lazyDay(date, () => hasJustSaved(props, group()))
        function height(extra: number) {
          return `${groupIds(group()).length * (rowHeight(props) + extra)}px`
        }
        // Days off screen skip layout and paint, which makes a resize of a long list about
        // three times faster. Until a day has rendered once, its size is the rows' estimate
        // plus the 43 px header. The card itself isn't contained, since containment would fix
        // its glass copy to the card instead of the screen.
        return (
          <Card class="overflow-hidden">
            <div
              class="[contain-intrinsic-size:auto_calc(var(--rows)+43px)] [content-visibility:auto] md:[contain-intrinsic-size:auto_calc(var(--rows-md)+43px)]"
              style={{ '--rows': height(72), '--rows-md': height(0) }}
            >
              <header class="flex items-center justify-between border-b px-4 py-2.5 text-sm">
                <h2 class="font-medium">{dayLabel(date, props.today)}</h2>
                <span class="text-muted-foreground tabular-nums">
                  <CopyableDuration ms={group()?.total ?? 0} side="left" />
                </span>
              </header>
              <Show
                when={lazy.shown()}
                fallback={<div ref={lazy.placeholder} class="h-(--rows) md:h-(--rows-md)" />}
              >
                <ul class="divide-y">
                  <For each={rowKeys(group(), props.meetings?.on(date) ?? [])}>
                    {(key) => {
                      const meeting = key.startsWith('event:')
                        ? props.meetings?.on(date).find((e) => `event:${e.key}` === key)
                        : undefined
                      return (
                        <Show
                          when={meeting}
                          fallback={
                            <EntryRow
                              {...props}
                              entry={group()!.entries.find((e) => e.id === key)!}
                              focus={props.focus}
                            />
                          }
                        >
                          {(event) => (
                            <MeetingRow
                              event={event()}
                              compact={props.compact}
                              wide={props.wide}
                              formatTime={props.meetings!.formatTime}
                              now={props.meetings!.now()}
                              onOpen={props.meetings!.onOpen}
                              onLog={props.meetings!.onLog}
                            />
                          )}
                        </Show>
                      )
                    }}
                  </For>
                </ul>
              </Show>
            </div>
          </Card>
        )
      }}
    </For>
  )
}

function EntryRow(props: EntryRowProps & { entry: StoppedEntry; focus?: boolean }) {
  const editor = createEntryEditor(props)
  const activation = createRowActivation()
  const ref = revealWhenSaved(props)
  return (
    <li
      ref={(el) => {
        ref(el)
        activation.ref(el)
      }}
      class={cn(
        'group px-4',
        props.compact ? 'py-1' : props.focus ? 'py-2' : 'py-3',
        savedTint(props.justSaved(props.entry.id)),
      )}
    >
      <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 md:flex">
        <div class="col-span-2 -ml-2 min-w-0 md:flex-1">
          {/* With Wide page, the chip moves to the Ticket column from 1280 px, and below
              768 px to the project's line; between them a column leaves no room for the text. */}
          <InlineDescription
            editor={editor}
            entry={props.entry}
            issueLinks={props.issueLinks}
            chipClass={props.wide ? 'max-md:hidden xl:hidden' : undefined}
          />
        </div>
        <div class="-ml-2 flex min-w-0 items-center gap-2 md:contents">
          <Show when={props.wide}>
            <div class="order-last flex min-w-0 shrink-0 md:hidden xl:order-none xl:flex xl:w-32">
              <TicketCell
                editor={editor}
                entry={props.entry}
                issueLinks={props.issueLinks}
                tickets={props.tickets}
                active={activation.active()}
              />
            </div>
          </Show>
          <div class="min-w-0 md:w-36 md:shrink-0">
            <ProjectField
              editor={editor}
              entry={props.entry}
              projects={props.projects}
              active={activation.active()}
            />
          </div>
        </div>
        <div class="text-muted-foreground row-start-3 -ml-2 flex shrink-0 items-center gap-1 md:ml-0">
          <DateField
            editor={editor}
            zone={props.zone}
            weekStart={props.weekStart}
            active={activation.active()}
          />
          <TimeField editor={editor} field="start" active={activation.active()} />
          <span aria-hidden="true">–</span>
          <TimeField editor={editor} field="end" active={activation.active()} />
          <NextDayMark editor={editor} />
          <ClockRoom />
        </div>
        <DurationField editor={editor} class="row-start-3 shrink-0 justify-self-end" />
        <div class="col-start-2 row-start-2 justify-self-end">
          {/* Undo takes the actions' place at their width, so the columns don't move. */}
          <Show
            when={props.undo?.(props.entry.id)}
            fallback={
              <EntryActions
                entry={props.entry}
                saved={props.justSaved(props.entry.id)}
                pending={props.pending(props.entry.id)}
                compact={props.compact}
                active={activation.active()}
                onContinue={props.onContinue}
                onDelete={props.onDelete}
                onRepeat={props.onRepeat}
                onRetry={props.onRetry}
              />
            }
          >
            {(undo) => (
              <div class={cn('flex justify-end', props.compact ? 'w-17' : 'w-21')}>
                <Button variant="link" size="sm" class="h-auto gap-1 p-0" onClick={() => undo()()}>
                  <Undo2Icon aria-hidden="true" />
                  {m.calendar_undo()}
                </Button>
              </div>
            )}
          </Show>
        </div>
      </div>
      <RowError editor={editor} />
    </li>
  )
}

// The row's continue and more actions. After a confirmed save, "Saved" takes their place for
// a moment, and while the busy server hasn't saved a change, "Not saved" over "Try again"
// does. They stay mounted underneath, so a button being tabbed to keeps its focus. Compact
// buttons match the fields' height. The menu mounts while the row is `active`.
export function EntryActions(props: {
  entry: Entry
  saved: boolean
  pending: boolean
  compact: boolean
  active: boolean
  onContinue: (entry: Entry) => void
  onDelete: (entry: Entry) => void
  onRepeat: (entry: Entry, anchor: HTMLElement) => void
  onRetry: () => void
}) {
  let root: HTMLDivElement | undefined
  let repeating = false
  function description() {
    return entryName(props.entry)
  }
  const more = {
    variant: 'ghost',
    size: 'icon',
    get class() {
      return cn(props.compact && 'size-8')
    },
    get 'aria-label'() {
      return description()
        ? m.timer_entry_actions({ description: description() })
        : m.timer_entry_actions_unnamed()
    },
  } as const
  return (
    <div ref={root} class="relative">
      <div
        class={cn(
          'flex items-center gap-1',
          REVEAL,
          'sm:has-data-expanded:opacity-100',
          (props.saved || props.pending) &&
            'pointer-events-none opacity-0 sm:opacity-0 sm:group-focus-within:opacity-0 sm:group-hover:opacity-0',
        )}
      >
        <PlainButton
          variant="ghost"
          size="icon"
          class={cn(props.compact && 'size-8')}
          aria-label={
            description()
              ? m.timer_continue({ description: description() })
              : m.timer_continue_unnamed()
          }
          onClick={() => props.onContinue(props.entry)}
        >
          <PlayIcon aria-hidden="true" />
        </PlainButton>
        <Show
          when={props.active}
          fallback={
            <PlainButton {...more} aria-haspopup="menu" aria-expanded={false}>
              <EllipsisVerticalIcon aria-hidden="true" />
            </PlainButton>
          }
        >
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger as={Button<'button'>} {...more}>
              <EllipsisVerticalIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              class="w-40"
              // Repeat… opens the entry popover once the closing menu has given its trigger the
              // focus back, which it does after this; taking it from an open popover closes it.
              onCloseAutoFocus={() => {
                if (!repeating) return
                repeating = false
                const anchor = root!.closest<HTMLElement>('li, tr') ?? root!
                setTimeout(() => props.onRepeat(props.entry, anchor))
              }}
            >
              <DropdownMenuItem class="gap-2" onSelect={() => (repeating = true)}>
                <RepeatIcon class="size-4" aria-hidden="true" />
                {m.menu_copy_days()}
              </DropdownMenuItem>
              <DropdownMenuItem
                class="text-destructive focus:text-destructive gap-2"
                onSelect={() => props.onDelete(props.entry)}
              >
                <TrashIcon class="size-4" aria-hidden="true" />
                {m.timer_delete()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Show>
      </div>
      <p
        role="status"
        class={cn(
          'text-primary pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1 text-xs font-medium whitespace-nowrap transition-opacity duration-300',
          props.saved && !props.pending ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Show when={props.saved && !props.pending}>
          <CheckIcon class="size-3.5" aria-hidden="true" />
          {m.timer_entry_saved()}
        </Show>
      </p>
      <Show when={props.pending}>
        <div class="text-warning absolute inset-y-0 right-0 flex items-center gap-1.5 text-xs font-medium whitespace-nowrap">
          <ClockIcon class="size-3.5" aria-hidden="true" />
          <div class="flex flex-col items-start leading-4">
            <span role="status">{m.timer_entry_not_saved()}</span>
            <Button
              variant="link"
              size="sm"
              class="text-warning h-auto p-0 text-xs leading-4"
              onClick={() => props.onRetry()}
            >
              {m.page_error_retry()}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

export function EmptyState() {
  return (
    <div class="surface bg-background flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
      <Glass />
      <ClockIcon class="text-muted-foreground size-6" aria-hidden="true" />
      <p class="font-medium">{m.timer_empty_title()}</p>
      <p class="text-muted-foreground text-sm">{m.timer_empty_description()}</p>
    </div>
  )
}
