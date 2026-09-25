// A month grid for picking a day, as the WAI-ARIA date picker dialog pattern describes: one
// day is tabbable, the arrow keys move by day and week, Home and End to the week's ends, Page
// Up and Page Down by month (with Shift, by year), and Enter or Space picks. Weeks start on
// the user's week start; names come from the UI language.
import ChevronLeftIcon from 'lucide-solid/icons/chevron-left'
import ChevronRightIcon from 'lucide-solid/icons/chevron-right'
import { For, createEffect, createMemo, createSignal, createUniqueId, on } from 'solid-js'
import { Button } from '~/components/ui/button'
import { type IsoDate, type WeekStart, addDays, startOfWeek } from '~/lib/calendar'
import { addMonths, monthWeeks } from '~/lib/date-input'
import { formatIsoDate } from '~/lib/format'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

export function Calendar(props: {
  value: IsoDate
  onSelect: (date: IsoDate) => void
  weekStart: WeekStart
  today: IsoDate
  min?: IsoDate
  max?: IsoDate
  class?: string
}) {
  const titleId = createUniqueId()
  // oxlint-disable-next-line solid/reactivity -- the grid opens on the value, then follows the keys.
  const [focused, setFocused] = createSignal(props.value || props.today)
  let grid: HTMLTableElement | undefined
  // A typed date shows its month.
  createEffect(
    on(
      () => props.value,
      (value) => value && setFocused(value),
      { defer: true },
    ),
  )

  // Rebuilt only when the month changes: a new grid on every focus would replace the day
  // being clicked between its mousedown and its click, which then never lands.
  const month = createMemo(() => focused().slice(0, 7))
  const weeks = createMemo(() => monthWeeks(`${month()}-01`, props.weekStart))

  function outOfRange(date: IsoDate) {
    return (
      (props.min !== undefined && date < props.min) || (props.max !== undefined && date > props.max)
    )
  }

  function move(date: IsoDate) {
    setFocused(date)
    grid?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus()
  }

  function onKeyDown(event: KeyboardEvent) {
    const day = focused()
    const next: Record<string, () => IsoDate> = {
      ArrowLeft: () => addDays(day, -1),
      ArrowRight: () => addDays(day, 1),
      ArrowUp: () => addDays(day, -7),
      ArrowDown: () => addDays(day, 7),
      Home: () => startOfWeek(day, props.weekStart),
      End: () => addDays(startOfWeek(day, props.weekStart), 6),
      PageUp: () => addMonths(day, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(day, event.shiftKey ? 12 : 1),
    }
    if (!(event.key in next)) return
    event.preventDefault()
    move(next[event.key]())
  }

  function pick(date: IsoDate) {
    if (!outOfRange(date)) props.onSelect(date)
  }

  return (
    <div class={cn('grid gap-2', props.class)}>
      <div class="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          class="size-8"
          aria-label={m.picker_previous_month()}
          onClick={() => setFocused((d) => addMonths(d, -1))}
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <p id={titleId} class="text-sm font-medium" aria-live="polite">
          {formatIsoDate(focused(), { month: 'long', year: 'numeric' })}
        </p>
        <Button
          variant="ghost"
          size="icon"
          class="size-8"
          aria-label={m.picker_next_month()}
          onClick={() => setFocused((d) => addMonths(d, 1))}
        >
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
      <table
        ref={grid}
        role="grid"
        aria-labelledby={titleId}
        class="border-collapse"
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            <For each={weeks()[0]}>
              {(date) => (
                <th
                  scope="col"
                  abbr={formatIsoDate(date, { weekday: 'long' })}
                  class="text-muted-foreground size-9 p-0 text-xs font-normal"
                >
                  {formatIsoDate(date, { weekday: 'narrow' })}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={weeks()}>
            {(week) => (
              <tr>
                <For each={week}>
                  {(date) => (
                    <td class="p-0" aria-selected={date === props.value}>
                      <button
                        type="button"
                        data-date={date}
                        tabindex={date === focused() ? 0 : -1}
                        aria-label={formatIsoDate(date, {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                        aria-current={date === props.today ? 'date' : undefined}
                        aria-disabled={outOfRange(date) || undefined}
                        class={cn(
                          'ring-offset-background focus-visible:ring-ring size-9 rounded-md text-sm tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                          date.slice(0, 7) !== month() && 'text-muted-foreground',
                          date === props.today && 'font-semibold underline underline-offset-4',
                          date === props.value
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                            : 'hover:bg-accent hover:text-accent-foreground',
                          outOfRange(date) && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                        )}
                        onFocus={() => setFocused(date)}
                        // Focus stays put on press, so a day of the next or previous month
                        // doesn't turn the grid to its month before the click lands on it.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => pick(date)}
                      >
                        {Number(date.slice(8))}
                      </button>
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}
