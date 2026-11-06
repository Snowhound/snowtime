// A meeting's popover (prototypes/calendar-events.html): what it is and the user's answer, a
// project for this log, and Log, which saves it at once with Undo; the entry is edited after,
// where it lands. An all-day event logs as a day on each of its workdays.
import CalendarIcon from 'lucide-solid/icons/calendar'
import CheckIcon from 'lucide-solid/icons/check'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import HeadphonesIcon from 'lucide-solid/icons/headphones'
import InfoIcon from 'lucide-solid/icons/info'
import MapPinIcon from 'lucide-solid/icons/map-pin'
import PlaneIcon from 'lucide-solid/icons/plane'
import RepeatIcon from 'lucide-solid/icons/repeat'
import XIcon from 'lucide-solid/icons/x'
import { type JSX, Show, createMemo, createSignal } from 'solid-js'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent } from '~/components/ui/popover'
import { formatDateTime } from '~/lib/format'
import type { Project } from '~/lib/queries/projects'
import { m } from '~/paraglide/messages.js'
import type { CalendarEvent, CalendarSource } from '~/server/calendar/calendar.schemas'
import { formatRange } from '../calendar/calendar-block'
import { ProjectSelect } from '../project-select'
import { meetingTitle } from './event-block'
import { DAY_HOURS, DAY_START, type Loggable, type LogState } from './meetings'

export interface EventTarget {
  event: CalendarEvent
  anchor: HTMLElement
}

const RESPONSES = {
  organizer: [CheckIcon, m.meeting_response_organizer],
  accepted: [CheckIcon, m.meeting_response_accepted],
  tentative: [CircleAlertIcon, m.meeting_response_tentative],
  none: [CircleAlertIcon, m.meeting_response_none],
  declined: [XIcon, m.meeting_response_declined],
} as const

function Fact(props: { icon: JSX.Element; children: JSX.Element }) {
  return (
    <li class="text-muted-foreground flex min-w-0 items-center gap-2">
      {props.icon}
      <span class="min-w-0 truncate">{props.children}</span>
    </li>
  )
}

