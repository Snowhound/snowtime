// The project picker of the timer bar and the entry dialog, and the choices it and the
// entry rows' project menu list.
import { For } from 'solid-js'
import { NativeSelect } from '~/components/ui/native-select'
import type { Project } from '~/lib/projects'
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

export function ProjectSelect(props: {
  id: string
  class?: string
  projects: readonly Pick<Project, 'id' | 'name' | 'archivedAt' | 'color'>[]
  // The project id, or '' for none.
  value: string
  disabled?: boolean
  onChange: (projectId: string) => void
}) {
  return (
    <NativeSelect
      id={props.id}
      class={props.class}
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    >
      <For each={projectChoices(props.projects, props.value)}>
        {(choice) => (
          <option value={choice.value} selected={choice.value === props.value}>
            {choice.label}
          </option>
        )}
      </For>
    </NativeSelect>
  )
}
