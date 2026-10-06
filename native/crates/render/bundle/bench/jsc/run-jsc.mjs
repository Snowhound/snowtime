// Runs jsc-bench.js and measures the jsc process from /proc, as bun-bench measures itself:
// CPU of all threads over the measured loop, and peak RSS over the whole run.
//
// node run-jsc.mjs <jsc> "<jsc options>" <jsc-bench.js args...>
// With RUN_JSC_SMAPS set, also copies /proc/<pid>/smaps there at the end of the loop.
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const [jsc, options, ...benchArgs] = process.argv.slice(2)
const here = new URL('.', import.meta.url).pathname
const child = spawn(
  jsc,
  [...options.split(' ').filter(Boolean), here + 'jsc-bench.js', '--', ...benchArgs],
  { stdio: ['pipe', 'pipe', 'inherit'] },
)
const ticksPerMs = 100 / 1000 // USER_HZ

function processCpuMs(pid) {
  const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')
  return (Number(fields[11]) + Number(fields[12])) / ticksPerMs // utime + stime
}
function threadsNs(pid) {
  const threads = {}
  for (const tid of readdirSync(`/proc/${pid}/task`)) {
    try {
      const name = readFileSync(`/proc/${pid}/task/${tid}/comm`, 'utf8').trim()
      const ns = Number(readFileSync(`/proc/${pid}/task/${tid}/schedstat`, 'utf8').split(' ')[0])
      threads[tid] = { name, ns, main: tid === String(pid) }
    } catch {}
  }
  return threads
}
function cgroupUs() {
  try {
    return Number(readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8').match(/^usage_usec (\d+)$/m)[1])
  } catch {
    return undefined
  }
}

let start
let end
let result
const lines = createInterface({ input: child.stdout })
lines.on('line', async (line) => {
  if (line === '@@MARK start') {
    await new Promise((r) => setTimeout(r, 1500))
    start = { cpu: processCpuMs(child.pid), threads: threadsNs(child.pid), cgroup: cgroupUs() }
    child.stdin.write('\n')
  } else if (line === '@@MARK end') {
    end = { cpu: processCpuMs(child.pid), threads: threadsNs(child.pid), cgroup: cgroupUs() }
    const status = readFileSync(`/proc/${child.pid}/status`, 'utf8')
    end.hwmKb = Number(status.match(/^VmHWM:\s+(\d+)/m)[1])
    const smaps = process.env.RUN_JSC_SMAPS
    if (smaps) writeFileSync(smaps, readFileSync(`/proc/${child.pid}/smaps`, 'utf8'))
    end.status = status.match(/^(VmHWM|VmRSS|RssAnon|RssFile|RssShmem):.*$/gm).join(' ')
    child.stdin.write('\n')
  } else if (line.startsWith('@@RESULT ')) {
    result = JSON.parse(line.slice(9))
  } else console.log(line)
})
child.on('exit', (code) => {
  if (!result || !start || !end) {
    console.error('jsc exited with', code, 'before reporting')
    process.exit(1)
  }
  const n = result.count
  const byName = {}
  let main = 0
  for (const [tid, t] of Object.entries(end.threads)) {
    const delta = (t.ns - (start.threads[tid]?.ns ?? 0)) / 1e6 / n
    if (t.main) main += delta
    else byName[t.name] = (byName[t.name] ?? 0) + delta
  }
  result.cpu_ms = (end.cpu - start.cpu) / n
  result.cgroup_cpu_ms =
    start.cgroup !== undefined ? (end.cgroup - start.cgroup) / 1000 / n : undefined
  result.main_thread_cpu_ms = main
  result.other_threads_cpu_ms = Object.fromEntries(
    Object.entries(byName)
      .filter(([, v]) => v >= 0.005)
      .map(([k, v]) => [k, Number(v.toFixed(3))]),
  )
  result.peak_rss_mb = end.hwmKb / 1024
  result.options = options
  console.log('STATUS ' + end.status.replace(/\s+/g, ' '))
  console.log(JSON.stringify(result))
})
