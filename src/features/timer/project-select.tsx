// The project picker of the timer bar and the entry dialog, and the color dot beside a
// project's name.
import { For, Show } from 'solid-js'
import { NativeSelect } from '~/components/ui/native-select'
import { projectColor } from '~/lib/colors'
import { m } from '~/paraglide/messages.js'
import type { Project } from './queries'

export function ProjectDot(props: { color: string | null }) {
  return (
    <span
      class="inline-block size-2 shrink-0 rounded-full"
      style={{ background: projectColor(props.color) }}
    />
  )
}

// Lists "No project" and the active projects. An entry's archived project stays listed, so
// saving other fields keeps it; one the user can no longer see shows as unavailable.
export function ProjectSelect(props: {
  id: string
  class?: string
  projects: readonly Pick<Project, 'id' | 'name' | 'archivedAt'>[]
  // The project id, or '' for none.
  value: string
  disabled?: boolean
  onChange: (projectId: string) => void
}) {
  function current() {
    return props.projects.find((p) => p.id === props.value)
  }
  function active() {
    return props.projects.filter((p) => !p.archivedAt)
  }
  return (
    <NativeSelect
      id={props.id}
      class={props.class}
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    >
      <option value="">{m.timer_no_project()}</option>
      <For each={active()}>
        {(project) => (
          <option value={project.id} selected={project.id === props.value}>
            {project.name}
          </option>
        )}
      </For>
      <Show when={current()?.archivedAt && current()}>
        {(archived) => (
          <option value={archived().id} selected>
            {m.timer_archived_project({ name: archived().name })}
          </option>
        )}
      </Show>
      <Show when={props.value && !current()}>
        <option value={props.value} selected>
          {m.timer_unavailable_project()}
        </option>
      </Show>
    </NativeSelect>
  )
}
