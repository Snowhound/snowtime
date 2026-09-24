// The summary beside the entries (prototypes/timer.html), shown when the user's
// showSummary setting is on: today and this week, and a bar per project for the week.
// The totals come from summarize, which counts a running timer up to now.
import { For, Show } from 'solid-js'
import { ProjectDot } from '~/components/project-dot'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { projectColor } from '~/lib/colors'
import { formatHours } from '~/lib/format'
import type { Project } from '~/lib/projects'
import { m } from '~/paraglide/messages.js'
import type { Summary } from './entries'
import { entryProject } from './entry-fields'

export function SummaryPanel(props: { summary: Summary; projects: readonly Project[] }) {
  return (
    <aside class="w-full lg:w-72" aria-labelledby="summary-heading">
      <Card>
        <CardHeader>
          <CardTitle id="summary-heading">{m.timer_summary()}</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <dl class="grid grid-cols-2 gap-3">
            <div>
              <dt class="text-muted-foreground text-xs">{m.timer_today()}</dt>
              <dd class="text-lg tabular-nums">{formatHours(props.summary.today)}</dd>
            </div>
            <div>
              <dt class="text-muted-foreground text-xs">{m.timer_this_week()}</dt>
              <dd class="text-lg tabular-nums">{formatHours(props.summary.week)}</dd>
            </div>
          </dl>
          <Show
            when={props.summary.projects.length > 0}
            fallback={<p class="text-muted-foreground text-sm">{m.timer_summary_empty()}</p>}
          >
            <ul class="flex flex-col gap-2.5">
              <For each={props.summary.projects}>
                {(row) => {
                  function project() {
                    return (
                      entryProject(props.projects, row.projectId) ?? {
                        name: m.timer_no_project(),
                        color: null,
                      }
                    )
                  }
                  return (
                    <li class="flex flex-col gap-1 text-xs">
                      <div class="flex items-center justify-between gap-2">
                        <span class="flex min-w-0 items-center gap-1.5">
                          <Show when={row.projectId}>
                            <ProjectDot color={project().color} />
                          </Show>
                          <span class="truncate">{project().name}</span>
                        </span>
                        <span class="text-muted-foreground tabular-nums">
                          {formatHours(row.total)}
                        </span>
                      </div>
                      <div class="bg-muted h-1.5 rounded-full" aria-hidden="true">
                        <div
                          class="h-full rounded-full"
                          style={{
                            width: `${(row.total / props.summary.week) * 100}%`,
                            background: row.projectId
                              ? projectColor(project().color)
                              : 'var(--muted-foreground)',
                          }}
                        />
                      </div>
                    </li>
                  )
                }}
              </For>
            </ul>
          </Show>
        </CardContent>
      </Card>
    </aside>
  )
}
