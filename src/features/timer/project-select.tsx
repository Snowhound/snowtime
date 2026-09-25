// The project picker of the timer bar and the entry popover, and the choices it and the
// entry rows' project menu list.
import { Show, createMemo } from 'solid-js'
import { ProjectDot } from '~/components/project-dot'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import type { Project } from '~/lib/projects'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

export interface ProjectChoice {
  // The project id, or '' for none.
  value: string
  label: string
  color: string | null
}

// "No project" and the active projects. An entry's archived project stays listed, so
// saving other fields keeps it; one the user can no longer see shows as unavailable.
export function projectChoices(
  projects: readonly Pick<Project, 'id' | 'name' | 'archivedAt' | 'color'>[],
  value: string,
): ProjectChoice[] {
  const choices: ProjectChoice[] = [{ value: '', label: m.timer_no_project(), color: null }]
  for (const p of projects) {
    if (!p.archivedAt) choices.push({ value: p.id, label: p.name, color: p.color })
  }
  const current = projects.find((p) => p.id === value)
  if (current?.archivedAt) {
    choices.push({
      value: current.id,
      label: m.timer_archived_project({ name: current.name }),
      color: current.color,
    })
  } else if (value && !current) {
    choices.push({ value, label: m.timer_unavailable_project(), color: null })
  }
  return choices
}

// Kobalte's Select rather than a native one, so the field and every option show the
// project's color dot, as the rows' project menu does. Its own label names it.
export function ProjectSelect(props: {
  id: string
  class?: string
  label: string
  labelClass?: string
  triggerClass?: string
  projects: readonly Pick<Project, 'id' | 'name' | 'archivedAt' | 'color'>[]
  // The project id, or '' for none.
  value: string
  disabled?: boolean
  onChange: (projectId: string) => void
}) {
  // Kobalte keys options by value, so "No project" gets a key of its own.
  const options = createMemo(() =>
    projectChoices(props.projects, props.value).map((choice) => ({
      ...choice,
      key: choice.value || NO_PROJECT,
    })),
  )
  function selected() {
    return options().find((o) => o.value === props.value) ?? options()[0]
  }

  return (
    <Select<ProjectOption>
      class={props.class}
      options={options()}
      optionValue="key"
      optionTextValue="label"
      value={selected()}
      onChange={(option) => option && option.value !== props.value && props.onChange(option.value)}
      disabled={props.disabled}
      disallowEmptySelection
      gutter={4}
      itemComponent={(item) => (
        <SelectItem item={item.item}>
          <ChoiceLabel choice={item.item.rawValue} />
        </SelectItem>
      )}
    >
      <SelectLabel class={props.labelClass}>{props.label}</SelectLabel>
      <SelectTrigger id={props.id} class={cn('min-w-0 gap-2 text-left', props.triggerClass)}>
        <SelectValue<ProjectOption> class="min-w-0">
          {(state) => <ChoiceLabel choice={state.selectedOption()} />}
        </SelectValue>
      </SelectTrigger>
      <SelectContent class="max-h-80 overflow-y-auto" />
    </Select>
  )
}

type ProjectOption = ProjectChoice & { key: string }

const NO_PROJECT = 'none'

function ChoiceLabel(props: { choice: ProjectChoice }) {
  return (
    <span class="flex min-w-0 items-center gap-2">
      <Show when={props.choice.value}>
        <ProjectDot color={props.choice.color} />
      </Show>
      <span class="min-w-0 truncate">{props.choice.label}</span>
    </span>
  )
}
