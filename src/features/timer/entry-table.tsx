// The Table layout's entries (prototypes/timer.html): one dense table with a subtotal row
// per day, newest first. It scrolls horizontally inside its border on narrow screens.
import { For, Show } from 'solid-js'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { formatClock, formatHours, formatTime } from '~/lib/format'
import { m } from '~/paraglide/messages.js'
import type { DayGroup } from './entries'
import {
  EntryActions,
  EntryDescription,
  EntryTimeButton,
  dayLabel,
  entryProject,
} from './entry-list'
import { ProjectDot } from './project-select'
import type { Entry, Project } from './queries'

export function EntryTable(props: {
  groups: readonly DayGroup<Entry>[]
  projects: readonly Project[]
  zone: string
  now: number
  onEdit: (entry: Entry) => void
  onContinue: (entry: Entry) => void
  onDelete: (entry: Entry) => void
}) {
  return (
    <div class="bg-card overflow-hidden rounded-lg border">
      <Table class="min-w-[40rem] table-fixed">
        <colgroup>
          <col />
          <col class="w-44" />
          <col class="w-20" />
          <col class="w-20" />
          <col class="w-24" />
          <col class="w-24" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>{m.entry_description()}</TableHead>
            <TableHead>{m.timer_project()}</TableHead>
            <TableHead>{m.entry_start()}</TableHead>
            <TableHead>{m.entry_end()}</TableHead>
            <TableHead class="text-right">{m.timer_duration()}</TableHead>
            <TableHead>
              <span class="sr-only">{m.timer_actions()}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <For each={props.groups}>
            {(group) => (
              <>
                <TableRow class="bg-muted/50">
                  <th
                    colspan={4}
                    scope="rowgroup"
                    class="p-2 text-left align-middle text-xs font-medium"
                  >
                    {dayLabel(group.date, props.zone, props.now)}
                  </th>
                  <TableCell class="text-right font-mono text-xs tabular-nums">
                    {formatHours(group.total)}
                  </TableCell>
                  <TableCell />
                </TableRow>
                <For each={group.entries}>
                  {(entry) => (
                    <TableRow class="group">
                      <TableCell class="max-w-0">
                        <div class="truncate">
                          <EntryDescription entry={entry} />
                        </div>
                      </TableCell>
                      <TableCell class="max-w-0">
                        <div class="text-muted-foreground flex items-center gap-1.5">
                          <Show
                            when={entryProject(props.projects, entry.projectId)}
                            fallback={<span class="truncate">—</span>}
                          >
                            {(p) => (
                              <>
                                <ProjectDot color={p().color} />
                                <span class="truncate">{p().name}</span>
                              </>
                            )}
                          </Show>
                        </div>
                      </TableCell>
                      <TableCell>
                        <EntryTimeButton entry={entry} onEdit={props.onEdit}>
                          {formatTime(entry.startedAt, props.zone)}
                        </EntryTimeButton>
                      </TableCell>
                      <TableCell>
                        <EntryTimeButton entry={entry} onEdit={props.onEdit}>
                          {formatTime(entry.stoppedAt!, props.zone)}
                        </EntryTimeButton>
                      </TableCell>
                      <TableCell class="text-right font-mono tabular-nums">
                        {formatClock(entry.stoppedAt!.getTime() - entry.startedAt.getTime())}
                      </TableCell>
                      <TableCell>
                        <EntryActions
                          entry={entry}
                          onEdit={props.onEdit}
                          onContinue={props.onContinue}
                          onDelete={props.onDelete}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </For>
              </>
            )}
          </For>
        </TableBody>
      </Table>
    </div>
  )
}
