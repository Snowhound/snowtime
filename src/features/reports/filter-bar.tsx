// The filter row above the report's views (prototypes/reports.html): range preset, previous and
// next, from and to, People, Project, Group by, and totals per day or week. Members get no
// People: they see their own time. The fields are sized so the row fits the header's 68rem on
// one line, which is why Group by is a select rather than tabs. The selects mark their option
// `selected` too, because a select's value does nothing in server-rendered HTML.
import ChevronLeftIcon from 'lucide-solid/icons/chevron-left'
import ChevronRightIcon from 'lucide-solid/icons/chevron-right'
import { For, Show } from 'solid-js'
import { DatePicker } from '~/components/date-time/date-picker'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { NativeSelect } from '~/components/ui/native-select'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { type IsoDate, type WeekStart, addDays } from '~/lib/calendar'
import type { Project } from '~/lib/queries/projects'
import { m } from '~/paraglide/messages.js'
import { GROUP_LABELS, type Group, type ReportFilters, type Unit, groupOptions } from './filters'
import { MAX_DAY_COLUMNS, type RangePreset, rangeDays } from './range'

const PRESET_LABELS = {
  today: m.reports_preset_today,
  'this-week': m.reports_preset_this_week,
  'last-week': m.reports_preset_last_week,
  'this-month': m.reports_preset_this_month,
  'last-month': m.reports_preset_last_month,
  custom: m.reports_preset_custom,
} satisfies Record<RangePreset, () => string>

export interface FilterActions {
  onPreset: (preset: RangePreset) => void
  onShift: (direction: -1 | 1) => void
  // The picked first and last day, in either order.
  onDates: (from: string, to: string) => void
  onPeople: (people: { team?: string; member?: string }) => void
  onGroup: (group: Group) => void
  // A project's ID, 'none' for time without a project, or null for all projects.
  onProject: (project: string | null) => void
  onUnit: (unit: Unit) => void
}