export function EventPopover(props: {
  target: EventTarget | null
  // What each entry the open event logs as would carry: its own key, or a day's.
  loggables: (event: CalendarEvent) => Loggable[]
  stateOf: (key: string) => LogState
  source: (event: CalendarEvent) => CalendarSource | undefined
  projects: readonly Project[]
  zone: string
  now: number
  // The running timer's start, when it runs through a meeting under way.
  runningSince: number | null
  formatTime: (ms: number) => string
  // The project a meeting starts with, which the user can change.
  suggest: (event: CalendarEvent) => string | null
  onLog: (items: Loggable[], projectId: string | null) => void
  onClose: () => void
  // Beside a calendar block; below a list row, which spans the width.
  below?: boolean
}) {
  const shown = createMemo<EventTarget | null>((last) => props.target ?? last, null)
  // The user's pick for the shown event; until then, its suggestion.
  const [picked, setPicked] = createSignal<{ key: string; projectId: string } | null>(null)

  function event() {
    return shown()?.event
  }
  function projectId() {
    const e = event()
    if (!e) return ''
    const pick = picked()
    return pick?.key === e.key ? pick.projectId : (props.suggest(e) ?? '')
  }
  function setProjectId(projectId: string) {
    const e = event()
    if (e) setPicked({ key: e.key, projectId })
  }
  // The entries still to log: a timed event's one unless logged, an all-day event's days.
  function pending() {
    const e = event()
    if (!e) return []
    return props.loggables(e).filter((item) => {
      const state = props.stateOf(item.key)
      return state === null || state === 'deleted'
    })
  }
  function state() {
    const e = event()
    return e && !e.allDay ? props.stateOf(e.key) : null
  }
  function underWay() {
    const e = event()
    return !!e && e.startedAt.getTime() <= props.now && e.stoppedAt.getTime() > props.now
  }

  function atMidnight(at: Date) {
    const time = formatDateTime(at.getTime(), props.zone, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    return time === '00:00'
  }
  function when() {
    const e = event()
    if (!e) return ''
    // Google keeps a day off as midnight to midnight, not as an all-day event.
    if (e.allDay || (atMidnight(e.startedAt) && atMidnight(e.stoppedAt))) {
      const last = e.stoppedAt.getTime() - 1
      const sameDay =
        formatDateTime(e.startedAt.getTime(), props.zone, { dateStyle: 'short' }) ===
        formatDateTime(last, props.zone, { dateStyle: 'short' })
      const opts = { weekday: 'short', day: 'numeric', month: 'short' } as const
      const first = formatDateTime(e.startedAt.getTime(), props.zone, opts)
      const days = sameDay ? first : `${first} – ${formatDateTime(last, props.zone, opts)}`
      return m.meeting_when_all_day({ days })
    }
    const day = formatDateTime(e.startedAt.getTime(), props.zone, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
    const times = formatRange(props.formatTime, e.startedAt.getTime(), e.stoppedAt.getTime())
    return underWay() ? m.meeting_when_under_way({ day, times }) : m.meeting_when({ day, times })
  }

  function loggable() {
    const e = event()
    return !!e && e.kind !== 'working_location' && pending().length > 0 && state() !== 'elsewhere'
  }

  function note() {
    const e = event()
    if (!e) return ''
    if (e.kind === 'working_location') return ''
    if (state() === 'elsewhere') return m.meeting_logged_elsewhere()
    if (state() === 'deleted') return m.meeting_deleted()
    if (e.allDay) {
      const count = pending().length
      if (!count) return m.meeting_all_logged()
      const values = { hours: DAY_HOURS, time: DAY_START }
      return count > 1 ? m.meeting_days_note({ ...values, count }) : m.meeting_day_note(values)
    }
    if (underWay() && props.runningSince !== null && props.runningSince < e.stoppedAt.getTime()) {
      return m.meeting_overlap_running()
    }
    return ''
  }

  function logLabel() {
    const e = event()
    if (!e) return ''
    if (e.allDay) {
      const count = pending().length
      return count > 1 ? m.meeting_log_days({ count }) : m.meeting_log_day()
    }
    if (e.startedAt.getTime() > props.now) return m.meeting_log_ahead()
    return m.meeting_log()
  }

  function kind() {
    const e = event()
    if (e?.kind === 'focus_time')
      return [<HeadphonesIcon class="size-4 shrink-0" />, m.meeting_focus_time()] as const
    if (e?.kind === 'out_of_office')
      return [<PlaneIcon class="size-4 shrink-0" />, m.meeting_out_of_office()] as const
    if (e?.kind === 'working_location')
      return [<MapPinIcon class="size-4 shrink-0" />, m.meeting_working_location()] as const
    return null
  }

  return (
    <Popover
      open={props.target !== null}
      onOpenChange={(open) => !open && props.onClose()}
      anchorRef={() => shown()?.anchor}
      placement={props.below ? 'bottom-start' : 'right-start'}
      flip
    >
      <PopoverContent
        class="max-h-(--kb-popper-content-available-height) w-[24rem] max-w-[calc(100vw-1rem)] overflow-y-auto"
        aria-labelledby="event-popover-title"
        aria-describedby="event-popover-when"
        onInteractOutside={(e: Event) => {
          if ((e.target as Element | null)?.closest('[data-event]')) e.preventDefault()
        }}
        onOpenAutoFocus={(e: Event) => {
          e.preventDefault()
          setPicked(null)
          const content = e.currentTarget as HTMLElement
          // Not placed yet, the content sits at the page's top, where scrolling to it would jump.
          content.querySelector<HTMLElement>('[data-event-log]')?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={(e: Event) => {
          e.preventDefault()
          const anchor = shown()?.anchor
          if (anchor?.isConnected) anchor.focus()
        }}
      >
        <Show when={event()}>
          {(e) => (
            <div class="grid gap-4">
              <div class="grid gap-1.5">
                <h2 id="event-popover-title" class="leading-snug font-medium break-words">
                  {meetingTitle(e())}
                </h2>
                <p id="event-popover-when" class="text-muted-foreground text-sm tabular-nums">
                  {when()}
                </p>
              </div>
              <ul class="grid gap-1.5 text-sm">
                <Show when={props.source(e())}>
                  {(source) => (
                    <Fact icon={<CalendarIcon class="size-4 shrink-0" aria-hidden="true" />}>
                      <span
                        class="bg-muted-foreground mr-1.5 inline-block size-2 rounded-full align-middle"
                        style={source().color ? { background: source().color! } : undefined}
                      />
                      {source().name}
                    </Fact>
                  )}
                </Show>
                <Show when={kind()}>{(k) => <Fact icon={k()[0]}>{k()[1]}</Fact>}</Show>
                <Show when={!e().allDay && e().kind === 'event'}>
                  {(() => {
                    const [Icon, text] = RESPONSES[e().response]
                    return (
                      <Fact icon={<Icon class="size-4 shrink-0" aria-hidden="true" />}>
                        {text()}
                      </Fact>
                    )
                  })()}
                </Show>
                <Show when={e().free}>
                  <Fact icon={<InfoIcon class="size-4 shrink-0" aria-hidden="true" />}>
                    {m.meeting_shown_free()}
                  </Fact>
                </Show>
                <Show when={e().seriesKey}>
                  <Fact icon={<RepeatIcon class="size-4 shrink-0" aria-hidden="true" />}>
                    {m.meeting_repeats()}
                  </Fact>
                </Show>
              </ul>
              <Show when={loggable()}>
                <ProjectSelect
                  id="event-project"
                  class="grid gap-1.5"
                  label={m.meeting_project()}
                  projects={props.projects}
                  value={projectId()}
                  onChange={setProjectId}
                />
              </Show>
              <Show when={note()}>
                <p class="text-muted-foreground text-sm">{note()}</p>
              </Show>
              <Show when={loggable()}>
                <div class="flex flex-wrap items-center justify-end gap-2">
                  {/* A meeting that ends early is logged up to now. */}
                  <Show when={underWay() && !e().allDay}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const now = Date.now()
                        props.onLog(
                          pending().map((item) => ({ ...item, stoppedAt: now })),
                          projectId() || null,
                        )
                      }}
                    >
                      {m.meeting_log_until_now()}
                    </Button>
                  </Show>
                  <Button
                    size="sm"
                    data-event-log
                    onClick={() => props.onLog(pending(), projectId() || null)}
                  >
                    {logLabel()}
                  </Button>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </PopoverContent>
    </Popover>
  )
}
