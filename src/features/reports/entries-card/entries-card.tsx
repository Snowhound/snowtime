// The Entries card (prototypes/reports.html): the entries behind the report, or behind the
// part chosen in one of its views, by day or merged by description. Read-only: only an
// entry's owner edits it, on the Timer page. The header's count and total come from the
// report, or for a part of it from a query of their own; the list loads only while open.
import ChevronDownIcon from 'lucide-solid/icons/chevron-down'
import XIcon from 'lucide-solid/icons/x'
import { Show, createEffect, createSignal } from 'solid-js'
import { Duration } from '~/components/duration'
import { ErrorAlert } from '~/components/error-alert'
import { Badge } from '~/components/ui/badge'
import { Card, CardHeader, CardTitle } from '~/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { readCookie, writeCookie } from '~/lib/cookies'
import { errorMessage } from '~/lib/errors'
import type { Project } from '~/lib/queries/projects'
import { useQuery } from '~/lib/queries/use-query'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { EntryFilters, EntryView } from '../filters'
import { reportEntryTotalsQuery } from '../queries'
import type { RowNames } from '../rows'
import { ReportEntryList } from './report-entry-list'

// Flags kept in this browser: whether the user has narrowed the list from the timesheet, after
// which the header's hint on how to do that no longer shows, and whether they left the list
// open. It starts closed, showing only the header, until they open it. They are cookies, so
// the server renders the card as the browser shows it.
const NARROWED_KEY = 'snowtime.reportEntriesNarrowed'
const OPEN_KEY = 'snowtime.reportEntriesOpen'

function readFlag(key: string) {
  return readCookie(key) === '1'
}

function writeFlag(key: string, on: boolean) {
  writeCookie(key, on ? '1' : null)
}

export function EntriesCard(props: {
  organizationId: string
  filters: EntryFilters
  // The timesheet part the list narrows to, named; null when it lists the whole report.
  narrowLabel: string | null
  // The whole report's entries and time.
  whole: { count: number; total: number }
  zone: string
  projects: Project[]
  names: Pick<RowNames, 'userId' | 'members' | 'former'>
  onView: (view: EntryView) => void
  onClear: () => void
}) {
  const [hint, setHint] = createSignal(!readFlag(NARROWED_KEY))
  const [open, setOpen] = createSignal(readFlag(OPEN_KEY))
  const narrowed = useQuery(() => ({
    ...reportEntryTotalsQuery(
      props.organizationId,
      props.filters.totals ?? { report: props.filters.input.report },
    ),
    enabled: props.filters.totals !== null,
  }))
  function toggle(next: boolean) {
    setOpen(next)
    writeFlag(OPEN_KEY, next)
  }
  // Choosing a part of the timesheet asks for its entries, so it opens the list.
  createEffect(() => {
    if (!props.narrowLabel) return
    writeFlag(NARROWED_KEY, true)
    setHint(false)
    toggle(true)
  })

  function summary() {
    return props.filters.totals ? narrowed.data : props.whole
  }

  return (
    <Card class="min-w-0 scroll-mt-4 overflow-hidden" id="report-entries">
      <CardHeader
        class={cn(
          'flex-row flex-wrap items-start justify-between gap-2 space-y-0',
          open() && 'pb-4',
        )}
      >
        <div class="grid min-w-0 gap-1.5">
          <CardTitle class="text-base">
            <button
              type="button"
              class="hover:text-foreground/80 focus-visible:ring-ring -mx-1 flex items-center gap-1.5 rounded-sm px-1 focus-visible:ring-2 focus-visible:outline-none"
              aria-expanded={open()}
              aria-controls="report-entries-list"
              onClick={() => toggle(!open())}
            >
              <ChevronDownIcon
                class={cn('size-4 transition-transform', !open() && '-rotate-90')}
                aria-hidden="true"
              />
              {m.reports_entries()}
            </button>
          </CardTitle>
          <div class="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Show when={summary()}>
              {(s) => (
                <span class="tabular-nums">
                  {m.reports_entries_count({ count: s().count })} · <Duration ms={s().total} />
                </span>
              )}
            </Show>
            <Show
              when={props.narrowLabel}
              fallback={
                <Show when={hint()}>
                  <span>{m.reports_entries_hint()}</span>
                </Show>
              }
            >
              {(label) => (
                <Badge variant="secondary" class="max-w-full gap-1 py-0.5 pr-0.5 font-medium">
                  <span class="truncate">{label()}</span>
                  <button
                    type="button"
                    class="hover:bg-background/60 focus-visible:ring-ring rounded-sm p-0.5 focus-visible:ring-2 focus-visible:outline-none"
                    aria-label={m.reports_entries_clear()}
                    onClick={() => props.onClear()}
                  >
                    <XIcon class="size-3.5" aria-hidden="true" />
                  </button>
                </Badge>
              )}
            </Show>
          </div>
        </div>
        <Show when={open()}>
          <ToggleGroup
            variant="outline"
            size="sm"
            class="justify-start"
            aria-label={m.reports_entries_view()}
            value={props.filters.view}
            onChange={(value) => value && props.onView(value as EntryView)}
          >
            <ToggleGroupItem value="day">{m.reports_entries_by_day()}</ToggleGroupItem>
            <ToggleGroupItem value="description">
              {m.reports_entries_by_description()}
            </ToggleGroupItem>
          </ToggleGroup>
        </Show>
      </CardHeader>
      <Show when={narrowed.error}>
        {(error) => (
          <div class="px-6 pb-4">
            <ErrorAlert message={errorMessage(error())} />
          </div>
        )}
      </Show>
      <div id="report-entries-list">
        <Show when={open()}>
          <ReportEntryList
            organizationId={props.organizationId}
            filters={props.filters}
            zone={props.zone}
            projects={props.projects}
            names={props.names}
          />
        </Show>
      </div>
    </Card>
  )
}
