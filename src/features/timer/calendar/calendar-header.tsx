// The week calendar's header: week navigation, the week's total, the Weekend toggle, and the
// days with their totals, as a strip to pick one below 640 px and as column headings above.
import ChevronLeftIcon from 'lucide-solid/icons/chevron-left'
import ChevronRightIcon from 'lucide-solid/icons/chevron-right'
import { For, Show } from 'solid-js'
import { Button } from '~/components/ui/button'
import { Toggle } from '~/components/ui/toggle'
import { type IsoDate, addDays } from '~/lib/calendar'
import { useFormatHours } from '~/lib/display-format'
import { formatIsoDate, formatIsoDateRange } from '~/lib/format'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

function weekday(date: IsoDate) {
  return formatIsoDate(date, { weekday: 'short' })
}

function dayOfMonth(date: IsoDate) {
  return formatIsoDate(date, { day: 'numeric' })
}

export function CalendarHeader(props: {
  week: IsoDate
  today: IsoDate
  // Today is shown, so the Today button has nothing to do.
  atToday: boolean
  total: number
  weekendShown: boolean
  // The week has weekend time, so the weekend shows whatever the setting.
  weekendForced: boolean
  // The days to pick from, the ones shown as columns, and the one shown below 640 px.
  dates: readonly IsoDate[]
  columns: readonly IsoDate[]
  shownDay: IsoDate
  totalFor: (date: IsoDate) => number
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
  onWeekend: (shown: boolean) => void
  onDay: (date: IsoDate) => void
}) {
  const formatHours = useFormatHours()

  function weekLabel() {
    return formatIsoDateRange(props.week, addDays(props.week, 6), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  return (
    <>
      <div class="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:px-4">
        <div class="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            class="size-8"
            aria-label={m.calendar_previous_week()}
            onClick={() => props.onPrevious()}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="size-8"
            aria-label={m.calendar_next_week()}
            onClick={() => props.onNext()}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="h-8"
          disabled={props.atToday}
          onClick={() => props.onToday()}
        >
          {m.timer_today()}
        </Button>
        <h2 id="calendar-week" class="ml-1 font-medium" aria-live="polite">
          {weekLabel()}
        </h2>
        <div class="ml-auto flex items-center gap-3">
          <Show when={props.total}>
            <span class="text-muted-foreground flex items-baseline gap-1.5 text-sm">
              {m.calendar_week_total()}
              <span class="tabular-nums">{formatHours(props.total)}</span>
            </span>
          </Show>
          <Toggle
            variant="outline"
            size="sm"
            pressed={props.weekendShown}
            disabled={props.weekendForced}
            title={props.weekendForced ? m.calendar_weekend_forced() : undefined}
            onChange={(pressed) => props.onWeekend(pressed)}
          >
            {m.calendar_weekend()}
          </Toggle>
        </div>
      </div>
      <div
        class="flex gap-1 overflow-x-auto border-b px-2 py-1.5 sm:hidden"
        role="group"
        aria-label={m.calendar_day()}
      >
        <For each={props.dates}>
          {(date) => (
            <button
              type="button"
              aria-pressed={date === props.shownDay}
              class={cn(
                'flex min-w-11 flex-1 flex-col items-center rounded-md px-1 py-1 text-xs',
                date === props.shownDay
                  ? 'bg-primary text-primary-foreground'
                  : date === props.today
                    ? 'bg-accent'
                    : 'hover:bg-accent',
              )}
              onClick={() => props.onDay(date)}
            >
              <span>{weekday(date)}</span>
              <span class="text-sm font-medium tabular-nums">{dayOfMonth(date)}</span>
              <span class={cn('tabular-nums', date !== props.shownDay && 'text-muted-foreground')}>
                {props.totalFor(date) ? formatHours(props.totalFor(date)) : '·'}
              </span>
            </button>
          )}
        </For>
      </div>
      <div
        class="cal-cols overflow-y-hidden border-b max-sm:hidden"
        style={{ '--days': props.columns.length }}
      >
        <div />
        <For each={props.columns}>
          {(date) => (
            <div
              class={cn(
                'flex items-baseline justify-between gap-1 border-l px-2 py-1.5',
                date === props.today && 'bg-accent/60',
              )}
            >
              <span
                class={cn(
                  'truncate text-sm',
                  date === props.today ? 'font-semibold' : 'font-medium',
                )}
              >
                {weekday(date)} {dayOfMonth(date)}
              </span>
              <span class="text-muted-foreground text-xs tabular-nums">
                {props.totalFor(date) ? formatHours(props.totalFor(date)) : ''}
              </span>
            </div>
          )}
        </For>
      </div>
    </>
  )
}
