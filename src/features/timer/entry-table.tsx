// The Table layout's entries (prototypes/timer.html): one dense table with a subtotal row
// per day, newest first, and the entry fields (entry-fields.tsx) in the cells. It scrolls
// horizontally inside its border on narrow screens. Compact rows pad their cells less.
import { For, Show } from 'solid-js'
import { Duration } from '~/components/duration'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { DayGroup } from './entries'
import {
  DateField,
  DescriptionField,
  EntryDuration,
  NextDayMark,
  ProjectField,
  RowError,
  TimeField,
  createEntryEditor,
} from './entry-fields'
import {
  EntryActions,
  type EntryRowProps,
  dayLabel,
  groupDates,
  groupIds,
  revealWhenSaved,
  savedTint,
} from './entry-list'
import type { Entry } from './queries'

export function EntryTable(
  props: EntryRowProps & {
    groups: readonly DayGroup<Entry>[]
    now: number
  },
) {
  return (
    <div class="surface bg-card overflow-hidden rounded-lg border">
      <Table class="min-w-[48rem] table-fixed">
        <colgroup>
          <col />
          <col class="w-40" />
          <col class="w-40" />
          <col class="w-36" />
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
          <For each={groupDates(props.groups)}>
            {(date) => {
              function group() {
                return props.groups.find((g) => g.date === date)
              }
              return (
                <>
                  <TableRow class="bg-muted/50">
                    <th
                      colspan={4}
                      scope="rowgroup"
                      class="p-2 text-left align-middle text-xs font-medium"
                    >
                      {dayLabel(date, props.zone, props.now)}
                    </th>
                    <TableCell class="text-right text-xs tabular-nums">
                      <Duration ms={group()?.total ?? 0} />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  <For each={groupIds(group())}>
                    {(id) => (
                      <EntryTableRow
                        {...props}
                        entry={group()!.entries.find((e) => e.id === id)!}
                      />
                    )}
                  </For>
                </>
              )
            }}
          </For>
        </TableBody>
      </Table>
    </div>
  )
}

function EntryTableRow(props: EntryRowProps & { entry: Entry }) {
  const editor = createEntryEditor(props)
  const ref = revealWhenSaved(props)
  return (
    <>
      <TableRow
        ref={ref}
        class={cn('group', props.compact && '*:py-0.5', savedTint(props.justSaved(props.entry.id)))}
      >
        <TableCell class="max-w-0">
          <div class="-ml-2">
            <DescriptionField editor={editor} />
          </div>
        </TableCell>
        <TableCell class="max-w-0">
          <ProjectField editor={editor} entry={props.entry} projects={props.projects} />
        </TableCell>
        <TableCell>
          <div class="flex items-center gap-1">
            <DateField editor={editor} zone={props.zone} weekStart={props.weekStart} />
            <TimeField editor={editor} field="start" />
          </div>
        </TableCell>
        <TableCell>
          <div class="flex items-center gap-1">
            <TimeField editor={editor} field="end" />
            <NextDayMark editor={editor} />
          </div>
        </TableCell>
        <TableCell class="text-right tabular-nums">
          <EntryDuration editor={editor} />
        </TableCell>
        <TableCell>
          <EntryActions
            entry={props.entry}
            saved={props.justSaved(props.entry.id)}
            compact={props.compact}
            onContinue={props.onContinue}
            onDelete={props.onDelete}
          />
        </TableCell>
      </TableRow>
      <Show when={editor.error()}>
        <TableRow class="hover:bg-transparent">
          <TableCell colspan={6} class="pt-0">
            <RowError editor={editor} />
          </TableCell>
        </TableRow>
      </Show>
    </>
  )
}
