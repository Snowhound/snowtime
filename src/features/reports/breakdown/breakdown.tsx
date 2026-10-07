// The Breakdown view (prototypes/reports.html, Breakdown): who worked on what, as a two-level
// outline with share bars and the first three groups open. It totals the whole range. A
// top-level total narrows the Entries card to its row; the second level doesn't narrow, since
// the card filters by one grouping.
import ChevronRightIcon from 'lucide-solid/icons/chevron-right'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import { For, Show } from 'solid-js'
import { CopyableDuration } from '~/components/copy-duration'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { m } from '~/paraglide/messages.js'
import type { ReportPart } from '../buckets'
import { EmptyState } from '../empty-state'
import { type Group, SHARE_TITLES } from '../filters'
import { PickHint } from '../pick-button'
import { ShareRow, ShareTotal } from '../share-bar'
import type { OutlineGroup } from './outline'

const TITLES = {
  project: m.reports_breakdown_project,
  ticket: m.reports_breakdown_ticket,
  team: m.reports_breakdown_team,
  member: m.reports_breakdown_member,
} satisfies Record<Group, () => string>

// Groups open when the outline first shows.
const OPEN_GROUPS = 3

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

  function pick(row: OutlineGroup) {
    return {
      pressed: props.picked.row === row.key && !props.picked.bucket,
      hint: 'breakdown-pick-hint',
      onClick: () => props.onPick({ row: row.key }),
    }
  }

  return (
    <Card class="min-w-0">
      <CardHeader class="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0">
        <div class="grid min-w-0 gap-1.5">
          <CardTitle class="text-base">
            {(props.nested ? TITLES : SHARE_TITLES)[props.group]()}
          </CardTitle>
          <Show when={props.group === 'team'}>
            <CardDescription>{m.reports_team_note()}</CardDescription>
          </Show>
        </div>
        <p class="text-2xl tabular-nums">
          <CopyableDuration ms={props.total} side="left" />
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
                              <ShareRow
                                row={row}
                                of={props.total}
                                dot={props.group === 'project'}
                                pick={pick(row)}
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
                                <ShareRow
                                  row={row}
                                  of={props.total}
                                  dot={props.group === 'project'}
                                  totalOutside
                                />
                              </div>
                            </summary>
                            <ul class="grid gap-3 pr-4 pb-4 pl-10">
                              <For each={row.children}>
                                {(child) => (
                                  <li>
                                    <ShareRow row={child} of={row.total} dot={childDots()} nested />
                                  </li>
                                )}
                              </For>
                            </ul>
                          </details>
                          <ShareTotal
                            ms={row.total}
                            pick={pick(row)}
                            class="absolute top-3 right-4"
                          />
                        </Show>
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
