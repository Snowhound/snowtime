// The Focus layout's "Continue recent" chips (prototypes/timer.html): the newest distinct
// work (recentWork), each starting a timer with its description and project.
import PlayIcon from 'lucide-solid/icons/play'
import { For, Show } from 'solid-js'
import { ProjectDot } from '~/components/project-dot'
import { Button } from '~/components/ui/button'
import type { Project } from '~/lib/projects'
import { m } from '~/paraglide/messages.js'
import { entryProject } from './entry-fields'
import type { Entry } from './queries'

export function RecentWork(props: {
  entries: readonly Entry[]
  projects: readonly Project[]
  onContinue: (entry: Entry) => void
}) {
  return (
    <section aria-labelledby="recent-heading">
      <h2 id="recent-heading" class="text-muted-foreground mb-2 text-sm font-medium">
        {m.timer_recent()}
      </h2>
      <div class="flex flex-wrap gap-2">
        <For
          each={props.entries}
          fallback={<p class="text-muted-foreground text-sm">{m.timer_recent_empty()}</p>}
        >
          {(entry) => (
            <Button
              variant="outline"
              size="sm"
              class="max-w-full"
              aria-label={m.timer_continue({ description: entry.description })}
              onClick={() => props.onContinue(entry)}
            >
              <PlayIcon class="size-3" aria-hidden="true" />
              <Show when={entryProject(props.projects, entry.projectId)}>
                {(p) => <ProjectDot color={p().color} />}
              </Show>
              <span class="min-w-0 truncate">{entry.description}</span>
            </Button>
          )}
        </For>
      </div>
    </section>
  )
}
