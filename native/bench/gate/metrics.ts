export function compareMetric(baseline: number[], current: number[], metric: string) {
  if (
    baseline.length !== 2 ||
    current.length !== 2 ||
    [...baseline, ...current].some((n) => !Number.isFinite(n) || n < 0)
  )
    throw new Error('Each gate metric needs two finite, nonnegative observations')
  const a = (baseline[0] + baseline[1]) / 2
  const b = (current[0] + current[1]) / 2
  if (metric.endsWith('/cpu_ms') && a === 0)
    throw new Error('CPU is below /proc resolution; increase API repeats')
  const rss = metric.endsWith('/peak_rss_mb') || metric.endsWith('/peak_rss_mib')
  const floor = Math.max(a * (metric.endsWith('/p95_ms') ? 0.1 : 0.05), rss ? 4 : 0)
  const band = Math.max(Math.abs(baseline[0] - baseline[1]), floor)
  return {
    baseline: a,
    current: b,
    delta: b - a,
    deltaPercent: a ? (b / a - 1) * 100 : null,
    band,
    flagged: b - a > band + Number.EPSILON * Math.max(1, a),
  }
}
