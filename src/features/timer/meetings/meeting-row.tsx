// A meeting that started and isn't logged, as a row among a list day's entries
// (prototypes/calendar-events.html, "rows among entries"). The title opens the meeting popover;
// Log logs it at once, and one under way can be logged until now.
import CalendarIcon from 'lucide-solid/icons/calendar'
import RepeatIcon from 'lucide-solid/icons/repeat'
import { Show } from 'solid-js'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { CalendarEvent } from '~/server/calendar/calendar.schemas'
import { formatRange } from '../calendar/calendar-block'
import { meetingTitle } from './event-block'

export function MeetingRow(props: {
  event: CalendarEvent
  formatTime: (ms: number) => string
  compact: boolean
  // The wideTimer setting, which gives tickets a column of their own.
  wide: boolean
  now: number
  onOpen: (event: CalendarEvent, anchor: HTMLElement) => void
  onLog: (event: CalendarEvent, untilNow?: boolean) => void
}) {
  function underWay() {
    return props.event.stoppedAt.getTime() > props.now
  }
  function times() {
    return formatRange(
      props.formatTime,
      props.event.startedAt.getTime(),
      props.event.stoppedAt.getTime(),
    )
  }
  return (
    <li
      class="bg-muted/30 flex items-center gap-3 border-y border-dashed px-4 text-sm"
      classList={{ 'py-1': props.compact, 'py-2': !props.compact }}
      data-meeting={props.event.key}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={m.meeting_label({ title: meetingTitle(props.event), times: times() })}
        class="text-muted-foreground hover:text-foreground flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:underline"
        onClick={(e) => props.onOpen(props.event, e.currentTarget)}
      >
        <Show
          when={props.event.seriesKey}
          fallback={<CalendarIcon class="size-3.5 shrink-0" aria-hidden="true" />}
        >
          <RepeatIcon class="size-3.5 shrink-0" aria-hidden="true" />
        </Show>
        <span class="truncate">{meetingTitle(props.event)}</span>
        <span class="shrink-0 text-xs max-sm:hidden" aria-hidden="true">
          · {m.meeting_not_logged()}
        </span>
      </button>
      {/* From 768 px the times sit in the entry rows' Start and End columns, at their size: the
          room of the Ticket (Wide page) and Project columns and the date button before them,
          and the time fields' own sizing; the buttons take the Duration and actions columns. */}
      <Show when={props.wide}>
        <span class="hidden shrink-0 xl:block xl:w-32" aria-hidden="true" />
      </Show>
      <span class="hidden shrink-0 md:block md:w-36" aria-hidden="true" />
      <span class="text-muted-foreground shrink-0 tabular-nums md:hidden">{times()}</span>
      <span class="text-muted-foreground hidden shrink-0 items-center gap-1 md:flex">
        <span class="w-8" aria-hidden="true" />
        <TimeText time={props.formatTime(props.event.startedAt.getTime())} />
        <span aria-hidden="true">–</span>
        <TimeText time={props.formatTime(props.event.stoppedAt.getTime())} clock />
        <span class="w-5" aria-hidden="true" />
        <span class="w-5.5" aria-hidden="true" />
      </span>
      <div
        class={cn(
          'flex shrink-0 items-center justify-end gap-2',
          props.compact ? 'md:w-[11.625rem]' : 'md:w-[12.625rem]',
        )}
      >
        <Show when={underWay()}>
          <Button
            variant="outline"
            size="sm"
            class="h-7 shrink-0"
            onClick={() => props.onLog(props.event, true)}
          >
            {m.meeting_log_until_now()}
          </Button>
        </Show>
        <Button
          variant="outline"
          size="sm"
          class="h-7 shrink-0"
          aria-label={m.meeting_log_title({ title: meetingTitle(props.event) })}
          onClick={() => props.onLog(props.event)}
        >
          {m.meeting_log()}
        </Button>
      </div>
    </li>
  )
}

// A time as an entry row's TimeField lays it out: its text where the input's is, in a box
// as wide as the field, which fits the placeholder and, for the end, the clock.
function TimeText(props: { time: string; clock?: boolean }) {
  return (
    <span class="grid shrink-0 items-center border border-transparent text-xs tabular-nums">
      <span class="col-start-1 row-start-1 pl-2">{props.time}</span>
      <span class="invisible col-start-1 row-start-1 flex pr-1 pl-1.5" aria-hidden="true">
        <span class="grid whitespace-pre">
          <span class="col-start-1 row-start-1">{props.time}</span>
          <span class="col-start-1 row-start-1">{m.picker_time()}</span>
        </span>
        <Show when={props.clock}>
          <span class="ml-0.5 size-6" />
        </Show>
      </span>
    </span>
  )
}
