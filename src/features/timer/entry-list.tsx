// The day cards of the Bar and Focus layouts (prototypes/timer.html): a card per day,
// newest first, with the day's total, and per entry its fields (entry-fields.tsx) and the
// continue and delete actions. Rows are one line from 768 px and three below it. Focus
// shows them compact. The parts the Table layout shares are exported.
import ClockIcon from 'lucide-solid/icons/clock'
import PlayIcon from 'lucide-solid/icons/play'
import TrashIcon from 'lucide-solid/icons/trash'
import { For } from 'solid-js'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { addDays, localDate } from '~/lib/calendar'
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
  onSave: SaveEntry
  onContinue: (entry: Entry) => void
  onDelete: (entry: Entry) => void
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
    compact?: boolean
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
              <span class="text-muted-foreground font-mono tabular-nums">
                {formatHours(group()?.total ?? 0)}
              </span>
            </header>
            <ul class="divide-y">
              <For each={groupIds(group())}>
                {(id) => (
                  <EntryRow
                    {...props}
                    entry={group()!.entries.find((e) => e.id === id)!}
                    compact={props.compact}
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

function EntryRow(props: EntryRowProps & { entry: Entry; compact?: boolean }) {
  const editor = createEntryEditor(props)
  return (
    <li class={cn('group px-4', props.compact ? 'py-2' : 'py-3')}>
      <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 md:flex">
        <div class="col-span-2 -ml-2 min-w-0 md:flex-1">
          <DescriptionField editor={editor} />
        </div>
        <div class="-ml-2 min-w-0 md:ml-0 md:w-36 md:shrink-0">
          <ProjectField editor={editor} entry={props.entry} projects={props.projects} />
        </div>
        <div class="text-muted-foreground row-start-3 -ml-2 flex shrink-0 items-center gap-1 md:ml-0">
          <DateField editor={editor} zone={props.zone} />
          <TimeField editor={editor} field="start" />
          <span aria-hidden="true">–</span>
          <TimeField editor={editor} field="end" />
          <NextDayMark editor={editor} />
        </div>
        <EntryDuration
          editor={editor}
          class="row-start-3 w-16 shrink-0 text-right font-mono text-sm tabular-nums"
        />
        <div class="col-start-2 row-start-2 justify-self-end">
          <EntryActions
            entry={props.entry}
            onContinue={props.onContinue}
            onDelete={props.onDelete}
          />
        </div>
      </div>
      <RowError editor={editor} />
    </li>
  )
}

export function EntryActions(props: {
  entry: Entry
  onContinue: (entry: Entry) => void
  onDelete: (entry: Entry) => void
}) {
  function description() {
    return props.entry.description
  }
  return (
    <div class={cn('flex items-center gap-1', REVEAL)}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={
          description()
            ? m.timer_continue({ description: description() })
            : m.timer_continue_unnamed()
        }
        onClick={() => props.onContinue(props.entry)}
      >
        <PlayIcon aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={
          description() ? m.timer_delete({ description: description() }) : m.timer_delete_unnamed()
        }
        onClick={() => props.onDelete(props.entry)}
      >
        <TrashIcon aria-hidden="true" />
      </Button>
    </div>
  )
}

export function EmptyState() {
  return (
    <div class="bg-background flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
      <ClockIcon class="text-muted-foreground size-6" aria-hidden="true" />
      <p class="font-medium">{m.timer_empty_title()}</p>
      <p class="text-muted-foreground text-sm">{m.timer_empty_description()}</p>
    </div>
  )
}
