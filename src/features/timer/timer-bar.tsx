// The timer (prototypes/timer.html): description, project, the elapsed time, and Start or
// Stop. The description suggests recent work, and Enter in it starts the timer. While it
// runs, the fields edit the running entry, and the elapsed time opens its start in the
// entry popover. The layouts
// share these controls and differ only in their classes: one line in Bar, a large clock
// in Focus, and a plain row above the table in Table. With the compactRows setting, the
// controls are shorter and the padding smaller.
import PlayIcon from 'lucide-solid/icons/play'
import SquareIcon from 'lucide-solid/icons/square'
import { Show, createEffect, createSignal, on } from 'solid-js'
import { Button } from '~/components/ui/button'
import { runningMs } from '~/lib/calendar'
import { formatClock } from '~/lib/format'
import type { Project } from '~/lib/projects'
import type { Settings } from '~/lib/settings'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { DescriptionCombobox } from './description-combobox'
import { ProjectSelect } from './project-select'
import type { Entry, RunningTimer } from './queries'

const LAYOUTS: Record<
  Settings['timerLayout'],
  { timer: string; fields?: string; elapsed: string; toggle?: string }
> = {
  bar: {
    timer:
      'surface bg-card flex flex-col gap-3 rounded-xl border p-3 shadow-sm sm:flex-row sm:items-center',
    elapsed: 'justify-start text-lg sm:w-28 sm:justify-end',
  },
  focus: {
    timer:
      'surface bg-card grid grid-cols-1 gap-4 rounded-xl border p-6 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto]',
    fields: 'sm:col-start-1',
    elapsed:
      'order-first h-auto justify-self-start text-5xl font-light tracking-tight sm:col-span-2 sm:text-6xl',
    toggle: 'h-12 sm:w-36',
  },
  table: {
    timer: 'flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-center',
    elapsed: 'justify-start text-base sm:w-24 sm:justify-end',
  },
}

// Overrides for the compactRows setting; cn lets them replace the layout's classes.
const COMPACT: typeof LAYOUTS = {
  bar: { timer: 'gap-2 p-2', elapsed: 'h-9 text-base' },
  focus: {
    timer: 'gap-3 p-4',
    elapsed: 'h-auto text-4xl sm:text-5xl',
    toggle: 'h-10',
  },
  table: { timer: 'pb-3', elapsed: 'h-9' },
}
// Controls the layouts leave at their default height.
const COMPACT_CONTROL = 'h-9'

export function TimerBar(props: {
  layout: Settings['timerLayout']
  compact: boolean
  running: RunningTimer | null
  projects: readonly Project[]
  // Stopped entries, for the description's suggestions.
  entries: readonly Entry[]
  // The organization the running timer is in, when it isn't the active one. Entries
  // there are edited from that organization.
  elsewhere: string | null
  now: number
  onStart: (description: string, projectId: string | null) => void
  onStop: () => void
  onUpdate: (patch: { description?: string; projectId?: string | null }) => void
  onEditStart: (anchor: HTMLElement) => void
}) {
  const [description, setDescription] = createSignal('')
  const [projectId, setProjectId] = createSignal('')

  // The fields show the running entry, and clear when it stops. Only a changed value is
  // copied, so a refetch doesn't overwrite what is being typed.
  createEffect(
    on(
      () => [props.running?.id, props.running?.description, props.running?.projectId] as const,
      ([id, text, project], previous) => {
        if (id) {
          setDescription(text ?? '')
          setProjectId(project ?? '')
        } else if (previous?.[0]) {
          setDescription('')
          setProjectId('')
        }
      },
    ),
  )

  // The running timer's project may be in another organization, whose projects aren't
  // loaded.
  function projects() {
    const project = props.running?.project
    if (!props.elsewhere || !project) return props.projects
    return [{ ...project, archivedAt: null }]
  }

  function start() {
    props.onStart(description().trim(), projectId() || null)
  }

  function pick(entry: Entry) {
    setDescription(entry.description)
    setProjectId(entry.projectId ?? '')
    if (props.running) {
      props.onUpdate({ description: entry.description, projectId: entry.projectId })
    }
  }

  function saveDescription() {
    const running = props.running
    if (running && description().trim() !== running.description) {
      props.onUpdate({ description: description().trim() })
    }
  }

  function classes() {
    const layout = LAYOUTS[props.layout]
    if (!props.compact) return layout
    const compact = COMPACT[props.layout]
    return {
      timer: cn(layout.timer, compact.timer),
      fields: layout.fields,
      elapsed: cn(layout.elapsed, compact.elapsed),
      toggle: cn(COMPACT_CONTROL, layout.toggle, compact.toggle),
    }
  }

  function control() {
    return props.compact ? COMPACT_CONTROL : undefined
  }

  return (
    // Above the entries, so the description's suggestions aren't covered by the cards,
    // whose backdrop filter stacks them over earlier elements.
    <div class="z-10 grid gap-2">
      <section class={classes().timer} aria-label={m.timer_label()}>
        <div
          class={cn(
            'flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center',
            classes().fields,
          )}
        >
          <DescriptionCombobox
            class="flex-1"
            label={m.timer_description_placeholder()}
            labelClass="sr-only"
            inputClass={control()}
            placeholder={m.timer_description_placeholder()}
            value={description()}
            projectId={projectId()}
            entries={props.entries}
            projects={props.projects}
            disabled={!!props.elsewhere}
            onChange={setDescription}
            onPick={pick}
            onBlur={saveDescription}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (props.running) saveDescription()
              else start()
            }}
          />
          <ProjectSelect
            id="timer-project"
            class="sm:w-48"
            label={m.timer_project()}
            labelClass="sr-only"
            triggerClass={control()}
            projects={projects()}
            value={projectId()}
            disabled={!!props.elsewhere}
            onChange={(value) => {
              setProjectId(value)
              if (props.running) props.onUpdate({ projectId: value || null })
            }}
          />
        </div>
        <Button
          variant="ghost"
          class={cn('px-2 tabular-nums', classes().elapsed)}
          aria-label={m.timer_edit_start()}
          disabled={!props.running || !!props.elsewhere}
          data-entry-trigger
          onClick={(event: MouseEvent) => props.onEditStart(event.currentTarget as HTMLElement)}
        >
          {formatClock(props.running ? runningMs(props.running.startedAt, props.now) : 0)}
        </Button>
        <Show
          when={props.running}
          fallback={
            <Button class={classes().toggle} onClick={start}>
              <PlayIcon aria-hidden="true" />
              {m.timer_start()}
            </Button>
          }
        >
          <Button variant="destructive" class={classes().toggle} onClick={() => props.onStop()}>
            <SquareIcon aria-hidden="true" />
            {m.timer_stop()}
          </Button>
        </Show>
      </section>
      <Show when={props.elsewhere}>
        {(organization) => (
          <p class="text-muted-foreground px-1 text-sm">
            {m.timer_running_elsewhere({ organization: organization() })}
          </p>
        )}
      </Show>
    </div>
  )
}
