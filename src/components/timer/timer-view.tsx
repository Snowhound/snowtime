// The timer view in the Bar layout (prototypes/timer.html): the timer, the user's recent
// entries by day, and the entry dialog. Every write is optimistic and rolls back on error
// (src/lib/timer.ts), with the error shown above the timer.
import { keepPreviousData, useQuery } from '@tanstack/solid-query'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import PlusIcon from 'lucide-solid/icons/plus'
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { groupByDay, recentRange } from '../../lib/entries'
import { errorMessage } from '../../lib/errors'
import { formatClock } from '../../lib/format'
import { newId } from '../../lib/query'
import {
  type Entry,
  entriesQuery,
  projectsQuery,
  runningTimerQuery,
  useCreateEntry,
  useDeleteEntry,
  useStartTimer,
  useStopTimer,
  useUpdateEntry,
} from '../../lib/timer'
import { m } from '../../paraglide/messages.js'
import { Alert, AlertDescription } from '../ui/alert'
import { Button } from '../ui/button'
import { EntryDialog, type EntryDialogTarget, type EntryDialogValues } from './entry-dialog'
import { EntryList } from './entry-list'
import { TimerBar } from './timer-bar'

// Days of entries shown at first, and added by "Show earlier entries", up to the most
// listEntries returns in one call (MAX_LIST_DAYS). Older time is in Reports.
export const RECENT_DAYS = 14
const MAX_DAYS = 84

export function TimerView(props: {
  organizationId: string
  userId: string
  zone: string
  organizations: readonly { id: string; name: string }[]
}) {
  const [days, setDays] = createSignal(RECENT_DAYS)
  const range = createMemo(() => recentRange(props.zone, days()))

  const running = useQuery(() => runningTimerQuery)
  const projects = useQuery(() => projectsQuery(props.organizationId))
  const entries = useQuery(() => ({
    ...entriesQuery(props.organizationId, props.userId, range()),
    placeholderData: keepPreviousData,
  }))

  const startTimer = useStartTimer()
  const stopTimer = useStopTimer()
  const updateEntry = useUpdateEntry()
  const deleteEntry = useDeleteEntry()
  const createEntry = useCreateEntry()

  const [error, setError] = createSignal<string | null>(null)
  const [dialog, setDialog] = createSignal<EntryDialogTarget | null>(null)

  // The elapsed time ticks on the client only; nothing is written while the timer runs.
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!running.data) return
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(tick))
  })

  const title = `${m.nav_timer()} · ${m.app_name()}`
  createEffect(() => {
    const timer = running.data
    document.title = timer ? `${formatClock(now() - timer.startedAt.getTime())} · ${title}` : title
  })
  onCleanup(() => {
    if (typeof document !== 'undefined') document.title = title
  })

  function elsewhere() {
    const timer = running.data
    if (!timer || timer.organizationId === props.organizationId) return null
    return props.organizations.find((o) => o.id === timer.organizationId)?.name ?? null
  }

  // The running entry shows in the timer only.
  const groups = createMemo(() =>
    groupByDay(
      (entries.data ?? []).filter((e) => e.stoppedAt),
      props.zone,
    ),
  )

  const options = { onError: (e: unknown) => setError(errorMessage(e)) }

  function start(description: string, projectId: string | null) {
    setError(null)
    startTimer.mutate({ id: newId(), description, projectId }, options)
  }

  function stop() {
    const timer = running.data
    if (!timer) return
    setError(null)
    stopTimer.mutate({ id: timer.id }, options)
  }

  function update(id: string, patch: { description?: string; projectId?: string | null }) {
    setError(null)
    updateEntry.mutate({ id, ...patch }, options)
  }

  function remove(entry: Entry) {
    setError(null)
    deleteEntry.mutate({ id: entry.id }, options)
  }

  function save(values: EntryDialogValues) {
    const target = dialog()
    setDialog(null)
    setError(null)
    if (!target) return
    if (target.kind === 'new') {
      createEntry.mutate({ id: newId(), ...values, stoppedAt: values.stoppedAt! }, options)
    } else if (target.kind === 'running') {
      const { stoppedAt: _, ...patch } = values
      updateEntry.mutate({ id: target.entry.id, ...patch }, options)
    } else {
      updateEntry.mutate({ id: target.entry.id, ...values, stoppedAt: values.stoppedAt! }, options)
    }
  }

  return (
    <div class="grid gap-4">
      <div class="flex items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold tracking-tight">{m.nav_timer()}</h1>
        <Button variant="outline" onClick={() => setDialog({ kind: 'new' })}>
          <PlusIcon aria-hidden="true" />
          {m.timer_add_entry()}
        </Button>
      </div>
      <div class="flex min-w-0 flex-col gap-6">
        <Show when={error()}>
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden="true" />
            <AlertDescription>{error()}</AlertDescription>
          </Alert>
        </Show>
        <TimerBar
          running={running.data ?? null}
          projects={projects.data ?? []}
          elsewhere={elsewhere()}
          now={now()}
          onStart={start}
          onStop={stop}
          onUpdate={(patch) => running.data && update(running.data.id, patch)}
          onEditStart={() => running.data && setDialog({ kind: 'running', entry: running.data })}
        />
        <section class="flex min-w-0 flex-col gap-4" aria-label={m.timer_entries()}>
          <Show when={entries.data}>
            <EntryList
              groups={groups()}
              projects={projects.data ?? []}
              zone={props.zone}
              now={now()}
              onEdit={(entry) => setDialog({ kind: 'edit', entry })}
              onContinue={(entry) => start(entry.description, entry.projectId)}
              onDelete={remove}
            />
            <div class="flex justify-center">
              <Show
                when={days() < MAX_DAYS}
                fallback={
                  <p class="text-muted-foreground text-sm">{m.timer_earlier_in_reports()}</p>
                }
              >
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={entries.isPlaceholderData}
                  onClick={() => setDays((d) => d + RECENT_DAYS)}
                >
                  {m.timer_show_earlier()}
                </Button>
              </Show>
            </div>
          </Show>
        </section>
      </div>
      <EntryDialog
        target={dialog()}
        zone={props.zone}
        projects={projects.data ?? []}
        onSave={save}
        onClose={() => setDialog(null)}
      />
    </div>
  )
}
