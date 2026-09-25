// The filter row above the timesheet (prototypes/reports.html): range preset, previous and
// next, from and to, People, Group by, and totals per day or week. Members get neither
// People nor Group by: they see their own time by project. The selects mark their option
// `selected` too, because a select's value does nothing in server-rendered HTML.
import ChevronLeftIcon from 'lucide-solid/icons/chevron-left'
import ChevronRightIcon from 'lucide-solid/icons/chevron-right'
import { For, Show } from 'solid-js'
import { DatePicker } from '~/components/date-time/date-picker'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { NativeSelect } from '~/components/ui/native-select'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { type IsoDate, type WeekStart, addDays } from '~/lib/calendar'
import { m } from '~/paraglide/messages.js'
import { type Group, type ReportFilters, type Unit, groupOptions } from './filters'
import { MAX_DAY_COLUMNS, type RangePreset, rangeDays } from './range'

const PRESET_LABELS = {
  today: m.reports_preset_today,
  'this-week': m.reports_preset_this_week,
  'last-week': m.reports_preset_last_week,
  'this-month': m.reports_preset_this_month,
  'last-month': m.reports_preset_last_month,
  custom: m.reports_preset_custom,
} satisfies Record<RangePreset, () => string>

const GROUP_LABELS = {
  project: m.reports_group_project,
  team: m.reports_group_team,
  member: m.reports_group_member,
} satisfies Record<Group, () => string>

export interface FilterActions {
  onPreset: (preset: RangePreset) => void
  onShift: (direction: -1 | 1) => void
  // The picked first and last day, in either order.
  onDates: (from: string, to: string) => void
  onPeople: (people: { team?: string; member?: string }) => void
  onGroup: (group: Group) => void
  onUnit: (unit: Unit) => void
}

export function ReportFilterBar(
  props: FilterActions & {
    filters: ReportFilters
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
              class="w-[9.5rem]"
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
              class="w-[9.5rem]"
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
                class="h-9 w-44"
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
        <Show when={groupOptions(props.filters.access).length > 1}>
          <div class="grid gap-1.5">
            <span class="text-sm leading-none font-medium" id="report-group-label">
              {m.reports_group_by()}
            </span>
            <Tabs value={props.filters.group} onChange={(value) => props.onGroup(value as Group)}>
              <TabsList aria-labelledby="report-group-label" class="h-9">
                <For each={groupOptions(props.filters.access)}>
                  {(group) => <TabsTrigger value={group}>{GROUP_LABELS[group]()}</TabsTrigger>}
                </For>
              </TabsList>
            </Tabs>
          </div>
        </Show>
        <div class="grid gap-1.5">
          <span class="text-sm leading-none font-medium" id="report-unit-label">
            {m.reports_totals_per()}
          </span>
          <ToggleGroup
            variant="outline"
            class="justify-start"
            aria-labelledby="report-unit-label"
            value={props.filters.unit}
            onChange={(value) => value && props.onUnit(value as Unit)}
          >
            <ToggleGroupItem
              value="day"
              disabled={rangeDays(props.filters.range) > MAX_DAY_COLUMNS}
            >
              {m.reports_unit_day()}
            </ToggleGroupItem>
            <ToggleGroupItem value="week">{m.reports_unit_week()}</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </section>
  )
}
