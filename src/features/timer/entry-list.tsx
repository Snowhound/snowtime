// The day cards of the Bar and Focus layouts (prototypes/timer.html): a card per day,
// newest first, with the day's total, and per entry its fields (entry-fields.tsx) and the
// continue and delete actions. Rows are one line from 768 px and three below it. Focus
// pads them less, and compact rows (the compactRows setting) least, with smaller action
// buttons. The parts the Table layout shares are exported.
import CheckIcon from 'lucide-solid/icons/check'
import ClockIcon from 'lucide-solid/icons/clock'
import EllipsisVerticalIcon from 'lucide-solid/icons/ellipsis-vertical'
import PlayIcon from 'lucide-solid/icons/play'
import TrashIcon from 'lucide-solid/icons/trash'
import { For, Show, createEffect, on } from 'solid-js'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { type WeekStart, addDays, localDate } from '~/lib/calendar'
import { formatHours, formatIsoDate } from '~/lib/format'
import type { Project } from '~/lib/projects'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { DayGroup } from './entries'
import {
  DateField,
  DescriptionField,
  EntryDuration,
  NextDayMark,
  ProjectField,
  ClockRoom,
  REVEAL,
  RowError,
  type SaveEntry,
  TimeField,
  createEntryEditor,
} from './entry-fields'
import type { Entry } from './queries'

export function dayLabel(date: string, zone: string, now: number) {
  const today = localDate(now, zone)
  if (date === today) return m.timer_today()
  if (date === addDays(today, -1)) return m.timer_yesterday()
  return formatIsoDate(date, { weekday: 'short', day: 'numeric', month: 'short' })
}

export interface EntryRowProps {
  projects: readonly Project[]
  zone: string
  weekStart: WeekStart
  // The compactRows setting.
  compact: boolean
  onSave: SaveEntry
  // Whether the entry's last save was confirmed a moment ago.
  justSaved: (id: string) => boolean
  onContinue: (entry: Entry) => void
  onDelete: (entry: Entry) => void
}

// Brings a row the server just confirmed into view, such as one a new date moved to
// another day. Returns the row's ref.
export function revealWhenSaved(props: EntryRowProps & { entry: Entry }) {
  let row: HTMLElement | undefined
  createEffect(
    on(
      () => props.justSaved(props.entry.id),
      (saved) => saved && row?.scrollIntoView({ block: 'nearest' }),
      { defer: true },
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
export function groupDates(groups: readonly DayGroup<Entry>[]) {
  return groups.map((g) => g.date)
}

export function groupIds(group: DayGroup<Entry> | undefined) {
  return group?.entries.map((e) => e.id) ?? []
}

export function EntryList(
  props: EntryRowProps & {
    groups: readonly DayGroup<Entry>[]
    now: number
    focus?: boolean
  },
) {
  return (
    <For each={groupDates(props.groups)}>
      {(date) => {
        function group() {
          return props.groups.find((g) => g.date === date)
        }
        return (
          <Card class="overflow-hidden">
            <header class="flex items-center justify-between border-b px-4 py-2.5 text-sm">
              <h2 class="font-medium">{dayLabel(date, props.zone, props.now)}</h2>
              <span class="text-muted-foreground tabular-nums">
                {formatHours(group()?.total ?? 0)}
              </span>
            </header>
            <ul class="divide-y">
              <For each={groupIds(group())}>
                {(id) => (
                  <EntryRow
                    {...props}
                    entry={group()!.entries.find((e) => e.id === id)!}
                    focus={props.focus}
                  />
                )}
              </For>
            </ul>
          </Card>
        )
      }}
    </For>
  )
}

function EntryRow(props: EntryRowProps & { entry: Entry; focus?: boolean }) {
  const editor = createEntryEditor(props)
  const ref = revealWhenSaved(props)
  return (
    <li
      ref={ref}
      class={cn(
        'group px-4',
        props.compact ? 'py-1' : props.focus ? 'py-2' : 'py-3',
        savedTint(props.justSaved(props.entry.id)),
      )}
    >
      <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 md:flex">
        <div class="col-span-2 -ml-2 min-w-0 md:flex-1">
          <DescriptionField editor={editor} />
        </div>
        <div class="-ml-2 min-w-0 md:ml-0 md:w-36 md:shrink-0">
          <ProjectField editor={editor} entry={props.entry} projects={props.projects} />
        </div>
        <div class="text-muted-foreground row-start-3 -ml-2 flex shrink-0 items-center gap-1 md:ml-0">
          <DateField editor={editor} zone={props.zone} weekStart={props.weekStart} />
          <TimeField editor={editor} field="start" />
          <span aria-hidden="true">–</span>
          <TimeField editor={editor} field="end" />
          <NextDayMark editor={editor} />
          <ClockRoom />
        </div>
        <EntryDuration
          editor={editor}
          class="row-start-3 w-16 shrink-0 text-right text-sm tabular-nums"
        />
        <div class="col-start-2 row-start-2 justify-self-end">
          <EntryActions
            entry={props.entry}
            saved={props.justSaved(props.entry.id)}
            compact={props.compact}
            onContinue={props.onContinue}
            onDelete={props.onDelete}
          />
        </div>
      </div>
      <RowError editor={editor} />
    </li>
  )
}

// The row's continue and more actions. After a confirmed save, "Saved" takes their place for
// a moment; they stay mounted underneath, so a button being tabbed to keeps its focus.
// Compact buttons match the fields' height.
export function EntryActions(props: {
  entry: Entry
  saved: boolean
  compact: boolean
  onContinue: (entry: Entry) => void
  onDelete: (entry: Entry) => void
}) {
  function description() {
    return props.entry.description
  }
  return (
    <div class="relative">
      <div
        class={cn(
          'flex items-center gap-1',
          REVEAL,
          'sm:has-data-expanded:opacity-100',
          props.saved &&
            'pointer-events-none opacity-0 sm:opacity-0 sm:group-focus-within:opacity-0 sm:group-hover:opacity-0',
        )}
      >
        <Button
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
        </Button>
        <DropdownMenu placement="bottom-end">
          <DropdownMenuTrigger
            as={Button<'button'>}
            variant="ghost"
            size="icon"
            class={cn(props.compact && 'size-8')}
            aria-label={
              description()
                ? m.timer_entry_actions({ description: description() })
                : m.timer_entry_actions_unnamed()
            }
          >
            <EllipsisVerticalIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-40">
            <DropdownMenuItem
              class="text-destructive focus:text-destructive gap-2"
              onSelect={() => props.onDelete(props.entry)}
            >
              <TrashIcon class="size-4" aria-hidden="true" />
              {m.timer_delete()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p
        role="status"
        class={cn(
          'text-primary pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1 text-xs font-medium whitespace-nowrap transition-opacity duration-300',
          props.saved ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Show when={props.saved}>
          <CheckIcon class="size-3.5" aria-hidden="true" />
          {m.timer_entry_saved()}
        </Show>
      </p>
    </div>
  )
}

export function EmptyState() {
  return (
    <div class="surface bg-background flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
      <ClockIcon class="text-muted-foreground size-6" aria-hidden="true" />
      <p class="font-medium">{m.timer_empty_title()}</p>
      <p class="text-muted-foreground text-sm">{m.timer_empty_description()}</p>
    </div>
  )
}
