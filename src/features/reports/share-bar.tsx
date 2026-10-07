// A row's share of the total, as Summary's share card and Breakdown's outline draw it: name,
// project dot, share, total, and bar. A row that narrows the Entries card does so by its total.
import { type ComponentProps, Show } from 'solid-js'
import { CopyableDuration } from '~/components/copy-duration'
import { Duration } from '~/components/duration'
import { ProjectDot } from '~/components/project-dot'
import { projectColor } from '~/lib/colors'
import { useCopyControl } from '~/lib/display-format'
import { cn } from '~/lib/utils'
import type { OutlineRow } from './breakdown/outline'
import { PickButton } from './pick-button'

export function sharePercent(ms: number, of: number) {
  return of > 0 ? Math.round((ms / of) * 100) : 0
}

type SharePick = Omit<ComponentProps<typeof PickButton>, 'children'>

// Wide enough for a total in either duration format, and for the copy button when it shows,
// so the totals line up. A total that picks a row stays a pick; a plain one copies, unless it
// is a `placeholder`, the invisible copy inside a <summary> that keeps the row's room.
export function ShareTotal(props: {
  ms: number
  pick?: SharePick
  placeholder?: boolean
  class?: string
}) {
  const copyControl = useCopyControl()
  return (
    <span
      class={cn(
        'shrink-0 text-right whitespace-nowrap tabular-nums',
        copyControl() === 'button' ? 'w-28 sm:w-32' : 'w-20 sm:w-24',
        props.class,
      )}
    >
      <Show
        when={props.pick}
        fallback={
          <Show when={!props.placeholder} fallback={<Duration ms={props.ms} />}>
            <CopyableDuration ms={props.ms} />
          </Show>
        }
      >
        {(pick) => (
          <PickButton {...pick()}>
            <Duration ms={props.ms} />
          </PickButton>
        )}
      </Show>
    </span>
  )
}

export function ShareRow(props: {
  row: OutlineRow
  of: number
  dot: boolean
  // A second-level row reads quieter.
  nested?: boolean
  pick?: SharePick
  // Inside a <summary>, where a button can't go, the caller draws ShareTotal over the row.
  totalOutside?: boolean
}) {
  // Team totals can add up to more than the total, so a bar stops at full.
  function width() {
    return props.of > 0 ? Math.min(100, (props.row.total / props.of) * 100).toFixed(1) : 0
  }
  return (
    <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-sm sm:gap-x-4">
      <span class="flex min-w-0 items-center gap-2">
        <Show when={props.dot}>
          <ProjectDot color={props.row.color ?? null} />
        </Show>
        <span
          class={cn(
            'truncate',
            props.nested ? 'text-muted-foreground' : 'font-medium',
            props.row.muted && 'text-muted-foreground',
          )}
          title={props.row.name}
        >
          {props.row.name}
        </span>
      </span>
      {/* On a phone the bar alone shows the share, so the name keeps its room. */}
      <span class="flex items-baseline gap-3">
        <span class="text-muted-foreground hidden w-10 text-right text-xs sm:block">
          {sharePercent(props.row.total, props.of)}%
        </span>
        <ShareTotal
          ms={props.row.total}
          pick={props.pick}
          placeholder={props.totalOutside}
          class={props.totalOutside ? 'invisible' : undefined}
        />
      </span>
      <div class="bg-muted col-span-2 h-1.5 overflow-hidden rounded-full" aria-hidden="true">
        <div
          class="bg-primary h-full rounded-full"
          style={{
            width: `${width()}%`,
            ...(props.dot ? { background: projectColor(props.row.color) } : {}),
          }}
        />
      </div>
    </div>
  )
}
