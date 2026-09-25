// The timer view (prototypes/timer.html): the timer, the user's recent entries by day, the
// summary, and the entry dialog, in the layout of the user's settings. Bar lists day
// cards; Focus has a large clock, "continue recent" chips, and the last three days;
// Table has one table with day subtotals. The compactRows setting makes the timer and the
// rows of every layout shorter. Entries are edited in their rows; the dialog adds an entry
// or edits the running one's start. Every write is optimistic and rolls back on error
// (queries.ts), with the error shown under the edited row or above the timer.
import { keepPreviousData, useQuery } from '@tanstack/solid-query'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import PlusIcon from 'lucide-solid/icons/plus'
import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { PageTitle } from '~/components/page-title'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { localDate } from '~/lib/calendar'
import { errorMessage } from '~/lib/errors'
import { formatClock, formatHours, formatIsoDate } from '~/lib/format'
import { projectsQuery } from '~/lib/projects'
import { newId } from '~/lib/query'
import type { Settings } from '~/lib/settings'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { groupByDay, recentRange, recentWork, summarize } from './entries'
import { EntryDialog, type EntryDialogTarget, type EntryDialogValues } from './entry-dialog'
import type { EntryPatch } from './entry-fields'
import { EmptyState, EntryList } from './entry-list'
import { EntryTable } from './entry-table'
import {
  type Entry,
  entriesQuery,
  firstEntryQuery,
  runningTimerQuery,
  useCreateEntry,
  useDeleteEntry,
  useStartTimer,
  useStopTimer,
  useUpdateEntry,
} from './queries'
import { RecentWork } from './recent-work'
import { SummaryPanel } from './summary-panel'
import { TimerBar } from './timer-bar'
import { ViewPopover } from './view-popover'

// Days of entries shown at first, and added by "Show earlier entries", up to the most
// listEntries returns in one call (MAX_LIST_DAYS). Older time is in Reports.
export const RECENT_DAYS = 14
const MAX_DAYS = 84
// Days Focus shows.
const FOCUS_DAYS = 3
// How long a row shows "Saved" after the server confirms its change.
const SAVED_MS = 1200

