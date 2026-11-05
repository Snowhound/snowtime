// A calendar meeting on the week grid (prototypes/calendar-events.html, the outline look): a
// dashed frame beside the entries, gray, with icons for a series and focus time. Out of
// office greys its hours behind the entries instead, and all-day events sit in a strip over
// the grid.
import CalendarCheckIcon from 'lucide-solid/icons/calendar-check'
import HeadphonesIcon from 'lucide-solid/icons/headphones'
import MapPinIcon from 'lucide-solid/icons/map-pin'
import PlaneIcon from 'lucide-solid/icons/plane'
import RepeatIcon from 'lucide-solid/icons/repeat'
import { For, Show } from 'solid-js'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { CalendarEvent } from '~/server/calendar/calendar.schemas'
import { HOUR_PX, formatRange } from '../calendar/calendar-block'
import { DAY_MINUTES, type Placed } from '../calendar/week-grid'

const MINUTE_PX = HOUR_PX / 60
const SHORT_PX = 22
const TALL_PX = 44

// A meeting as the grid lays it out beside entries.
export interface MeetingItem {
  id: string
  startedAt: Date
  stoppedAt: Date
  event: CalendarEvent
}

export function meetingTitle(event: CalendarEvent) {
  return event.title || m.meeting_no_title()
}

function note(event: CalendarEvent, now: number) {
  if (event.response === 'declined') return m.meeting_declined()
  if (event.free) return m.meeting_free()
  if (event.response === 'none') return m.meeting_unanswered()
  if (event.startedAt.getTime() <= now && event.stoppedAt.getTime() > now) {
    return m.meeting_under_way()
  }
  return ''
}

export function EventBlock(props: {
  piece: Placed<MeetingItem>
  formatTime: (ms: number) => string
  now: number
  open: boolean
  // The calendar's color, as a dot, when the user shows more than one.
  dot: string | null
}) {
  function event() {
    return props.piece.entry.event
  }
  function times() {
    return formatRange(props.formatTime, event().startedAt.getTime(), event().stoppedAt.getTime())
  }
  function height() {
    return (props.piece.bottom - props.piece.top) * MINUTE_PX
  }
  function underWay() {
    return event().startedAt.getTime() <= props.now && event().stoppedAt.getTime() > props.now
  }
  function lead() {
    return (
      <>
        <Show when={props.dot}>
          {(color) => (
            <span
              class="inline-block size-1.5 shrink-0 rounded-full"
              style={{ background: color() }}
            />
          )}
        </Show>
        <Show
          when={event().kind === 'focus_time'}
          fallback={
            <Show when={event().seriesKey}>
              <RepeatIcon class="size-3 shrink-0 opacity-75" aria-hidden="true" />
            </Show>
          }
        >
          <HeadphonesIcon class="size-3 shrink-0 opacity-75" aria-hidden="true" />
        </Show>
      </>
    )
  }
  function label() {
    const extra = note(event(), props.now)
    const text = m.meeting_label({ title: meetingTitle(event()), times: times() })
    return extra ? `${text}, ${extra}` : text
  }

  return (
    <button
      type="button"
      class="cal-event"
      data-event={event().key}
      data-short={height() < SHORT_PX ? '' : undefined}
      data-declined={event().response === 'declined' ? '' : undefined}
      data-free={event().free ? '' : undefined}
      data-open={props.open ? '' : undefined}
      aria-haspopup="dialog"
      aria-label={label()}
      style={{
        top: `${props.piece.top * MINUTE_PX + 1}px`,
        height: `${Math.max(height(), 14) - 2}px`,
        left: `calc(${(props.piece.column / props.piece.columns) * 100}% + 2px)`,
        width: `calc(${100 / props.piece.columns}% - 4px)`,
      }}
    >
      <Show
        when={height() >= TALL_PX}
        fallback={
          <span class="flex min-w-0 items-center gap-1">
            {lead()}
            <span class="truncate">
              <span class="cal-event-title font-medium">{meetingTitle(event())}</span>{' '}
              <span class="tabular-nums">{props.formatTime(event().startedAt.getTime())}</span>
            </span>
          </span>
        }
      >
        <span class="flex min-w-0 items-start gap-1">
          <span class="flex h-[1.25em] items-center gap-1">{lead()}</span>
          <span class="cal-event-title line-clamp-2 font-medium">{meetingTitle(event())}</span>
        </span>
        <span class="mt-auto truncate tabular-nums">
          <Show when={underWay()}>
            <span class="cal-pulse bg-primary mr-1 inline-block size-1.5 rounded-full align-middle" />
          </Show>
          {times()}
          {note(event(), props.now) ? ` · ${note(event(), props.now)}` : ''}
        </span>
      </Show>
    </button>
  )
}

// Out of office on one day, as minutes from its midnight: the hours greyed, and a timed one's
// label, which opens it.
export function AwayShade(props: {
  event: CalendarEvent
  top: number
  bottom: number
  formatTime: (ms: number) => string
}) {
  // Google keeps a day off as midnight to midnight, not as an all-day event.
  function times() {
    if (props.top === 0 && props.bottom === DAY_MINUTES) return m.meeting_all_day()
    return formatRange(
      props.formatTime,
      props.event.startedAt.getTime(),
      props.event.stoppedAt.getTime(),
    )
  }
  return (
    <div
      class="cal-away"
      style={{
        top: `${props.top * MINUTE_PX}px`,
        height: `${(props.bottom - props.top) * MINUTE_PX}px`,
      }}
    >
      <Show when={!props.event.allDay}>
        <button
          type="button"
          class="cal-away-label"
          data-event={props.event.key}
          aria-haspopup="dialog"
          aria-label={m.meeting_away_label({ times: times() })}
        >
          <PlaneIcon class="size-3 shrink-0" aria-hidden="true" />
          <span class="truncate">
            {meetingTitle(props.event)} · {times()}
          </span>
        </button>
      </Show>
    </div>
  )
}

// All-day events and working locations over the grid, a cell per shown day.
export function AllDayStrip(props: {
  columns: readonly string[]
  eventsOn: (date: string) => readonly CalendarEvent[]
  logged: (event: CalendarEvent) => boolean
}) {
  return (
    <div class="cal-cols overflow-y-hidden border-b" style={{ '--days': props.columns.length }}>
      <div class="text-muted-foreground px-1 py-1.5 text-right text-[11px] leading-tight">
        {m.meeting_all_day()}
      </div>
      <For each={props.columns}>
        {(date) => (
          <div class="flex min-w-0 flex-col gap-0.5 border-l p-1">
            <For each={props.eventsOn(date)}>
              {(event) => (
                <button
                  type="button"
                  class={cn('cal-chip')}
                  data-event={event.key}
                  data-kind={event.kind}
                  aria-haspopup="dialog"
                  aria-label={
                    event.kind === 'working_location'
                      ? m.meeting_working_location_label({ title: meetingTitle(event) })
                      : props.logged(event)
                        ? m.meeting_all_day_logged_label({ title: meetingTitle(event) })
                        : m.meeting_all_day_label({ title: meetingTitle(event) })
                  }
                >
                  <Show when={event.kind === 'working_location'}>
                    <MapPinIcon class="size-3 shrink-0" aria-hidden="true" />
                  </Show>
                  <Show when={event.kind === 'out_of_office'}>
                    <PlaneIcon class="size-3 shrink-0" aria-hidden="true" />
                  </Show>
                  <span class="truncate">{meetingTitle(event)}</span>
                  <Show when={props.logged(event)}>
                    <CalendarCheckIcon class="ml-auto size-3 shrink-0" aria-hidden="true" />
                  </Show>
                </button>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  )
}
