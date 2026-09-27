// A row's share of the total, as Summary's and Breakdown's bars show it. Team totals can add up
// to more than the total, so a bar stops at full.
export function sharePercent(ms: number, of: number) {
  return of > 0 ? Math.round((ms / of) * 100) : 0
}

export function ShareBar(props: { ms: number; of: number; color?: string }) {
  return (
    <div class="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden="true">
      <div
        class="bg-primary h-full rounded-full"
        style={{
          width: `${props.of > 0 ? Math.min(100, (props.ms / props.of) * 100).toFixed(1) : 0}%`,
          ...(props.color ? { background: props.color } : {}),
        }}
      />
    </div>
  )
}
