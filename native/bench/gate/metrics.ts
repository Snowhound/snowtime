export function compareMetric(baseline: number[], current: number[], cpu: boolean) {
  if (
    baseline.length !== 2 ||
    current.length !== 2 ||
    [...baseline, ...current].some((n) => !Number.isFinite(n) || n < 0)
  )
    throw new Error('Each gate metric needs two finite, nonnegative observations')
  const a = (baseline[0] + baseline[1]) / 2
  const b = (current[0] + current[1]) / 2
  if (cpu && a === 0) throw new Error('CPU is below /proc resolution; increase API repeats')
  const band = Math.max(Math.abs(baseline[0] - baseline[1]), cpu ? a * 0.05 : 0)
  return {
    baseline: a,
    current: b,
    delta: b - a,
    deltaPercent: a ? (b / a - 1) * 100 : null,
    band,
    flagged: b - a > band + Number.EPSILON * Math.max(1, a),
  }
}
