// The Projects view (prototypes/projects.html): Active and Archived tabs with a name search,
// sorted by name. Admins and owners see every project with the organization's time this
// month and manage them; members and team leads see the projects open to them, with their
// own time, and no actions. Writes are optimistic (queries.ts); errors show above the list.
import { useMutationState, useQuery } from '@tanstack/solid-query'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import PlusIcon from 'lucide-solid/icons/plus'
import SearchIcon from 'lucide-solid/icons/search'
import { For, Show, createMemo, createSignal } from 'solid-js'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { TextField, TextFieldInput, TextFieldLabel } from '~/components/ui/text-field'
import { errorMessage } from '~/lib/errors'
import { type Project, projectsQuery } from '~/lib/projects'
import { m } from '~/paraglide/messages.js'
import { AppError } from '~/server/errors'
import { type Confirmation, ConfirmDialog } from './confirm-dialog'
import { ProjectDialog, type ProjectDialogTarget } from './project-dialog'
import { type ProjectActions, ProjectList } from './project-list'
import { byName } from './projects'
import {
  type SaveProjectInput,
  deleteProjectKey,
  monthReportQuery,
  teamsQuery,
  useArchiveProject,
  useDeleteProject,
  useSaveProject,
  useUnarchiveProject,
} from './queries'

type Tab = 'active' | 'archived'
const TABS = [
  { value: 'active', label: m.projects_tab_active },
  { value: 'archived', label: m.projects_tab_archived },
] as const

