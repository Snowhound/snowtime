// The timer view (prototypes/timer.html): the timer, the user's recent entries by day, the
// summary, and the entry popover, in the Bar, Focus, or Table layout; or, with the List |
// Calendar switch on Calendar, the timer over the week calendar (calendar/timer-calendar.tsx).
// Every write is optimistic (queries.ts); its error shows under the edited row or above the
// timer.
import { keepPreviousData } from '@tanstack/solid-query'
import { Link } from '@tanstack/solid-router'
import CalendarDaysIcon from 'lucide-solid/icons/calendar-days'
import ListIcon from 'lucide-solid/icons/list'
import PlusIcon from 'lucide-solid/icons/plus'
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js'
import { ErrorAlert } from '~/components/error-alert'
import { PageTitle } from '~/components/page-title'
import { Button } from '~/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { addDays, localDate, startOfDay } from '~/lib/calendar'
import { useFormatHours } from '~/lib/display-format'
import { errorMessage } from '~/lib/errors'
import { formatIsoDate } from '~/lib/format'
import { projectsQuery } from '~/lib/queries/projects'
import { newId } from '~/lib/queries/query'
import { type Settings, useUpdateSettings } from '~/lib/queries/settings'
import { runningTimerQuery } from '~/lib/queries/timer'
import { useQuery } from '~/lib/queries/use-query'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { type CalendarControls, TimerCalendar } from './calendar/timer-calendar'
import {
  RECENT_DAYS,
  groupByDay,
  recentRange,
  recentWork,
  recentTickets,
  summarize,
} from './entries'
import type { EntryPatch } from './entry-fields'
import { EmptyState, EntryList } from './entry-list'
import { EntryPopover, type EntryPopoverTarget, type EntryPopoverValues } from './entry-popover'
import { EntryTable } from './entry-table'
import {
  type Entry,
  type StoppedEntry,
  entriesQuery,
  firstEntryQuery,
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

// Days of entries shown at most, as listEntries returns in one call (MAX_LIST_DAYS). Older
// time is in Reports.
const MAX_DAYS = 84
// Days Focus shows.
const FOCUS_DAYS = 3
// How long a row shows "Saved" after the server confirms its change.
const SAVED_MS = 1200

// The note past MAX_DAYS, with its {reports} as a link to Reports.
function EarlierInReports() {
  const parts = m.timer_earlier_in_reports({ reports: '\u0000' }).split('\u0000')
  return (
    <For each={parts}>
      {(part, i) => (
        <>
          {i() > 0 && (
            <Link
              from="/$org"
              to="/$org/reports"
              class="hover:text-foreground underline underline-offset-4"
            >
              {m.timer_earlier_in_reports_link()}
            </Link>
          )}
          {part}
        </>
      )}
    </For>
  )
}

export function TimerView(props: {
  organizationId: string
  userId: string
  settings: Settings
  organizations: readonly { id: string; name: string }[]
  // The organization's Issue links setting, which ticket chips link through.
  issueLinks: string | null
}) {
  const formatHours = useFormatHours()
  function zone() {
    return props.settings.timeZone
  }
  function layout() {
    return props.settings.timerLayout
  }
  function wide() {
    return props.settings.wideTimer
  }
  function calendar() {
    return props.settings.timerView === 'calendar'
  }
  // The calendar's day and week totals take the summary's place.
  function summaryShown() {
    return props.settings.showSummary && !calendar()
  }
  const saveSettings = useUpdateSettings()
  let calendarControls: CalendarControls | undefined

  const running = useQuery(() => runningTimerQuery)

  // The elapsed time ticks on the client only; nothing is written while the timer runs.
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!running.data) return
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(tick))
  })
  // Today moves on at the zone's midnight, running timer or not, and the days listed, their
  // labels, and the summary with it. A timeout can fire late after the device sleeps, so
  // the time is read again when the tab shows.
  const today = createMemo(() => localDate(now(), zone()))
  createEffect(() => {
    let wait: ReturnType<typeof setTimeout> | undefined
    function waitFor(midnight: number) {
      const time = Date.now()
      if (time < midnight) wait = setTimeout(() => waitFor(midnight), midnight - time)
      else setNow(time)
    }
    waitFor(startOfDay(addDays(today(), 1), zone()))
    onCleanup(() => clearTimeout(wait))
  })
  function onVisible() {
    if (document.visibilityState === 'visible') setNow(Date.now())
  }
  onMount(() => {
    document.addEventListener('visibilitychange', onVisible)
    onCleanup(() => document.removeEventListener('visibilitychange', onVisible))
  })

  const [days, setDays] = createSignal(RECENT_DAYS)
  const range = createMemo(() => recentRange(zone(), days(), startOfDay(today(), zone())))

  const projects = useQuery(() => projectsQuery(props.organizationId))
  const entries = useQuery(() => ({
    ...entriesQuery(props.organizationId, props.userId, range()),
    placeholderData: keepPreviousData,
  }))
  const firstEntry = useQuery(() => firstEntryQuery(props.organizationId, props.userId))

  // oxlint-disable-next-line solid/reactivity -- the page renders a new view per organization.
  const keys = { organizationId: props.organizationId }
  const startTimer = useStartTimer(keys)
  const stopTimer = useStopTimer()
  const updateEntry = useUpdateEntry(keys)
  const deleteEntry = useDeleteEntry(keys)
  const createEntry = useCreateEntry(keys)

  const [error, setError] = createSignal<string | null>(null)
  // The entry popover's form and the button it opens under.
  const [editor, setEditor] = createSignal<{
    target: EntryPopoverTarget
    anchor: HTMLElement
  } | null>(null)

  // A click on the button that opened the popover closes it; on the other, it moves there.
  function toggleEditor(target: EntryPopoverTarget, anchor: HTMLElement) {
    setEditor((current) => (current?.target.kind === target.kind ? null : { target, anchor }))
  }

  function elsewhere() {
    const timer = running.data
    if (!timer || timer.organizationId === props.organizationId) return null
    return props.organizations.find((o) => o.id === timer.organizationId)?.name ?? null
  }

  // The running entry shows in the timer only.
  const stopped = createMemo(() =>
    (entries.data ?? []).filter((e): e is StoppedEntry => e.stoppedAt !== null),
  )
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
      (sum, e) => sum + e.stoppedAt.getTime() - e.startedAt.getTime(),
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
  const summary = createMemo(() => {
    const timer = running.data
    const counted =
      timer?.organizationId === props.organizationId ? [...stopped(), timer] : stopped()
    return summarize(counted, {
      zone: zone(),
      weekStart: props.settings.weekStart,
      now: now(),
    })
  })

  function showError(e: unknown) {
    setError(errorMessage(e))
  }
  const options = { onError: showError }

  // Why the last Show earlier failed, shown by its button.
  const [earlierError, setEarlierError] = createSignal<string | null>(null)
  function showEarlier() {
    setEarlierError(null)
    setDays((d) => d + RECENT_DAYS)
  }

  // A range that fails to load says why, and earlier days go back to the days shown before,
  // so the list stays up and Show earlier tries again.
  createEffect(() => {
    if (!entries.isError || entries.data) return
    if (days() > RECENT_DAYS) {
      setEarlierError(errorMessage(entries.error))
      setDays((d) => d - RECENT_DAYS)
    } else showError(entries.error)
  })

  function start(description: string, projectId: string | null, ticket: string | null) {
    setError(null)
    startTimer.mutate({ id: newId(), description, ticket, projectId }, options)
  }

  function stop() {
    const timer = running.data
    if (!timer) return
    setError(null)
    stopTimer.mutate({ id: timer.id }, options)
  }

  function update(id: string, patch: EntryPatch) {
    setError(null)
    updateEntry.mutate({ id, ...patch }, options)
  }

  function remove(entry: Entry) {
    setError(null)
    deleteEntry.mutate({ id: entry.id }, options)
  }

  function save(values: EntryPopoverValues) {
    const target = editor()?.target
    setEditor(null)
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
    get tickets() {
      return recentTickets(stopped())
    },
    get projects() {
      return projects.data ?? []
    },
    get zone() {
      return zone()
    },
    get weekStart() {
      return props.settings.weekStart
    },
    get today() {
      return today()
    },
    get compact() {
      return props.settings.compactRows
    },
    get wide() {
      return props.settings.wideTimer
    },
    get issueLinks() {
      return props.issueLinks
    },
    // A row shows its own error, so this one resolves or rejects instead of using the alert.
    onSave: async (entry: Entry, patch: EntryPatch) => {
      setError(null)
      await updateEntry.mutateAsync({ id: entry.id, ...patch })
      markSaved(entry.id)
    },
    justSaved: (id: string) => savedIds().has(id),
    onContinue: (entry: Entry) => start(entry.description, entry.projectId, entry.ticket),
    onDelete: remove,
  }

  return (
    <div class={cn('mx-auto grid w-full gap-4', wide() ? 'max-w-[88rem]' : 'max-w-6xl')}>
      <div class="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <PageTitle title={m.nav_timer()} />
        <div class="flex items-center gap-2">
          {/* The view switch leads the actions, set apart from them. */}
          <ToggleGroup
            variant="outline"
            class="mr-2"
            aria-label={m.timer_view_as()}
            value={props.settings.timerView}
            onChange={(value) =>
              value &&
              saveSettings.mutate(
                { timerView: value as Settings['timerView'] },
                { onError: showError },
              )
            }
          >
            <ToggleGroupItem value="list" class="gap-1.5">
              <ListIcon aria-hidden="true" class="size-4" />
              {m.timer_view_list()}
            </ToggleGroupItem>
            <ToggleGroupItem value="calendar" class="gap-1.5">
              <CalendarDaysIcon aria-hidden="true" class="size-4" />
              {m.timer_view_calendar()}
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant="secondary"
            class="border-input text-primary h-9 border px-3"
            data-entry-trigger
            onClick={(event) =>
              calendar()
                ? calendarControls?.addEntry(event.currentTarget)
                : toggleEditor({ kind: 'new' }, event.currentTarget)
            }
          >
            <PlusIcon aria-hidden="true" />
            {m.timer_add_entry()}
          </Button>
          <ViewPopover settings={props.settings} onError={showError} />
        </div>
      </div>
      {/* The header's width, with the timer beside the summary; or, with the Wide page
          setting, up to 88rem with the timer across the summary column. */}
      <div
        class={cn(
          'grid grid-cols-[minmax(0,1fr)] gap-x-6',
          props.settings.compactRows ? 'gap-y-4' : 'gap-y-6',
          summaryShown() && 'lg:grid-cols-[minmax(0,1fr)_auto]',
          summaryShown() && !wide() && 'lg:grid-rows-[auto_1fr]',
        )}
      >
        <div
          class={cn(
            'flex min-w-0 flex-col',
            props.settings.compactRows ? 'gap-4' : 'gap-6',
            wide() ? 'col-[1/-1]' : 'lg:col-start-1 lg:row-start-1',
          )}
        >
          <ErrorAlert message={error()} />
          <TimerBar
            organizationId={props.organizationId}
            userId={props.userId}
            layout={layout()}
            compact={props.settings.compactRows}
            running={running.data ?? null}
            projects={projects.data ?? []}
            entries={stopped()}
            elsewhere={elsewhere()}
            issueLinks={props.issueLinks}
            now={now()}
            onStart={start}
            onStop={stop}
            onUpdate={(patch) => running.data && update(running.data.id, patch)}
            onEditStart={(anchor) =>
              running.data && toggleEditor({ kind: 'running', entry: running.data }, anchor)
            }
          />
        </div>
        <div
          class={cn(
            'flex min-w-0 flex-col',
            props.settings.compactRows ? 'gap-4' : 'gap-6',
            !wide() && 'lg:col-start-1 lg:row-start-2',
          )}
        >
          <Show
            when={calendar()}
            fallback={
              <>
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
                          <EntryList
                            groups={shownGroups()}
                            focus={layout() === 'focus'}
                            {...listProps}
                          />
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
                                <p class="page-note text-muted-foreground text-sm">{text()}</p>
                              )}
                            </Show>
                          }
                        >
                          <Show
                            when={days() < MAX_DAYS}
                            fallback={
                              <p class="page-note text-muted-foreground text-sm">
                                <EarlierInReports />
                              </p>
                            }
                          >
                            <div class="flex w-full flex-col items-center gap-3">
                              <ErrorAlert message={earlierError()} />
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={entries.isPlaceholderData}
                                onClick={showEarlier}
                              >
                                {m.timer_show_earlier()}
                              </Button>
                            </div>
                          </Show>
                        </Show>
                      </div>
                    </Show>
                  </Show>
                </section>
              </>
            }
          >
            <TimerCalendar
              organizationId={props.organizationId}
              userId={props.userId}
              settings={props.settings}
              projects={projects.data ?? []}
              running={running.data ?? null}
              recent={stopped()}
              issueLinks={props.issueLinks}
              controls={(controls) => (calendarControls = controls)}
            />
          </Show>
        </div>
        <Show when={summaryShown() && entries.data}>
          <div
            class={cn('lg:self-start', !wide() && 'lg:col-start-2 lg:row-span-2 lg:row-start-1')}
          >
            <SummaryPanel summary={summary()} projects={projects.data ?? []} />
          </div>
        </Show>
      </div>
      <EntryPopover
        target={editor()?.target ?? null}
        anchor={editor()?.anchor}
        zone={zone()}
        weekStart={props.settings.weekStart}
        projects={projects.data ?? []}
        entries={stopped()}
        issueLinks={props.issueLinks}
        onSave={save}
        onClose={() => setEditor(null)}
      />
    </div>
  )
}
