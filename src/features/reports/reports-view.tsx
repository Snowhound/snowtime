// The Reports view (prototypes/reports.html, 02 · Timesheet): day or week totals by
// project, team or member. The filters live in the URL, so a report reloads and shares;
// each change navigates, and the view reads the filters back from the search params.
import { useQuery } from '@tanstack/solid-query'
import { Link, useNavigate } from '@tanstack/solid-router'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import { Show, createMemo, createSignal } from 'solid-js'
import { PageTitle } from '~/components/page-title'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Card, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { type WeekStart, addDays, localDate } from '~/lib/calendar'
import { errorMessage } from '~/lib/errors'
import { formatIsoDate, formatIsoDateRange } from '~/lib/format'
import { membersQuery } from '~/lib/members'
import { projectsQuery } from '~/lib/projects'
import { teamsQuery } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { MAX_REPORT_DAYS } from '~/server/reports/reports.schemas'
import { ExportMenu } from './export-menu'
import { type FilterActions, ReportFilterBar } from './filter-bar'
import { type Group, type ReportSearch, type Unit, reportFilters } from './filters'
import { reportQuery } from './queries'
import {
  type Range,
  type RangePreset,
  pickedRange,
  presetRange,
  rangeSearch,
  shiftRange,
} from './range'
import { reportRows } from './rows'
import { Timesheet } from './timesheet'

const TITLES = {
  project: { day: m.reports_title_project_day, week: m.reports_title_project_week },
  team: { day: m.reports_title_team_day, week: m.reports_title_team_week },
  member: { day: m.reports_title_member_day, week: m.reports_title_member_week },
} satisfies Record<Group, Record<Unit, () => string>>

export function ReportsView(props: {
  organizationId: string
  organizationSlug: string
  userId: string
  admin: boolean
  zone: string
  weekStart: WeekStart
  search: ReportSearch
}) {
  const navigate = useNavigate()
  const projects = useQuery(() => projectsQuery(props.organizationId))
  const teams = useQuery(() => teamsQuery(props.organizationId))
  const members = useQuery(() => membersQuery(props.organizationId))
  const [rangeError, setRangeError] = createSignal<string | null>(null)
  const [exportError, setExportError] = createSignal<string | null>(null)

  function today() {
    return localDate(Date.now(), props.zone)
  }
  const filters = createMemo(() =>
    reportFilters(props.search, {
      today: today(),
      weekStart: props.weekStart,
      userId: props.userId,
      admin: props.admin,
      teams: teams.data ?? [],
      members: members.data ?? [],
    }),
  )
  // The options depend on the teams the user leads, so the report waits for them.
  const report = useQuery(() => ({
    ...reportQuery(props.organizationId, filters().input),
    enabled: teams.isSuccess && members.isSuccess,
  }))
  const rows = createMemo(() =>
    report.data
      ? reportRows(report.data, filters().group, {
          userId: props.userId,
          admin: props.admin,
          projects: projects.data ?? [],
          teams: teams.data ?? [],
          members: members.data ?? [],
        })
      : [],
  )

  // Only values that differ from the defaults go in the URL.
  function go(next: {
    range?: Range
    unit?: Unit
    group?: Group
    people?: { team?: string; member?: string }
  }) {
    setRangeError(null)
    const f = filters()
    const people = next.people ?? { team: f.team, member: f.member }
    const group = next.group ?? f.group
    const unit = 'unit' in next ? next.unit : props.search.unit
    const search: ReportSearch = {
      ...rangeSearch(next.range ?? f.range, today(), props.weekStart),
      ...(people.team ? { team: people.team } : {}),
      ...(people.member ? { member: people.member } : {}),
      ...(group !== 'project' ? { group } : {}),
      ...(unit === 'week' ? { unit } : {}),
    }
    void navigate({ to: '/reports', search })
  }

  const actions: FilterActions = {
    // A preset picks its own unit: weeks when it is longer than the grid shows as days.
    // Custom keeps the range, ready for its dates to change.
    onPreset: (preset: RangePreset) => {
      if (preset !== 'custom') {
        go({ range: presetRange(preset, today(), props.weekStart), unit: undefined })
        return
      }
      const { from, to } = filters().range
      void navigate({
        to: '/reports',
        search: { ...props.search, range: 'custom', from, to: addDays(to, -1) },
      })
    },
    onShift: (direction) => go({ range: shiftRange(filters().range, direction) }),
    onDates: (from, to) => {
      const range = pickedRange(from, to)
      if (range) go({ range })
      else setRangeError(m.validation_range_too_long({ days: MAX_REPORT_DAYS }))
    },
    onPeople: (people) => go({ people }),
    onGroup: (group) => go({ group }),
    onUnit: (unit) => go({ unit }),
  }

  function rangeLabel() {
    const { from, to } = filters().range
    const last = addDays(to, -1)
    if (from === last) {
      return formatIsoDate(from, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    }
    return formatIsoDateRange(from, last, { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function scopeNote() {
    const access = filters().access
    if (access.kind === 'admin') return m.reports_scope_admin()
    if (access.kind === 'member') return m.reports_scope_member()
    const names = access.teams.map((t) => t.name)
    return m.reports_scope_lead({
      count: names.length,
      teams: new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(names),
    })
  }

  function zoneNote() {
    const zone = props.zone.replaceAll('_', ' ')
    return props.weekStart === 'sun'
      ? m.reports_zone_sunday({ zone })
      : m.reports_zone_monday({ zone })
  }

  function error() {
    return rangeError() ?? exportError() ?? (report.error ? errorMessage(report.error) : null)
  }

  return (
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div class="relative flex min-w-0 flex-col gap-1">
        <PageTitle title={m.nav_reports()} />
        <p class="scene-text text-muted-foreground text-sm">
          {rangeLabel()} · {scopeNote()} {zoneNote()} (
          <Link
            to="/settings"
            hash="preferences"
            class="hover:text-foreground underline underline-offset-4"
          >
            {m.reports_change_settings()}
          </Link>
          ).
        </p>
      </div>
      <ReportFilterBar {...actions} filters={filters()} userId={props.userId} />
      <Show when={error()}>
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>{error()}</AlertDescription>
        </Alert>
      </Show>
      <section class="min-w-0" aria-label={m.reports_timesheet()}>
        <Card class="min-w-0 overflow-hidden">
          <CardHeader class="flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-4">
            <div class="grid min-w-0 gap-1.5">
              <CardTitle class="text-base">{TITLES[filters().group][filters().unit]()}</CardTitle>
              <Show when={filters().group === 'team'}>
                <CardDescription>{m.reports_team_note()}</CardDescription>
              </Show>
            </div>
            <Show when={report.data}>
              {(data) => (
                <ExportMenu
                  report={data()}
                  rows={rows()}
                  group={filters().group}
                  input={filters().input}
                  organizationSlug={props.organizationSlug}
                  projects={projects.data ?? []}
                  members={members.data ?? []}
                  onError={setExportError}
                />
              )}
            </Show>
          </CardHeader>
          <Show when={report.data}>
            {(data) => (
              <Timesheet
                report={data()}
                rows={rows()}
                group={filters().group}
                unit={data().unit}
                today={today()}
                weekStart={props.weekStart}
              />
            )}
          </Show>
        </Card>
      </section>
    </div>
  )
}
