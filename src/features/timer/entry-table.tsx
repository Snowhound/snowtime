// The Table layout's entries (prototypes/timer.html): one dense table with a subtotal row
// per day, newest first, and the entry fields (entry-fields.tsx) in the cells. The ticket chip
// follows the text, or with the Wide page setting has a column of its own. It scrolls
// horizontally inside its border on narrow screens. Compact rows pad their cells less.
import { For, Show } from 'solid-js'
import { CopyableDuration } from '~/components/copy-duration'
import { Glass } from '~/components/scene/glass'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { useCopyControl } from '~/lib/display-format'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { DayGroup } from './entries'
import {
  DateField,
  DescriptionField,
  EntryDuration,
  InlineDescription,
  NextDayMark,
  ProjectField,
  RowError,
  TicketCell,
  TimeField,
  createEntryEditor,
} from './entry-fields'
import {
  EntryActions,
  type EntryRowProps,
  dayLabel,
  groupDates,
  groupIds,
  hasJustSaved,
  revealWhenSaved,
  savedTint,
} from './entry-list'
import { createLazyDays } from './lazy-days'
import type { StoppedEntry } from './queries'
import { createRowActivation } from './row-activation'

export function EntryTable(
  props: EntryRowProps & {
    groups: readonly DayGroup<StoppedEntry>[]
    today: string
  },
) {
  const lazyDay = createLazyDays(() => props.groups)
  const copyControl = useCopyControl()
  // Rows' heights as rendered, for a day's placeholder until it mounts (lazy-days.ts).
  function rowHeight() {
    return props.compact ? 37 : 57
  }
  function columns() {
    return props.wide ? 7 : 6
  }
  return (
    <div class="surface bg-card overflow-hidden rounded-lg border">
      <Glass />
      <Table class={cn('table-fixed', props.wide ? 'min-w-[56rem]' : 'min-w-[48rem]')}>
        <colgroup>
          <col />
          <Show when={props.wide}>
            <col class="w-32" />
          </Show>
          <col class="w-40" />
          <col class="w-40" />
          <col class="w-36" />
          {/* The duration, with room for the copy button when it shows. */}
          <col class={copyControl() === 'button' ? 'w-28' : 'w-24'} />
          <col class="w-24" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>{m.entry_description()}</TableHead>
            <Show when={props.wide}>
              <TableHead>{m.timer_ticket()}</TableHead>
            </Show>
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
              const lazy = lazyDay(date, () => hasJustSaved(props, group()))
              return (
                <>
                  <TableRow class="bg-muted/50">
                    <th
                      colspan={columns() - 2}
                      scope="rowgroup"
                      class="p-2 text-left align-middle text-xs font-medium"
                    >
                      {dayLabel(date, props.today)}
                    </th>
                    <TableCell class="text-right text-xs tabular-nums">
                      <CopyableDuration ms={group()?.total ?? 0} side="left" />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  <Show
                    when={lazy.shown()}
                    fallback={
                      <tr ref={lazy.placeholder}>
                        <td
                          colspan={columns()}
                          style={{ height: `${groupIds(group()).length * rowHeight()}px` }}
                        />
                      </tr>
                    }
                  >
                    <For each={groupIds(group())}>
                      {(id) => (
                        <EntryTableRow
                          {...props}
                          entry={group()!.entries.find((e) => e.id === id)!}
                        />
                      )}
                    </For>
                  </Show>
                </>
              )
            }}
          </For>
        </TableBody>
      </Table>
    </div>
  )
}

function EntryTableRow(props: EntryRowProps & { entry: StoppedEntry }) {
  const editor = createEntryEditor(props)
  const activation = createRowActivation()
  const ref = revealWhenSaved(props)
  return (
    <>
      <TableRow
        ref={(el: HTMLTableRowElement) => {
          ref(el)
          activation.ref(el)
        }}
        class={cn('group', props.compact && '*:py-0.5', savedTint(props.justSaved(props.entry.id)))}
      >
        <TableCell class="max-w-0">
          <div class="-ml-2">
            <Show
              when={props.wide}
              fallback={
                <InlineDescription
                  editor={editor}
                  entry={props.entry}
                  issueLinks={props.issueLinks}
                />
              }
            >
              <DescriptionField editor={editor} />
            </Show>
          </div>
        </TableCell>
        <Show when={props.wide}>
          <TableCell class="max-w-0">
            <div class="flex">
              <TicketCell
                editor={editor}
                entry={props.entry}
                issueLinks={props.issueLinks}
                tickets={props.tickets}
                active={activation.active()}
              />
            </div>
          </TableCell>
        </Show>
        <TableCell class="max-w-0">
          <ProjectField
            editor={editor}
            entry={props.entry}
            projects={props.projects}
            active={activation.active()}
          />
        </TableCell>
        <TableCell>
          <div class="flex items-center gap-1">
            <DateField
              editor={editor}
              zone={props.zone}
              weekStart={props.weekStart}
              active={activation.active()}
            />
            <TimeField editor={editor} field="start" active={activation.active()} />
          </div>
        </TableCell>
        <TableCell>
          <div class="flex items-center gap-1">
            <TimeField editor={editor} field="end" active={activation.active()} />
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
            active={activation.active()}
            onContinue={props.onContinue}
            onDelete={props.onDelete}
          />
        </TableCell>
      </TableRow>
      <Show when={editor.error()}>
        <TableRow class="hover:bg-transparent">
          <TableCell colspan={props.wide ? 7 : 6} class="pt-0">
            <RowError editor={editor} />
          </TableCell>
        </TableRow>
      </Show>
    </>
  )
}
