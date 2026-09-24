// One tab's projects (prototypes/projects.html): color, name, teams, and time this month,
// with an actions menu for admins and owners. Rows stack below 768 px.
import ArchiveIcon from 'lucide-solid/icons/archive'
import ArchiveRestoreIcon from 'lucide-solid/icons/archive-restore'
import EllipsisIcon from 'lucide-solid/icons/ellipsis'
import FolderKanbanIcon from 'lucide-solid/icons/folder-kanban'
import GlobeIcon from 'lucide-solid/icons/globe'
import PencilIcon from 'lucide-solid/icons/pencil'
import PlusIcon from 'lucide-solid/icons/plus'
import TrashIcon from 'lucide-solid/icons/trash'
import { For, Show } from 'solid-js'
import { ProjectDot } from '~/components/project-dot'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { formatDateTime, formatHours } from '~/lib/format'
import type { Project } from '~/lib/projects'
import type { Team } from '~/lib/teams'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { byName } from './projects'

const GRID = 'md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_6.5rem_2.25rem]'
const GRID_READONLY = 'md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8rem]'

export interface ProjectActions {
  onCreate: () => void
  onEdit: (project: Project) => void
  onArchive: (project: Project) => void
  onRestore: (project: Project) => void
  onDelete: (project: Project) => void
}

export function ProjectList(
  props: ProjectActions & {
    projects: readonly Project[]
    teams: readonly Team[]
    // Milliseconds this month by project id.
    totals: ReadonlyMap<string, number>
    // Projects being deleted.
    pending: ReadonlySet<string | undefined>
    admin: boolean
    archived: boolean
    query: string
    zone: string
  },
) {
  function grid() {
    return props.admin ? GRID : GRID_READONLY
  }
  return (
    <Card class="min-w-0">
      <div
        class={cn(
          'text-muted-foreground hidden gap-x-4 border-b px-6 py-2 text-xs font-medium md:grid',
          grid(),
        )}
      >
        <span class="pl-6">{m.projects_column_project()}</span>
        <span>{m.projects_column_teams()}</span>
        <span class="text-right">
          {props.admin ? m.projects_column_month() : m.projects_column_month_own()}
        </span>
        <Show when={props.admin}>
          <span class="sr-only">{m.projects_column_actions()}</span>
        </Show>
      </div>
      <ul class="divide-y">
        <For each={props.projects} fallback={<Empty {...props} />}>
          {(project) => (
            <Row
              {...props}
              project={project}
              grid={grid()}
              pending={props.pending.has(project.id)}
            />
          )}
        </For>
      </ul>
    </Card>
  )
}

