import { closeSync, openSync, readFileSync, readSync, writeFileSync, writeSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ApiAnswer, ApiInput, PageInput } from './contract'

const polyfills = process.argv.includes('--polyfills')
if (polyfills) await import('./bench/polyfills')
const args = process.argv.slice(2).filter((arg) => arg !== '--polyfills')
const pagePath = args[0]
const answersPath = args[1]
if (!pagePath || !answersPath)
  throw new Error('bun-bench <page.json> <answers.json> [count] [output.html]')
const count = Number(args[2] ?? 500)
if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer')
const page: PageInput = JSON.parse(readFileSync(pagePath, 'utf8'))
const answers: Record<string, ApiAnswer> = JSON.parse(readFileSync(answersPath, 'utf8'))
for (const answer of Object.values(answers)) answer.body = new Uint8Array(answer.body)
let status = 0
let chunks: Uint8Array[] = []
const decoder = new TextDecoder()
globalThis.Deno = {
  core: {
    ops: {
      async op_send(input: ApiInput) {
        const key =
          input.method + ' ' + input.path + ' ' + decoder.decode(new Uint8Array(input.body))
        const answer = answers[key]
        if (!answer) throw new Error('Unrecorded API request: ' + key)
        return { ...answer, body: new Uint8Array(answer.body) }
      },
      op_head(value) {
        status = value
      },
      op_chunk(chunk) {
        chunks.push(chunk)
      },
    },
  },
}
globalThis.renderManifest = JSON.parse(
  readFileSync(resolve(import.meta.dir, 'dist/manifest.json'), 'utf8'),
)
const started = performance.now()
const variant = process.env.RENDER_PROPS ?? 'plain'
if (!['plain', 'prototype', 'shared'].includes(variant))
  throw new Error('RENDER_PROPS must be plain, prototype, or shared')
await import(
  process.env.BUN_RENDER_BUNDLE ??
    resolve(import.meta.dir, variant === 'plain' ? 'dist/render.js' : `dist/render.${variant}.js`)
)

async function render() {
  status = 0
  chunks = []
  await globalThis.renderPage(page)
  if (status !== 200) throw new Error('Rendered status ' + status)
  return Buffer.concat(chunks)
}
const first = await render()
if (!first.includes('data-hk=') || first.includes("This page didn't load"))
  throw new Error('Rendered an error page')
if (args[3]) writeFileSync(args[3], first)
const startup = performance.now() - started
for (let i = 0; i < 50; i++) await render()
await Bun.sleep(1500)
const profiler = process.env.BUN_RENDER_PROFILE ? await import('bun:jsc') : undefined
const cpu = process.cpuUsage()
let loopCpu: NodeJS.CpuUsage
let loopElapsed = 0
const times: number[] = []
function perfControl(command: string) {
  const path = process.env.RENDER_PERF_CONTROL
  if (!path) return
  const control = openSync(path, 'w')
  writeSync(control, command + '\n')
  closeSync(control)
  if (process.env.RENDER_PERF_ACK) {
    const ack = openSync(process.env.RENDER_PERF_ACK, 'r')
    const buffer = Buffer.alloc(32)
    readSync(ack, buffer)
    closeSync(ack)
    if (!buffer.toString().startsWith('ack')) throw new Error('Missing perf acknowledgement')
  }
}
function cgroupCpuUs() {
  try {
    const value = readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8').match(/^usage_usec (\d+)$/m)
    return value ? Number(value[1]) : undefined
  } catch {
    return undefined
  }
}
let cgroupCpuMs: number | undefined
async function measuredRenders() {
  perfControl('enable')
  const cgroupStart = cgroupCpuUs()
  const startCpu = process.cpuUsage()
  const measured = performance.now()
  for (let i = 0; i < count; i++) {
    const begin = performance.now()
    await render()
    times.push(performance.now() - begin)
  }
  loopElapsed = performance.now() - measured
  loopCpu = process.cpuUsage(startCpu)
  const cgroupEnd = cgroupCpuUs()
  cgroupCpuMs =
    cgroupStart !== undefined && cgroupEnd !== undefined
      ? (cgroupEnd - cgroupStart) / 1000 / count
      : undefined
  perfControl('disable')
}
const profile = profiler ? await profiler.profile(measuredRenders, 1000) : await measuredRenders()
const elapsed = loopElapsed
const used = process.cpuUsage(cpu)
const serializeCpu = process.cpuUsage()
if (profile) writeFileSync(process.env.BUN_RENDER_PROFILE!, JSON.stringify(profile))
const serialization = process.cpuUsage(serializeCpu)
times.sort((a, b) => a - b)
console.log(
  JSON.stringify({
    engine: polyfills ? 'bun-polyfills' : 'bun-native',
    page: pagePath,
    count,
    bytes: first.byteLength,
    startup_ms: startup,
    pages_per_s: (count * 1000) / elapsed,
    p50_ms: times[Math.floor(count / 2)],
    p95_ms: times[Math.floor((count * 95) / 100)],
    cgroup_cpu_ms: cgroupCpuMs,
    cpu_ms: (loopCpu!.user + loopCpu!.system) / 1000 / count,
    profile_total_cpu_ms: (used.user + used.system) / 1000,
    profile_serialization_cpu_ms: (serialization.user + serialization.system) / 1000,
    profile_outside_loop_cpu_ms: (used.user + used.system - loopCpu!.user - loopCpu!.system) / 1000,
    peak_rss_mb: process.resourceUsage().maxRSS / 1024,
  }),
)
