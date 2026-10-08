type Counters = Record<string, { values: Record<string, number> }>

export function droppedActions(metrics: Counters, step: string): number {
  return Math.max(
    metrics[`dropped_iterations{step:${step}}`]?.values.count ?? 0,
    metrics[`dropped_iterations{scenario:${step}}`]?.values.count ?? 0,
    metrics.dropped_iterations?.values.count ?? 0,
  )
}
