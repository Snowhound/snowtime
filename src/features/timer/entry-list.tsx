// The day cards of the Bar and Focus layouts (prototypes/timer.html): a card per day,
// newest first, with the day's total, and per entry its fields (entry-fields.tsx) and the
// continue and delete actions. The ticket chip follows the text, or with the Wide page setting
// has a column of its own. The parts the Table layout shares are exported.
import CheckIcon from 'lucide-solid/icons/check'
import ClockIcon from 'lucide-solid/icons/clock'
import EllipsisVerticalIcon from 'lucide-solid/icons/ellipsis-vertical'
import PlayIcon from 'lucide-solid/icons/play'
import TrashIcon from 'lucide-solid/icons/trash'
import { For, Show, createEffect, on } from 'solid-js'
import { Duration } from '~/components/duration'
import { PlainButton } from '~/components/plain-button'
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
import type { DayGroup } from './entries'
import { entryName } from './entries'
import {
  DateField,
  EntryDuration,
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
import type { Entry, StoppedEntry } from './queries'
import { createRowActivation } from './row-activation'

export function dayLabel(date: string, today: string) {
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
  // The wideTimer setting: tickets get a column of their own.
  wide: boolean
  // The organization's Issue links setting, for the chips.
  issueLinks: string | null
  onSave: SaveEntry
  // Whether the entry's last save was confirmed a moment ago.
  justSaved: (id: string) => boolean
  onContinue: (entry: Entry) => void
  onDelete: (entry: Entry) => void
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

export function EntryList(
  props: EntryRowProps & {
    groups: readonly DayGroup<StoppedEntry>[]
    today: string
    focus?: boolean
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
        // plus the 43 px header.
        return (
          <Card
            class="overflow-hidden [contain-intrinsic-size:auto_calc(var(--rows)+43px)] [content-visibility:auto] md:[contain-intrinsic-size:auto_calc(var(--rows-md)+43px)]"
            style={{ '--rows': height(72), '--rows-md': height(0) }}
          >
            <header class="flex items-center justify-between border-b px-4 py-2.5 text-sm">
              <h2 class="font-medium">{dayLabel(date, props.today)}</h2>
              <span class="text-muted-foreground tabular-nums">
                <Duration ms={group()?.total ?? 0} />
              </span>
            </header>
            <Show
              when={lazy.shown()}
              fallback={<div ref={lazy.placeholder} class="h-(--rows) md:h-(--rows-md)" />}
            >
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
            </Show>
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
              <TicketCell editor={editor} entry={props.entry} issueLinks={props.issueLinks} />
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
        <EntryDuration
          editor={editor}
          class="row-start-3 w-16 shrink-0 text-right text-sm tabular-nums"
        />
        <div class="col-start-2 row-start-2 justify-self-end">
          <EntryActions
            entry={props.entry}
            saved={props.justSaved(props.entry.id)}
            compact={props.compact}
            active={activation.active()}
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
// Compact buttons match the fields' height. The menu mounts while the row is `active`.
export function EntryActions(props: {
  entry: Entry
  saved: boolean
  compact: boolean
  active: boolean
  onContinue: (entry: Entry) => void
  onDelete: (entry: Entry) => void
}) {
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
        </Show>
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