export function ReportFilterBar(
  props: FilterActions & {
    filters: ReportFilters
    projects: Project[]
    userId: string
    weekStart: WeekStart
    today: IsoDate
  },
) {
  function last() {
    return addDays(props.filters.range.to, -1)
  }
  function people() {
    return props.filters.people
  }
  function breakdown() {
    return props.filters.view === 'breakdown'
  }

  function peopleValue() {
    if (props.filters.member) return `member:${props.filters.member}`
    if (props.filters.team) return `team:${props.filters.team}`
    return ''
  }

  function onPeople(value: string) {
    const [kind, id] = value.split(':')
    props.onPeople(kind === 'member' ? { member: id } : kind === 'team' ? { team: id } : {})
  }

  function defaultPeople() {
    const access = props.filters.access
    if (access.kind !== 'lead') return m.reports_everyone()
    return access.teams.length > 1 ? m.reports_my_teams() : access.teams[0].name
  }

  function pickDate(field: 'from' | 'to', value: string) {
    if (!value) return
    props.onDates(
      field === 'from' ? value : props.filters.range.from,
      field === 'to' ? value : last(),
    )
  }

  return (
    <section
      aria-label={m.reports_filters()}
      class="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end"
    >
      <div class="flex flex-wrap items-end gap-2">
        <div class="grid gap-1.5">
          <Label for="range-preset">{m.reports_range()}</Label>
          <NativeSelect
            id="range-preset"
            class="h-9 w-36"
            value={props.filters.preset}
            onChange={(event) => props.onPreset(event.currentTarget.value as RangePreset)}
          >
            <For each={Object.entries(PRESET_LABELS)}>
              {([value, label]) => (
                <option value={value} selected={value === props.filters.preset}>
                  {label()}
                </option>
              )}
            </For>
          </NativeSelect>
        </div>
        <div class="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            class="size-9"
            aria-label={m.reports_previous()}
            onClick={() => props.onShift(-1)}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="size-9"
            aria-label={m.reports_next()}
            onClick={() => props.onShift(1)}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
        <div class="flex items-end gap-2">
          <div class="grid gap-1.5">
            <Label for="report-from">{m.reports_from()}</Label>
            <DatePicker
              id="report-from"
              class="w-32"
              inputClass="h-9"
              value={props.filters.range.from}
              onChange={(value) => pickDate('from', value)}
              weekStart={props.weekStart}
              today={props.today}
            />
          </div>
          <div class="grid gap-1.5">
            <Label for="report-to">{m.reports_to()}</Label>
            <DatePicker
              id="report-to"
              class="w-32"
              inputClass="h-9"
              value={last()}
              onChange={(value) => pickDate('to', value)}
              weekStart={props.weekStart}
              today={props.today}
            />
          </div>
        </div>
      </div>
      <div class="flex flex-wrap items-end gap-2 lg:ml-auto">
        <Show when={people()}>
          {(options) => (
            <div class="grid gap-1.5">
              <Label for="report-people">{m.reports_people()}</Label>
              <NativeSelect
                id="report-people"
                class="h-9 w-40"
                value={peopleValue()}
                onChange={(event) => onPeople(event.currentTarget.value)}
              >
                <option value="" selected={!peopleValue()}>
                  {defaultPeople()}
                </option>
                <Show when={options().teams.length}>
                  <optgroup label={m.reports_teams()}>
                    <For each={options().teams}>
                      {(team) => (
                        <option
                          value={`team:${team.id}`}
                          selected={peopleValue() === `team:${team.id}`}
                        >
                          {team.name}
                        </option>
                      )}
                    </For>
                  </optgroup>
                </Show>
                <optgroup label={m.reports_members()}>
                  <For each={options().members}>
                    {(member) => (
                      <option
                        value={`member:${member.userId}`}
                        selected={peopleValue() === `member:${member.userId}`}
                      >
                        {member.userId === props.userId
                          ? m.reports_you({ name: member.name })
                          : member.name}
                      </option>
                    )}
                  </For>
                </optgroup>
              </NativeSelect>
            </div>
          )}
        </Show>
        <ProjectFilter
          project={props.filters.project}
          projects={props.projects}
          onProject={props.onProject}
        />
        <Show when={groupOptions(props.filters.access).length > 1}>
          <div class="grid gap-1.5">
            <Label for="report-group">{m.reports_group_by()}</Label>
            <NativeSelect
              id="report-group"
              class="h-9 w-32"
              value={props.filters.group}
              onChange={(event) => props.onGroup(event.currentTarget.value as Group)}
            >
              <For each={groupOptions(props.filters.access)}>
                {(group) => (
                  <option value={group} selected={group === props.filters.group}>
                    {GROUP_LABELS[group]()}
                  </option>
                )}
              </For>
            </NativeSelect>
          </div>
        </Show>
        <div class="grid gap-1.5">
          <span class="text-sm leading-none font-medium" id="report-unit-label">
            {m.reports_totals_per()}
          </span>
          {/* Disabled rather than hidden on Breakdown, which totals the range, so the row
              doesn't shift between views. */}
          <ToggleGroup
            variant="outline"
            class="justify-start"
            aria-labelledby="report-unit-label"
            value={props.filters.unit}
            onChange={(value) => value && props.onUnit(value as Unit)}
          >
            <ToggleGroupItem
              value="day"
              disabled={breakdown() || rangeDays(props.filters.range) > MAX_DAY_COLUMNS}
            >
              {m.reports_unit_day()}
            </ToggleGroupItem>
            <ToggleGroupItem value="week" disabled={breakdown()}>
              {m.reports_unit_week()}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </section>
  )
}

// All projects, time without one, the active projects by name, then the archived ones, whose
// time still counts.
function ProjectFilter(props: {
  project?: string
  projects: Project[]
  onProject: (project: string | null) => void
}) {
  function sorted(archived: boolean) {
    return props.projects
      .filter((p) => !!p.archivedAt === archived)
      .toSorted((a, b) => a.name.localeCompare(b.name))
  }
  function option(project: Project) {
    return (
      <option value={project.id} selected={project.id === props.project}>
        {project.name}
      </option>
    )
  }
  return (
    <div class="grid gap-1.5">
      <Label for="report-project">{m.reports_project()}</Label>
      <NativeSelect
        id="report-project"
        class="h-9 w-32"
        value={props.project ?? ''}
        onChange={(event) => props.onProject(event.currentTarget.value || null)}
      >
        <option value="" selected={!props.project}>
          {m.reports_project_all()}
        </option>
        <option value="none" selected={props.project === 'none'}>
          {m.reports_no_project()}
        </option>
        <optgroup label={m.reports_projects()}>
          <For each={sorted(false)}>{option}</For>
        </optgroup>
        <Show when={sorted(true).length}>
          <optgroup label={m.reports_archived()}>
            <For each={sorted(true)}>{option}</For>
          </optgroup>
        </Show>
      </NativeSelect>
    </div>
  )
}
