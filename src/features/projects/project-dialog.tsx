// The create and edit dialog (prototypes/projects.html): the name, a color swatch, and the
// teams that may track time on the project. Names are unique among projects that aren't
// deleted, archived ones included (project_organization_id_name_unique), so a clash with
// an archived project suggests restoring it.
import { createForm } from '@tanstack/solid-form'
import { Link } from '@tanstack/solid-router'
import CheckIcon from 'lucide-solid/icons/check'
import { For, Show, createMemo } from 'solid-js'
import * as v from 'valibot'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'
import {
  TextField,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from '~/components/ui/text-field'
import { PROJECT_COLORS, leastUsedColor } from '~/lib/colors'
import { fieldError } from '~/lib/form'
import type { Project } from '~/lib/projects'
import { newId } from '~/lib/query'
import type { Team } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { ProjectName } from '~/server/projects/projects.schemas'
import { byName, teamChanges } from './projects'
import type { SaveProjectInput } from './queries'

export type ProjectDialogTarget = { kind: 'new' } | { kind: 'edit'; project: Project }

// In PROJECT_COLORS order.
const COLOR_NAMES = [
  m.projects_color_blue,
  m.projects_color_terracotta,
  m.projects_color_teal,
  m.projects_color_ochre,
  m.projects_color_rose,
  m.projects_color_moss,
  m.projects_color_indigo,
  m.projects_color_brick,
]

export function ProjectDialog(props: {
  target: ProjectDialogTarget | null
  projects: readonly Project[]
  teams: readonly Team[]
  onSave: (input: SaveProjectInput) => void
  onClose: () => void
}) {
  // The last target stays while the dialog animates closed.
  const shown = createMemo<ProjectDialogTarget | null>((last) => props.target ?? last, null)
  return (
    <Dialog open={props.target !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent class="grid-cols-[minmax(0,1fr)]">
        <Show when={shown()} keyed>
          {(target) => (
            <ProjectForm
              target={target}
              projects={props.projects}
              teams={props.teams}
              onSave={props.onSave}
              onClose={props.onClose}
            />
          )}
        </Show>
      </DialogContent>
    </Dialog>
  )
}

function ProjectForm(props: {
  target: ProjectDialogTarget
  projects: readonly Project[]
  teams: readonly Team[]
  onSave: (input: SaveProjectInput) => void
  onClose: () => void
}) {
  // oxlint-disable-next-line solid/reactivity -- the form starts from the target it opened with.
  const project = props.target.kind === 'edit' ? props.target.project : null

  // Unused name: the trimmed name, or the message to show.
  function nameError(value: string): string | undefined {
    const result = v.safeParse(ProjectName, value)
    if (!result.success) return result.issues[0].message
    const name = result.output
    const clash = props.projects.find((p) => p.id !== project?.id && p.name === name)
    if (!clash) return undefined
    return clash.archivedAt
      ? m.projects_name_taken_archived({ name })
      : m.projects_name_taken({ name })
  }

  const form = createForm(() => ({
    defaultValues: {
      name: project?.name ?? '',
      color:
        project?.color ??
        leastUsedColor(props.projects.filter((p) => !p.archivedAt).map((p) => p.color)),
      teamIds: project?.teamIds ?? ([] as string[]),
    },
    onSubmitInvalid: () => queueMicrotask(() => document.getElementById('project-name')?.focus()),
    onSubmit: ({ value }) => {
      const name = value.name.trim()
      if (!project) {
        props.onSave({
          kind: 'create',
          id: newId(),
          name,
          color: value.color,
          teamIds: value.teamIds,
        })
        return
      }
      props.onSave({
        kind: 'update',
        id: project.id,
        name: name === project.name ? undefined : name,
        color: value.color === project.color ? undefined : value.color,
        ...teamChanges(project.teamIds, value.teamIds),
      })
    },
  }))
  const teamIds = form.useStore((state) => state.values.teamIds)

  function sortedTeams() {
    return [...props.teams].sort(byName)
  }

  function hint() {
    const checked = sortedTeams().filter((t) => teamIds().includes(t.id))
    if (checked.length === 0) return m.projects_teams_hint_none()
    const teams = new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(
      checked.map((t) => t.name),
    )
    return m.projects_teams_hint_some({ teams })
  }

  function description() {
    if (!project) return m.projects_dialog_new_description()
    return project.archivedAt
      ? m.projects_dialog_archived_description()
      : m.projects_dialog_edit_description()
  }

  return (
    <form
      class="grid min-w-0 gap-5"
      novalidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{project ? m.projects_dialog_edit() : m.projects_dialog_new()}</DialogTitle>
        <DialogDescription>{description()}</DialogDescription>
      </DialogHeader>
      <form.Field name="name" validators={{ onSubmit: ({ value }) => nameError(value) }}>
        {(field) => (
          <TextField
            class="grid gap-2"
            value={field().state.value}
            onChange={field().handleChange}
            validationState={fieldError(field().state.meta.errors) ? 'invalid' : 'valid'}
          >
            <TextFieldLabel>{m.projects_name()}</TextFieldLabel>
            <TextFieldInput
              id="project-name"
              autocomplete="off"
              maxLength={100}
              onBlur={field().handleBlur}
            />
            <TextFieldErrorMessage>{fieldError(field().state.meta.errors)}</TextFieldErrorMessage>
          </TextField>
        )}
      </form.Field>
      <form.Field name="color">
        {(field) => (
          <fieldset class="grid gap-2">
            <legend class="mb-2 text-sm leading-none font-medium">{m.projects_color()}</legend>
            <div class="flex flex-wrap gap-2">
              <For each={PROJECT_COLORS}>
                {(color, i) => (
                  <label class="relative cursor-pointer">
                    <input
                      type="radio"
                      name="color"
                      value={color}
                      class="peer sr-only"
                      checked={field().state.value === color}
                      onChange={() => field().handleChange(color)}
                    />
                    <span
                      class="ring-offset-background peer-checked:ring-foreground peer-focus-visible:ring-ring block size-8 rounded-full peer-checked:ring-2 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2"
                      style={{ background: `var(--series-${i() + 1})` }}
                      aria-hidden="true"
                    />
                    <CheckIcon
                      class="pointer-events-none absolute top-2 left-2 hidden size-4 text-white peer-checked:block"
                      aria-hidden="true"
                    />
                    <span class="sr-only">{COLOR_NAMES[i()]()}</span>
                  </label>
                )}
              </For>
            </div>
          </fieldset>
        )}
      </form.Field>
      <form.Field name="teamIds">
        {(field) => (
          <fieldset class="grid min-w-0 gap-2">
            <legend class="mb-2 text-sm leading-none font-medium">{m.projects_teams()}</legend>
            <div class="grid max-h-56 min-w-0 gap-1 overflow-y-auto rounded-md border p-1">
              <For
                each={sortedTeams()}
                fallback={
                  <p class="text-muted-foreground px-2 py-2 text-sm">
                    {m.projects_no_teams()}{' '}
                    <Link to="/organization" class="underline underline-offset-4">
                      {m.projects_create_teams()}
                    </Link>
                  </p>
                }
              >
                {(team) => {
                  const id = `project-team-${team.id}`
                  return (
                    <div class="hover:bg-accent flex min-w-0 items-center gap-3 rounded-sm px-2 py-2">
                      <Checkbox
                        id={id}
                        checked={field().state.value.includes(team.id)}
                        onChange={(checked: boolean) =>
                          field().handleChange((ids) =>
                            checked ? [...ids, team.id] : ids.filter((t) => t !== team.id),
                          )
                        }
                      />
                      <Label
                        for={`${id}-input`}
                        class="min-w-0 flex-1 cursor-pointer truncate font-normal"
                      >
                        {team.name}
                      </Label>
                      <span class="text-muted-foreground shrink-0 text-xs">
                        {m.projects_team_members({ count: team.members.length })}
                      </span>
                    </div>
                  )
                }}
              </For>
            </div>
            <Show when={props.teams.length > 0}>
              <p class="text-muted-foreground text-xs" aria-live="polite">
                {hint()}
              </p>
            </Show>
          </fieldset>
        )}
      </form.Field>
      <DialogFooter class="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={() => props.onClose()}>
          {m.projects_cancel()}
        </Button>
        <Button type="submit">{project ? m.projects_save() : m.projects_create()}</Button>
      </DialogFooter>
    </form>
  )
}
