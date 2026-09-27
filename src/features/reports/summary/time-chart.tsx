// Summary's chart (prototypes/reports.html, Summary): time per day or week in columns stacked
// by project, drawn to its container's width. A column lists its projects in a tooltip on
// hover and focus, and narrows the Entries card to its day or week.
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { IsoDate } from '~/lib/calendar'
import { useFormatHours } from '~/lib/display-format'
import { m } from '~/paraglide/messages.js'
import { bucketLabel, shortBucketLabel } from '../buckets'
import type { Unit } from '../filters'
import { type Series, chartScale } from './chart-series'

const HEIGHT = 220
const LEFT = 40
const RIGHT = 4
const TOP = 8
const BOTTOM = 22
// Narrower containers scroll the chart rather than squeeze it.
const MIN_WIDTH = 280
// Gap between stacked segments, and the top segment's corner radius.
const GAP = 2
const RADIUS = 4
// Room each x-axis label needs; labels in between are skipped.
const LABEL_WIDTH = 44

// A column segment with its top corners rounded by r.
function segmentPath(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

// The column under the pointer.
function bandOf(target: EventTarget | null) {
  const band = (target as Element | null)?.closest<SVGElement>('[data-band]')
  return band ? Number(band.dataset.band) : undefined
}

export function TimeChart(props: {
  series: Series[]
  buckets: IsoDate[]
  // Each bucket's total, the height of its column.
  totals: number[]
  unit: Unit
  // Today's day or week, whose label stands out.
  current: IsoDate
  // The day or week the Entries card lists, when it lists no row.
  picked?: IsoDate
  onPick: (bucket: IsoDate) => void
}) {
  const formatHours = useFormatHours()
  const [width, setWidth] = createSignal(0)
  const [tip, setTip] = createSignal<{ index: number; x: number; y: number }>()
  let container!: HTMLDivElement
  let tooltip: HTMLDivElement | undefined

  onMount(() => {
    setWidth(container.clientWidth)
    const observer = new ResizeObserver(() => setWidth(container.clientWidth))
    observer.observe(container)
    onCleanup(() => observer.disconnect())
  })

  const layout = createMemo(() => {
    const w = Math.max(MIN_WIDTH, width())
    const plotW = w - LEFT - RIGHT
    const plotH = HEIGHT - TOP - BOTTOM
    const scale = chartScale(Math.max(0, ...props.totals))
    const band = plotW / props.buckets.length
    return {
      w,
      plotH,
      scale,
      band,
      bar: Math.max(3, Math.min(24, band * 0.62)),
      every: Math.ceil(props.buckets.length / Math.max(1, Math.floor(plotW / LABEL_WIDTH))),
    }
  })

  function y(ms: number) {
    const { plotH, scale } = layout()
    return TOP + plotH - (ms / scale.max) * plotH
  }

  // The column's segments, bottom up.
  function segments(i: number) {
    const { band, bar } = layout()
    const x = LEFT + i * band + (band - bar) / 2
    const stack = props.series.filter((s) => s.perBucket[i] > 0)
    let below = 0
    return stack.flatMap((s, j) => {
      const y0 = y(below)
      below += s.perBucket[i]
      const y1 = y(below)
      const h = y0 - y1 - (j > 0 ? GAP : 0)
      if (h <= 0) return []
      const r = j === stack.length - 1 ? Math.min(RADIUS, bar / 2, h) : 0
      return [{ d: segmentPath(x, y1, bar, h, r), color: s.color }]
    })
  }

  function show(index: number, x: number, y: number) {
    setTip({ index, x, y })
    if (!tooltip) return
    const r = tooltip.getBoundingClientRect()
    tooltip.style.left = `${Math.max(8, Math.min(x + 12, innerWidth - r.width - 8))}px`
    tooltip.style.top = `${Math.max(8, y - r.height - 12)}px`
  }

  function tipRows() {
    const t = tip()
    if (!t) return []
    return props.series.filter((s) => s.perBucket[t.index] > 0).toReversed()
  }

  return (
    <div
      ref={container}
      class="overflow-x-auto"
      style={{ height: `${HEIGHT}px` }}
      onPointerMove={(event) => {
        const i = bandOf(event.target)
        if (i === undefined) setTip()
        else show(i, event.clientX, event.clientY)
      }}
      onPointerLeave={() => setTip()}
    >
      <Show when={width()}>
        <svg
          width={layout().w}
          height={HEIGHT}
          viewBox={`0 0 ${layout().w} ${HEIGHT}`}
          role="group"
          aria-label={
            props.unit === 'week' ? m.reports_chart_label_week() : m.reports_chart_label_day()
          }
          class="block overflow-visible"
        >
          <For each={layout().scale.ticks}>
            {(tick) => (
              <>
                <line class="stroke-border" x1={LEFT} x2={layout().w} y1={y(tick)} y2={y(tick)} />
                <text
                  x={LEFT - 8}
                  y={y(tick)}
                  dy="0.32em"
                  text-anchor="end"
                  class="fill-muted-foreground text-[10px] tabular-nums"
                  aria-hidden="true"
                >
                  {formatHours(tick)}
                </text>
              </>
            )}
          </For>
          <For each={props.buckets}>
            {(bucket, i) => (
              <>
                <g
                  role="button"
                  tabindex="0"
                  data-band={i()}
                  aria-pressed={props.picked === bucket}
                  aria-label={m.reports_chart_band({
                    bucket: bucketLabel(bucket, props.unit),
                    duration: formatHours(props.totals[i()]),
                  })}
                  class="group cursor-pointer outline-none"
                  onClick={() => props.onPick(bucket)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    props.onPick(bucket)
                  }}
                  onFocus={(event) => {
                    const r = event.currentTarget.getBoundingClientRect()
                    show(i(), r.left + r.width / 2, r.top + 40)
                  }}
                  onBlur={() => setTip()}
                >
                  <rect
                    class="group-aria-pressed:fill-primary/15 group-focus-visible:stroke-ring group-focus-visible:fill-muted group-hover:fill-muted/60 fill-transparent stroke-transparent stroke-2"
                    x={LEFT + i() * layout().band}
                    y={TOP}
                    width={layout().band}
                    height={layout().plotH}
                    rx="4"
                  />
                  <For each={segments(i())}>
                    {(segment) => <path d={segment.d} style={{ fill: segment.color }} />}
                  </For>
                </g>
                <Show when={i() % layout().every === 0}>
                  <text
                    x={LEFT + i() * layout().band + layout().band / 2}
                    y={HEIGHT - 6}
                    text-anchor="middle"
                    class={
                      bucket === props.current
                        ? 'fill-foreground text-[10px] font-medium'
                        : 'fill-muted-foreground text-[10px]'
                    }
                    aria-hidden="true"
                  >
                    {shortBucketLabel(bucket, props.unit, props.buckets.length)}
                  </text>
                </Show>
              </>
            )}
          </For>
          <line class="stroke-muted-foreground/40" x1={LEFT} x2={layout().w} y1={y(0)} y2={y(0)} />
        </svg>
      </Show>
      {/* In a portal: a glass card's backdrop filter would make it the tooltip's frame. */}
      <Portal>
        <div
          ref={tooltip}
          role="tooltip"
          class="bg-popover text-popover-foreground pointer-events-none fixed z-50 max-w-72 min-w-44 rounded-md border px-3 py-2 text-xs shadow-md"
          classList={{ hidden: !tip() }}
        >
          <Show when={tip()}>
            {(t) => (
              <>
                <p class="mb-1.5 font-medium">
                  {bucketLabel(props.buckets[t().index], props.unit)} ·{' '}
                  <span class="tabular-nums">{formatHours(props.totals[t().index])}</span>
                </p>
                <Show
                  when={tipRows().length}
                  fallback={<p class="text-muted-foreground">{m.reports_chart_no_time()}</p>}
                >
                  <ul class="grid gap-1">
                    <For each={tipRows()}>
                      {(s) => (
                        <li class="flex min-w-0 items-center gap-2">
                          <span class="min-w-10 shrink-0 font-medium tabular-nums">
                            {formatHours(s.perBucket[t().index])}
                          </span>
                          <SeriesDot color={s.color} />
                          <span class="text-muted-foreground min-w-0 truncate">{s.name}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </>
            )}
          </Show>
        </div>
      </Portal>
    </div>
  )
}

// A series' dot: ProjectDot takes a stored project color, and "Other" has none.
export function SeriesDot(props: { color: string }) {
  return (
    <span
      class="inline-block size-2 shrink-0 rounded-full"
      style={{ background: props.color }}
      aria-hidden="true"
    />
  )
}
