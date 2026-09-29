// An entry's piece on a calendar day, and the dashed outline of a slot being added or dragged
// (prototypes/calendar.html). Tall blocks show the description, the project, and the times
// with the duration; short ones one line with the start.
import { Show, createEffect } from 'solid-js'
import { projectColor } from '~/lib/colors'
import { useFormatHours } from '~/lib/display-format'
import type { Project } from '~/lib/queries/projects'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { entryName } from '../entries'
import type { Entry } from '../queries'
import type { Placed } from './week-grid'

// One hour on the grid. The 15-minute snap is a quarter of it.
export const HOUR_PX = 48
const MINUTE_PX = HOUR_PX / 60
// The shortest block still shows a line; a block this short or shorter shows one tight line.
const MIN_BLOCK_PX = 14
const SHORT_PX = 22
const TALL_PX = 44

// A project as a block shows it: without one, or with one the user can't see, it's muted.
export function blockProject(projects: readonly Project[], projectId: string | null) {
  if (!projectId) return { name: m.timer_no_project(), color: projectColor(null), muted: true }
  const project = projects.find((p) => p.id === projectId)
  if (!project) {
    return { name: m.timer_unavailable_project(), color: projectColor(null), muted: true }
  }
  return { name: project.name, color: projectColor(project.color), muted: false }
}

function box(top: number, bottom: number) {
  const px = top * MINUTE_PX
  return {
    top: `${px + 1}px`,
    height: `${Math.max((bottom - top) * MINUTE_PX, MIN_BLOCK_PX) - 2}px`,
  }
}

export function CalendarBlock(props: {
  piece: Placed<Entry>
  projects: readonly Project[]
  formatTime: (ms: number) => string
  now: number
  editing: boolean
  dragging: boolean
  flash: boolean
  // The entry to focus once its block shows, after a key moved it.
  focus: boolean
  onFocused: () => void
}) {
  const formatHours = useFormatHours()
  let el: HTMLButtonElement | undefined

  function entry() {
    return props.piece.entry
  }
  function running() {
    return entry().stoppedAt === null
  }
  function project() {
    return blockProject(props.projects, entry().projectId)
  }
  function description() {
    return entryName(entry()) || m.timer_no_description()
  }
  function times() {
    const e = entry()
    const end = e.stoppedAt ? props.formatTime(e.stoppedAt.getTime()) : m.calendar_now()
    return `${props.formatTime(e.startedAt.getTime())}–${end}`
  }
  function duration() {
    const e = entry()
    return formatHours((e.stoppedAt?.getTime() ?? props.now) - e.startedAt.getTime())
  }
  function label() {
    const values = {
      description: description(),
      project: project().name,
      times: times(),
      duration: duration(),
    }
    return running() ? m.calendar_entry_running(values) : m.calendar_entry(values)
  }
  function style() {
    const { top, bottom, column, columns } = props.piece
    return {
      '--p': project().color,
      ...box(top, bottom),
      left: `calc(${(column / columns) * 100}% + 2px)`,
      width: `calc(${100 / columns}% - 4px)`,
    }
  }
  function height() {
    return (props.piece.bottom - props.piece.top) * MINUTE_PX
  }

  createEffect(() => {
    if (props.focus && props.piece.first && el && document.activeElement !== el) {
      el.focus()
      props.onFocused()
    }
  })

  return (
    <button
      ref={el}
      type="button"
      class={cn('cal-block', props.flash && 'cal-flash')}
      data-entry={entry().id}
      data-short={height() < SHORT_PX ? '' : undefined}
      data-muted={project().muted ? '' : undefined}
      data-running={running() ? '' : undefined}
      data-editing={props.editing ? '' : undefined}
      // A click on the entry that is open leaves its popover open.
      data-entry-trigger={props.editing ? '' : undefined}
      data-dragging={props.dragging ? '' : undefined}
      aria-label={label()}
      style={style()}
    >
      <Show
        when={height() >= TALL_PX}
        fallback={
          <span class="truncate">
            <span class={cn('font-medium', !entryName(entry()) && 'text-muted-foreground italic')}>
              {description()}
            </span>{' '}
            <span class="text-muted-foreground tabular-nums">
              {props.formatTime(entry().startedAt.getTime())}
            </span>
          </span>
        }
      >
        <span
          class={cn(
            'line-clamp-2 font-medium',
            !entryName(entry()) && 'text-muted-foreground italic',
          )}
        >
          {description()}
        </span>
        <span class="text-muted-foreground truncate">{project().name}</span>
        <span class="text-muted-foreground mt-auto truncate tabular-nums">
          <Show when={running()}>
            <span class="cal-pulse bg-primary mr-1 inline-block size-1.5 rounded-full align-middle" />
          </Show>
          {times()} · {duration()}
        </span>
      </Show>
      <Show when={props.piece.first}>
        <span class="cal-handle -top-0.5" data-handle="start" aria-hidden="true" />
      </Show>
      <Show when={props.piece.last && !running()}>
        <span class="cal-handle -bottom-0.5" data-handle="end" aria-hidden="true" />
      </Show>
    </button>
  )
}

// A slot's dashed outline on one day, with its times, or why it can't be dropped there.
export function CalendarGhost(props: {
  top: number
  bottom: number
  color?: string
  text: string
  invalid?: boolean
  // The new slot the popover opens beside.
  draft?: boolean
  ref?: (el: HTMLDivElement) => void
}) {
  return (
    <div
      ref={props.ref}
      class="cal-ghost"
      data-invalid={props.invalid ? '' : undefined}
      data-draft={props.draft ? '' : undefined}
      style={{
        ...(props.color ? { '--p': props.color } : {}),
        ...box(props.top, props.bottom),
        left: '2px',
        right: '2px',
      }}
    >
      {props.text}
    </div>
  )
}