function Row(
  props: ProjectActions & {
    project: Project
    teams: readonly Team[]
    totals: ReadonlyMap<string, number>
    admin: boolean
    zone: string
    grid: string
    pending: boolean
  },
) {
  function ms() {
    return props.totals.get(props.project.id) ?? 0
  }
  function teams() {
    return props.teams.filter((t) => props.project.teamIds.includes(t.id)).sort(byName)
  }
  return (
    <li
      class={cn(
        'grid items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-6 md:gap-x-4',
        props.admin ? 'grid-cols-[minmax(0,1fr)_auto_auto]' : 'grid-cols-[minmax(0,1fr)_auto]',
        props.grid,
        props.pending && 'animate-pulse opacity-50',
      )}
      aria-busy={props.pending || undefined}
    >
      <div class="flex min-w-0 items-start gap-3">
        <ProjectDot color={props.project.color} class="mt-1 size-3" />
        <div class="min-w-0">
          <p class="line-clamp-2 text-sm font-medium break-words" title={props.project.name}>
            {props.project.name}
          </p>
          <Show when={props.project.archivedAt}>
            {(at) => (
              <p class="text-muted-foreground text-xs">
                {m.projects_archived_on({
                  date: formatDateTime(at(), props.zone, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  }),
                })}
              </p>
            )}
          </Show>
        </div>
      </div>
      <div class="col-span-full row-start-2 flex min-w-0 flex-wrap items-center gap-1.5 pl-6 md:col-span-1 md:row-start-auto md:pl-0">
        <For
          each={teams()}
          fallback={
            <span class="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
              <GlobeIcon class="size-3.5" aria-hidden="true" />
              {m.projects_whole_organization()}
            </span>
          }
        >
          {(team) => (
            <Badge variant="outline" class="max-w-full font-normal">
              <span class="truncate">{team.name}</span>
            </Badge>
          )}
        </For>
      </div>
      <div
        class={cn(
          'col-start-2 row-start-1 text-right text-sm tabular-nums md:col-start-auto md:row-start-auto',
          !ms() && 'text-muted-foreground',
        )}
      >
        <span class="sr-only">
          {props.admin ? m.projects_time_label() : m.projects_time_label_own()}{' '}
        </span>
        {ms() ? formatHours(ms()) : '–'}
      </div>
      <Show when={props.admin}>
        <div class="col-start-3 row-start-1 flex justify-end md:col-start-auto md:row-start-auto">
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger
              as={Button<'button'>}
              variant="ghost"
              size="icon"
              class="size-9"
              disabled={props.pending}
              aria-label={m.projects_actions({ name: props.project.name })}
            >
              <EllipsisIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-44">
              <DropdownMenuItem class="gap-2" onSelect={() => props.onEdit(props.project)}>
                <PencilIcon class="size-4" aria-hidden="true" />
                {m.projects_edit()}
              </DropdownMenuItem>
              <Show
                when={props.project.archivedAt}
                fallback={
                  <DropdownMenuItem class="gap-2" onSelect={() => props.onArchive(props.project)}>
                    <ArchiveIcon class="size-4" aria-hidden="true" />
                    {m.projects_archive()}
                  </DropdownMenuItem>
                }
              >
                <DropdownMenuItem class="gap-2" onSelect={() => props.onRestore(props.project)}>
                  <ArchiveRestoreIcon class="size-4" aria-hidden="true" />
                  {m.projects_restore()}
                </DropdownMenuItem>
              </Show>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="text-destructive focus:text-destructive gap-2"
                onSelect={() => props.onDelete(props.project)}
              >
                <TrashIcon class="size-4" aria-hidden="true" />
                {m.projects_delete()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Show>
    </li>
  )
}

function Empty(props: { admin: boolean; archived: boolean; query: string; onCreate: () => void }) {
  function query() {
    return props.query.trim()
  }
  return (
    <Show
      when={!query()}
      fallback={
        <li class="text-muted-foreground px-6 py-10 text-center text-sm">
          {props.archived
            ? m.projects_no_archived_match({ query: query() })
            : m.projects_no_match({ query: query() })}
        </li>
      }
    >
      <Show
        when={!props.archived}
        fallback={
          <li class="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <ArchiveIcon class="text-muted-foreground size-6" aria-hidden="true" />
            <p class="font-medium">{m.projects_empty_archived_title()}</p>
            <p class="text-muted-foreground max-w-md text-sm">
              {m.projects_empty_archived_description()}
            </p>
          </li>
        }
      >
        <li class="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <FolderKanbanIcon class="text-muted-foreground size-6" aria-hidden="true" />
          <p class="font-medium">{m.projects_empty_title()}</p>
          <Show
            when={props.admin}
            fallback={
              <p class="text-muted-foreground max-w-md text-sm">{m.projects_empty_member()}</p>
            }
          >
            <p class="text-muted-foreground max-w-md text-sm">{m.projects_empty_admin()}</p>
            <Button size="sm" class="mt-2" onClick={() => props.onCreate()}>
              <PlusIcon aria-hidden="true" />
              {m.projects_new()}
            </Button>
          </Show>
        </li>
      </Show>
    </Show>
  )
}
