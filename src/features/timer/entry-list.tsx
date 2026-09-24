// The Bar layout's entries (prototypes/timer.html): a card per day, newest first, with the
// day's total, and per entry its description, project, time range, duration, and the
// edit, continue, and delete actions.
import ClockIcon from 'lucide-solid/icons/clock'
import PencilIcon from 'lucide-solid/icons/pencil'
import PlayIcon from 'lucide-solid/icons/play'
import TrashIcon from 'lucide-solid/icons/trash'
import { For, Show } from 'solid-js'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { addDays, localDate } from '~/lib/calendar'
import { formatClock, formatHours, formatIsoDate, formatTime } from '~/lib/format'
import { m } from '~/paraglide/messages.js'
import type { DayGroup } from './entries'
import { ProjectDot } from './project-select'
import type { Entry, Project } from './queries'

export function EntryList(props: {
  groups: readonly DayGroup<Entry>[]
  projects: readonly Project[]
  zone: string
  now: number
  onEdit: (entry: Entry) => void
  onContinue: (entry: Entry) => void
  onDelete: (entry: Entry) => void
}) {
  function dayLabel(date: string) {
    const today = localDate(props.now, props.zone)
    if (date === today) return m.timer_today()
    if (date === addDays(today, -1)) return m.timer_yesterday()
    return formatIsoDate(date, { weekday: 'short', day: 'numeric', month: 'short' })
  }

  function project(id: string | null) {
    if (!id) return null
    return (
      props.projects.find((p) => p.id === id) ?? {
        name: m.timer_unavailable_project(),
        color: null,
      }
    )
  }

  return (
    <Show when={props.groups.length > 0} fallback={<EmptyState />}>
      <For each={props.groups}>
        {(group) => (
          <Card class="overflow-hidden">
            <header class="flex items-center justify-between border-b px-4 py-2.5 text-sm">
              <h2 class="font-medium">{dayLabel(group.date)}</h2>
              <span class="text-muted-foreground font-mono tabular-nums">
                {formatHours(group.total)}
              </span>
            </header>
            <ul class="divide-y">
              <For each={group.entries}>
                {(entry) => (
                  <li class="group flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                      <span class="truncate text-sm">
                        <Show
                          when={entry.description}
                          fallback={
                            <span class="text-muted-foreground italic">
                              {m.timer_no_description()}
                            </span>
                          }
                        >
                          {entry.description}
                        </Show>
                      </span>
                      <Show when={project(entry.projectId)}>
                        {(p) => (
                          <span class="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs sm:max-w-56">
                            <ProjectDot color={p().color} />
                            <span class="truncate">{p().name}</span>
                          </span>
                        )}
                      </Show>
                    </div>
                    <div class="flex items-center justify-between gap-3 sm:justify-end">
                      <button
                        type="button"
                        class="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-xs whitespace-nowrap tabular-nums underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                        aria-label={
                          entry.description
                            ? m.timer_edit_time({ description: entry.description })
                            : m.timer_edit_time_unnamed()
                        }
                        onClick={() => props.onEdit(entry)}
                      >
                        {formatTime(entry.startedAt, props.zone)} –{' '}
                        {formatTime(entry.stoppedAt!, props.zone)}
                      </button>
                      <span class="w-16 text-right font-mono text-sm tabular-nums">
                        {formatClock(entry.stoppedAt!.getTime() - entry.startedAt.getTime())}
                      </span>
                      <EntryActions
                        entry={entry}
                        onEdit={props.onEdit}
                        onContinue={props.onContinue}
                        onDelete={props.onDelete}
                      />
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Card>
        )}
      </For>
    </Show>
  )
}

function EntryActions(props: {
  entry: Entry
  onEdit: (entry: Entry) => void
  onContinue: (entry: Entry) => void
  onDelete: (entry: Entry) => void
}) {
  function description() {
    return props.entry.description
  }
  return (
    <div class="flex items-center gap-1 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
      <Button
        variant="ghost"
        size="icon"
        aria-label={
          description() ? m.timer_edit({ description: description() }) : m.timer_edit_unnamed()
        }
        onClick={() => props.onEdit(props.entry)}
      >
        <PencilIcon aria-hidden="true" />
      </Button>
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

function EmptyState() {
  return (
    <div class="bg-background flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
      <ClockIcon class="text-muted-foreground size-6" aria-hidden="true" />
      <p class="font-medium">{m.timer_empty_title()}</p>
      <p class="text-muted-foreground text-sm">{m.timer_empty_description()}</p>
    </div>
  )
}