export function ProjectsView(props: {
  organizationId: string
  organizationName: string
  userId: string
  admin: boolean
  zone: string
}) {
  const projects = useQuery(() => projectsQuery(props.organizationId))
  const teams = useQuery(() => teamsQuery(props.organizationId))
  const report = useQuery(() =>
    monthReportQuery(props.organizationId, props.zone, props.admin ? null : props.userId),
  )

  const saveProject = useSaveProject()
  const archiveProject = useArchiveProject()
  const unarchiveProject = useUnarchiveProject()
  const deleteProject = useDeleteProject()

  // Projects whose delete awaits the server.
  const deleting = useMutationState(() => ({
    filters: { mutationKey: deleteProjectKey, status: 'pending' },
    select: (mutation) => (mutation.state.variables as { id: string } | undefined)?.id,
  }))
  const pending = createMemo(() => new Set(deleting()))

  const [tab, setTab] = createSignal<Tab>('active')
  const [query, setQuery] = createSignal('')
  const [dialog, setDialog] = createSignal<ProjectDialogTarget | null>(null)
  const [confirmation, setConfirmation] = createSignal<Confirmation | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  const totals = createMemo(
    () =>
      new Map(
        (report.data?.projects ?? []).flatMap((row) =>
          row.projectId ? [[row.projectId, row.total] as const] : [],
        ),
      ),
  )
  const sorted = createMemo(() => [...(projects.data ?? [])].sort(byName))
  function inTab(t: Tab) {
    return sorted().filter((p) => Boolean(p.archivedAt) === (t === 'archived'))
  }
  function shown(t: Tab) {
    const q = query().trim().toLowerCase()
    return inTab(t).filter((p) => !q || p.name.toLowerCase().includes(q))
  }

  function showError(e: unknown) {
    setError(errorMessage(e))
  }
  const options = { onError: showError }

  function save(input: SaveProjectInput) {
    setDialog(null)
    setError(null)
    if (input.kind === 'create') setTab('active')
    saveProject.mutate(input, options)
  }

  function archive(project: Project) {
    setError(null)
    archiveProject.mutate({ id: project.id }, options)
  }

  function restore(project: Project) {
    setError(null)
    unarchiveProject.mutate({ id: project.id }, options)
  }

  // A project with time can't be deleted; it is offered for archiving instead, or only
  // explained when it is archived already.
  function hasTime(project: Project) {
    setConfirmation({
      title: m.projects_has_time_title({ name: project.name }),
      description: project.archivedAt
        ? m.projects_has_time_archived()
        : m.projects_has_time_description(),
      action: project.archivedAt
        ? undefined
        : { label: m.projects_archive_instead(), run: () => archive(project) },
    })
  }

  function remove(project: Project) {
    setError(null)
    deleteProject.mutate(
      { id: project.id },
      {
        onError: (e) =>
          e instanceof AppError && e.key === 'project_has_entries'
            ? hasTime(project)
            : showError(e),
      },
    )
  }

  const actions: ProjectActions = {
    onCreate: () => setDialog({ kind: 'new' }),
    onEdit: (project) => setDialog({ kind: 'edit', project }),
    onArchive: (project) =>
      setConfirmation({
        title: m.projects_archive_title({ name: project.name }),
        description: m.projects_archive_description(),
        action: { label: m.projects_archive(), run: () => archive(project) },
      }),
    onRestore: restore,
    onDelete: (project) =>
      setConfirmation({
        title: m.projects_delete_title({ name: project.name }),
        description: m.projects_delete_description(),
        action: {
          label: m.projects_delete_confirm(),
          destructive: true,
          run: () => remove(project),
        },
      }),
  }

  function subtitle() {
    const organization = props.organizationName
    if (!props.admin) return m.projects_subtitle_member({ organization })
    return m.projects_subtitle_admin({
      organization,
      active: inTab('active').length,
      archived: inTab('archived').length,
    })
  }

  return (
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div class="flex min-w-0 flex-col gap-1">
        <h1 class="text-2xl font-semibold tracking-tight">{m.nav_projects()}</h1>
        <p class="text-muted-foreground min-w-0 truncate text-sm">{subtitle()}</p>
      </div>
      <Show when={error()}>
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>{error()}</AlertDescription>
        </Alert>
      </Show>
      <Tabs value={tab()} onChange={(value) => setTab(value as Tab)} class="grid gap-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <TabsList aria-label={m.projects_status()}>
              <For each={TABS}>
                {(t) => (
                  <TabsTrigger value={t.value}>
                    {t.label()}
                    <Show when={inTab(t.value).length}>
                      {(count) => (
                        <span class="text-muted-foreground ml-1.5 text-xs">{count()}</span>
                      )}
                    </Show>
                  </TabsTrigger>
                )}
              </For>
            </TabsList>
          </div>
          <div class="flex min-w-0 gap-2">
            <TextField
              class="relative min-w-0 flex-1 sm:w-64 sm:flex-none"
              value={query()}
              onChange={setQuery}
            >
              <TextFieldLabel class="sr-only">{m.projects_search()}</TextFieldLabel>
              <SearchIcon
                class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <TextFieldInput
                type="search"
                class="h-9 pl-9"
                placeholder={m.projects_search()}
                autocomplete="off"
              />
            </TextField>
            <Show when={props.admin}>
              <Button size="sm" class="h-9 shrink-0" onClick={() => actions.onCreate()}>
                <PlusIcon aria-hidden="true" />
                {m.projects_new()}
              </Button>
            </Show>
          </div>
        </div>
        <For each={TABS}>
          {(t) => (
            <TabsContent value={t.value} class="mt-0">
              <Show when={projects.data}>
                <ProjectList
                  {...actions}
                  projects={shown(t.value)}
                  teams={teams.data ?? []}
                  totals={totals()}
                  pending={pending()}
                  admin={props.admin}
                  archived={t.value === 'archived'}
                  query={query()}
                  zone={props.zone}
                />
              </Show>
            </TabsContent>
          )}
        </For>
      </Tabs>
      <p class="text-muted-foreground text-sm">
        {props.admin ? m.projects_footnote_admin() : m.projects_footnote_member()}
      </p>
      <Show when={props.admin}>
        <ProjectDialog
          target={dialog()}
          projects={projects.data ?? []}
          teams={teams.data ?? []}
          onSave={save}
          onClose={() => setDialog(null)}
        />
        <ConfirmDialog confirmation={confirmation()} onClose={() => setConfirmation(null)} />
      </Show>
    </div>
  )
}
