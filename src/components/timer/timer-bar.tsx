// The Bar layout's timer (prototypes/timer.html): description, project, the elapsed time,
// and Start or Stop. Enter in the description starts the timer. While it runs, the fields
// edit the running entry, and the elapsed time opens its start in the entry dialog.
import PlayIcon from 'lucide-solid/icons/play'
import SquareIcon from 'lucide-solid/icons/square'
import { Show, createEffect, createSignal, on } from 'solid-js'
import { formatClock } from '../../lib/format'
import type { Project, RunningTimer } from '../../lib/timer'
import { m } from '../../paraglide/messages.js'
import { Button } from '../ui/button'
import { TextField, TextFieldInput, TextFieldLabel } from '../ui/text-field'
import { ProjectSelect } from './project-select'

export function TimerBar(props: {
  running: RunningTimer | null
  projects: readonly Project[]
  // The organization the running timer is in, when it isn't the active one. Entries
  // there are edited from that organization.
  elsewhere: string | null
  now: number
  onStart: (description: string, projectId: string | null) => void
  onStop: () => void
  onUpdate: (patch: { description?: string; projectId?: string | null }) => void
  onEditStart: () => void
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

  function saveDescription() {
    const running = props.running
    if (running && description().trim() !== running.description) {
      props.onUpdate({ description: description().trim() })
    }
  }

  return (
    <div class="grid gap-2">
      <section
        class="bg-card flex flex-col gap-3 rounded-xl border p-3 shadow-sm sm:flex-row sm:items-center"
        aria-label={m.timer_label()}
      >
        <div class="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <TextField
            class="min-w-0 flex-1"
            value={description()}
            onChange={setDescription}
            disabled={!!props.elsewhere}
          >
            <TextFieldLabel class="sr-only">{m.timer_description_placeholder()}</TextFieldLabel>
            <TextFieldInput
              placeholder={m.timer_description_placeholder()}
              autocomplete="off"
              onBlur={saveDescription}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key !== 'Enter' || event.isComposing) return
                event.preventDefault()
                if (props.running) saveDescription()
                else start()
              }}
            />
          </TextField>
          <label for="timer-project" class="sr-only">
            {m.timer_project()}
          </label>
          <ProjectSelect
            id="timer-project"
            class="sm:w-48"
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
          class="justify-start px-2 font-mono text-lg tabular-nums sm:w-28 sm:justify-end"
          aria-label={m.timer_edit_start()}
          disabled={!props.running || !!props.elsewhere}
          onClick={() => props.onEditStart()}
        >
          {formatClock(props.running ? props.now - props.running.startedAt.getTime() : 0)}
        </Button>
        <Show
          when={props.running}
          fallback={
            <Button onClick={start}>
              <PlayIcon aria-hidden="true" />
              {m.timer_start()}
            </Button>
          }
        >
          <Button variant="destructive" onClick={() => props.onStop()}>
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