export function TimerView(props: {
  organizationId: string
  userId: string
  settings: Settings
  organizations: readonly { id: string; name: string }[]
}) {
  function zone() {
    return props.settings.timeZone
  }
  function layout() {
    return props.settings.timerLayout
  }

  const [days, setDays] = createSignal(RECENT_DAYS)
  const range = createMemo(() => recentRange(zone(), days()))

  const running = useQuery(() => runningTimerQuery)
  const projects = useQuery(() => projectsQuery(props.organizationId))
  const entries = useQuery(() => ({
    ...entriesQuery(props.organizationId, props.userId, range()),
    placeholderData: keepPreviousData,
  }))
  const firstEntry = useQuery(() => firstEntryQuery(props.organizationId, props.userId))

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
  const stopped = createMemo(() => (entries.data ?? []).filter((e) => e.stoppedAt))
  const groups = createMemo(() => groupByDay(stopped(), zone()))
  function shownGroups() {
    return layout() === 'focus' ? groups().slice(0, FOCUS_DAYS) : groups()
  }

  // Earlier time exists when the earliest entry starts before the loaded days.
  function hasEarlier() {
    const first = firstEntry.data
    return !!first && first.getTime() < range().from
  }

  // Everything is loaded, so the shown days hold all of the user's time.
  function allTime() {
    const first = firstEntry.data
    if (!first) return null
    const total = stopped().reduce(
      (sum, e) => sum + e.stoppedAt!.getTime() - e.startedAt.getTime(),
      0,
    )
    const date = formatIsoDate(localDate(first.getTime(), zone()), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    return m.timer_all_time({ date, total: formatHours(total) })
  }

  // The summary covers this organization, so a timer running in another one stays out.
  // The ranges lie within the loaded days: a week is shorter than RECENT_DAYS.
  function summary() {
    const timer = running.data
    const counted =
      timer?.organizationId === props.organizationId ? [...stopped(), timer] : stopped()
    return summarize(counted, {
      zone: zone(),
      weekStart: props.settings.weekStart,
      now: now(),
    })
  }

  function showError(e: unknown) {
    setError(errorMessage(e))
  }
  const options = { onError: showError }

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
    } else {
      const { stoppedAt: _, ...patch } = values
      updateEntry.mutate({ id: target.entry.id, ...patch }, options)
    }
  }

  // Rows whose save the server confirmed a moment ago; they show "Saved" (EntryActions).
  // Kept here, not in the row, because a new date moves the entry to another day's row.
  const [savedIds, setSavedIds] = createSignal<ReadonlySet<string>>(new Set())
  const savedTimers = new Map<string, ReturnType<typeof setTimeout>>()
  onCleanup(() => savedTimers.forEach(clearTimeout))

  function markSaved(id: string) {
    clearTimeout(savedTimers.get(id))
    savedTimers.set(
      id,
      setTimeout(() => {
        savedTimers.delete(id)
        setSavedIds((ids) => {
          const next = new Set(ids)
          next.delete(id)
          return next
        })
      }, SAVED_MS),
    )
    setSavedIds((ids) => new Set(ids).add(id))
  }

  const listProps = {
    get projects() {
      return projects.data ?? []
    },
    get zone() {
      return zone()
    },
    get weekStart() {
      return props.settings.weekStart
    },
    get now() {
      return now()
    },
    get compact() {
      return props.settings.compactRows
    },
    // A row shows its own error, so this one resolves or rejects instead of using the alert.
    onSave: async (entry: Entry, patch: EntryPatch) => {
      setError(null)
      await updateEntry.mutateAsync({ id: entry.id, ...patch })
      markSaved(entry.id)
    },
    justSaved: (id: string) => savedIds().has(id),
    onContinue: (entry: Entry) => start(entry.description, entry.projectId),
    onDelete: remove,
  }

  return (
    <div class="grid gap-4">
      <div class="relative flex items-center justify-between gap-4">
        <PageTitle title={m.nav_timer()} />
        <div class="flex items-center gap-2">
          <Button
            variant="secondary"
            class="border-input text-primary h-9 border px-3"
            onClick={() => setDialog({ kind: 'new' })}
          >
            <PlusIcon aria-hidden="true" />
            {m.timer_add_entry()}
          </Button>
          <ViewPopover settings={props.settings} onError={showError} />
        </div>
      </div>
      <div
        class={
          props.settings.showSummary
            ? 'grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_auto]'
            : 'grid grid-cols-[minmax(0,1fr)] gap-6'
        }
      >
        <div class={cn('flex min-w-0 flex-col', props.settings.compactRows ? 'gap-4' : 'gap-6')}>
          <Show when={error()}>
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{error()}</AlertDescription>
            </Alert>
          </Show>
          <TimerBar
            layout={layout()}
            compact={props.settings.compactRows}
            running={running.data ?? null}
            projects={projects.data ?? []}
            elsewhere={elsewhere()}
            now={now()}
            onStart={start}
            onStop={stop}
            onUpdate={(patch) => running.data && update(running.data.id, patch)}
            onEditStart={() => running.data && setDialog({ kind: 'running', entry: running.data })}
          />
          <Show when={layout() === 'focus' && entries.data}>
            <RecentWork
              entries={recentWork(stopped())}
              projects={projects.data ?? []}
              onContinue={listProps.onContinue}
            />
          </Show>
          <section class="flex min-w-0 flex-col gap-4" aria-label={m.timer_entries()}>
            <Show when={entries.data}>
              <Show when={groups().length > 0} fallback={<EmptyState />}>
                <Switch>
                  <Match when={layout() === 'table'}>
                    <EntryTable groups={groups()} {...listProps} />
                  </Match>
                  <Match when={layout() !== 'table'}>
                    <EntryList groups={shownGroups()} focus={layout() === 'focus'} {...listProps} />
                  </Match>
                </Switch>
              </Show>
              <Show when={layout() !== 'focus' && firstEntry.isSuccess}>
                <div class="flex justify-center">
                  <Show
                    when={hasEarlier()}
                    fallback={
                      <Show when={groups().length > 0 && allTime()}>
                        {(text) => (
                          <p class="page-note text-muted-foreground flex w-full items-center gap-3 text-sm">
                            <span class="bg-border h-px flex-1" aria-hidden="true" />
                            {text()}
                            <span class="bg-border h-px flex-1" aria-hidden="true" />
                          </p>
                        )}
                      </Show>
                    }
                  >
                    <Show
                      when={days() < MAX_DAYS}
                      fallback={
                        <p class="page-note text-muted-foreground text-sm">
                          {m.timer_earlier_in_reports()}
                        </p>
                      }
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={entries.isPlaceholderData}
                        onClick={() => setDays((d) => d + RECENT_DAYS)}
                      >
                        {m.timer_show_earlier()}
                      </Button>
                    </Show>
                  </Show>
                </div>
              </Show>
            </Show>
          </section>
        </div>
        <Show when={props.settings.showSummary && entries.data}>
          <SummaryPanel summary={summary()} projects={projects.data ?? []} />
        </Show>
      </div>
      <EntryDialog
        target={dialog()}
        zone={zone()}
        weekStart={props.settings.weekStart}
        projects={projects.data ?? []}
        onSave={save}
        onClose={() => setDialog(null)}
      />
    </div>
  )
}
