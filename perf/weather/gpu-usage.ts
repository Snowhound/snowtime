// The GPU's utilization over time on macOS, from the IOAccelerator's "Device Utilization %", which
// needs no root. It counts every process's work on the GPU, so it's for comparing variants in one
// run, not for absolute numbers. Elsewhere it reads NaN.
import { execFile } from 'node:child_process'

const PERIOD = 100

export function gpuUsage() {
  const samples: [number, number][] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  function sample() {
    const at = performance.now()
    execFile('ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator'], (error, output) => {
      const match = /"Device Utilization %"=(\d+)/.exec(output)
      if (!error && match) samples.push([at, Number(match[1])])
      if (!stopped) timer = setTimeout(sample, Math.max(0, PERIOD - (performance.now() - at)))
    })
  }
  if (process.platform === 'darwin') sample()
  return {
    // The mean of the samples taken between two performance.now() times.
    mean(from: number, to: number) {
      const inside = samples.filter(([at]) => at >= from && at <= to).map(([, value]) => value)
      return inside.length ? inside.reduce((a, b) => a + b, 0) / inside.length : NaN
    },
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}
