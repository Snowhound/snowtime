// The server process's CPU time and memory, and percentiles of timings, for the harnesses
// that load a running server (load.ts, api.ts).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

// CPU seconds the process has used, user plus system. Linux's ps prints whole seconds, so it
// reads /proc there.
export function cpuSeconds(pid: number): number {
  const stat = `/proc/${pid}/stat`
  if (existsSync(stat)) {
    // The fields after the command name, which may contain spaces; utime and stime are the
    // 14th and 15th fields, in clock ticks of 1/100 s.
    const fields = readFileSync(stat, 'utf8').split(') ')[1].split(' ')
    return (Number(fields[11]) + Number(fields[12])) / 100
  }
  const time = execFileSync('ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8' }).trim()
  return time.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

// Resident memory in MB. Linux keeps the peak (VmHWM); elsewhere the run samples it.
export function rssMb(pid: number): { now: number; peak?: number } {
  const status = `/proc/${pid}/status`
  if (existsSync(status)) {
    const text = readFileSync(status, 'utf8')
    function mb(field: string) {
      return Number(new RegExp(`${field}:\\s+(\\d+)`).exec(text)?.[1] ?? 0) / 1024
    }
    return { now: mb('VmRSS'), peak: mb('VmHWM') }
  }
  const kb = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()
  return { now: Number(kb) / 1024 }
}

export function percentile(values: number[], p: number): number {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}
