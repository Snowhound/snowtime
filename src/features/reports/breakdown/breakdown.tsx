// The Breakdown view (prototypes/reports.html, Breakdown): who worked on what, as a two-level
// outline with share bars and the first three groups open. It totals the whole range. A
// top-level total narrows the Entries card to its row; the second level doesn't narrow, since
// the card filters by one grouping.
import ChevronRightIcon from 'lucide-solid/icons/chevron-right'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import { For, Show } from 'solid-js'
import { Duration } from '~/components/duration'
import { ProjectDot } from '~/components/project-dot'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { projectColor } from '~/lib/colors'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { ReportPart } from '../buckets'
import { EmptyState } from '../empty-state'
import type { Group } from '../filters'
import { PickButton, PickHint } from '../pick-button'
import { ShareBar, sharePercent } from '../share-bar'
import type { OutlineGroup, OutlineRow } from './outline'

const TITLES = {
  project: m.reports_breakdown_project,
  ticket: m.reports_breakdown_ticket,
  team: m.reports_breakdown_team,
  member: m.reports_breakdown_member,
} satisfies Record<Group, () => string>

const ONE_LEVEL_TITLES = {
  project: m.reports_share_project,
  ticket: m.reports_share_ticket,
  team: m.reports_share_team,
  member: m.reports_share_member,
} satisfies Record<Group, () => string>

// Groups open when the outline first shows.
const OPEN_GROUPS = 3

// Wide enough for a total in either duration format, so the totals line up.
const TOTAL = 'w-20 shrink-0 text-right whitespace-nowrap tabular-nums sm:w-24'

// One row of the outline: its name, share of `of`, total, and bar.
function Line(line: { row: OutlineRow; of: number; level: 0 | 1; dot: boolean }) {
  return (
    <div
      class={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 sm:gap-x-4',
        line.level && 'text-sm',
      )}
    >
      <span class="flex min-w-0 items-center gap-2">
        <Show when={line.dot}>
          <ProjectDot color={line.row.color ?? null} />
        </Show>
        <span
          class={cn(
            'truncate',
            line.level ? 'text-muted-foreground' : 'font-medium',
            line.row.muted && 'text-muted-foreground',
          )}
          title={line.row.name}
        >
          {line.row.name}
        </span>
      </span>
      {/* On a phone the bar alone shows the share, so the name keeps its room. */}
      <span class="flex items-baseline gap-3">
        <span class="text-muted-foreground hidden w-10 text-right text-xs sm:block">
          {sharePercent(line.row.total, line.of)}%
        </span>
        {/* A top-level total is a button over the row, outside its <summary>; its place
            here stays empty. */}
        <span class={TOTAL}>{line.level ? <Duration ms={line.row.total} /> : null}</span>
      </span>
      <div class="col-span-2">
        <ShareBar
          ms={line.row.total}
          of={line.of}
          color={line.dot ? projectColor(line.row.color) : undefined}
        />
      </div>
    </div>
  )
}

export function Breakdown(props: {
  total: number
  // Undefined while the second level loads.
  groups: OutlineGroup[] | undefined
  group: Group
  // Whether the rows have a second level.
  nested: boolean
  picked: ReportPart
  onPick: (part: ReportPart) => void
}) {
  // The second level's rows are members, or projects when grouping by member.
  function childDots() {
    return props.group === 'member'
  }

  function Total(total: { row: OutlineGroup }) {
    return (
      <span class={cn('absolute top-3 right-4', TOTAL)}>
        <PickButton
          pressed={props.picked.row === total.row.key && !props.picked.bucket}
          hint="breakdown-pick-hint"
          onClick={() => props.onPick({ row: total.row.key })}
        >
          <Duration ms={total.row.total} />
        </PickButton>
      </span>
    )
  }

  return (
    <Card class="min-w-0">
      <CardHeader class="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0">
        <div class="grid min-w-0 gap-1.5">
          <CardTitle class="text-base">
            {(props.nested ? TITLES : ONE_LEVEL_TITLES)[props.group]()}
          </CardTitle>
          <Show when={props.group === 'team'}>
            <CardDescription>{m.reports_team_note()}</CardDescription>
          </Show>
        </div>
        <p class="text-2xl tabular-nums">
          <Duration ms={props.total} />
        </p>
      </CardHeader>
      <Show when={props.total > 0} fallback={<EmptyState />}>
        <CardContent>
          <Show
            when={props.groups}
            fallback={
              <p
                role="status"
                class="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm"
              >
                <LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
                {m.reports_breakdown_loading()}
              </p>
            }
          >
            {(groups) => (
              <>
                <PickHint id="breakdown-pick-hint" />
                <ul class="divide-y rounded-md border">
                  <For each={groups()}>
                    {(row, i) => (
                      <li class="relative">
                        <Show
                          when={row.children.length}
                          fallback={
                            <div class="px-4 py-3">
                              <Line
                                row={row}
                                of={props.total}
                                level={0}
                                dot={props.group === 'project'}
                              />
                            </div>
                          }
                        >
                          <details open={i() < OPEN_GROUPS} class="group">
                            <summary class="hover:bg-muted/50 focus-visible:ring-ring flex cursor-pointer list-none items-start gap-2 px-4 py-3 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                              <ChevronRightIcon
                                class="text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90"
                                aria-hidden="true"
                              />
                              <div class="min-w-0 flex-1">
                                <Line
                                  row={row}
                                  of={props.total}
                                  level={0}
                                  dot={props.group === 'project'}
                                />
                              </div>
                            </summary>
                            <ul class="grid gap-3 pr-4 pb-4 pl-10">
                              <For each={row.children}>
                                {(child) => (
                                  <li>
                                    <Line row={child} of={row.total} level={1} dot={childDots()} />
                                  </li>
                                )}
                              </For>
                            </ul>
                          </details>
                        </Show>
                        <Total row={row} />
                      </li>
                    )}
                  </For>
                </ul>
              </>
            )}
          </Show>
        </CardContent>
      </Show>
    </Card>
  )
}
