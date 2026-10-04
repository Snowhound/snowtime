import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// All local worktrees use the same Docker stack and must serialize their runs.
const DIRECTORY = '/tmp/snowtime-perf-stress.lock'

export function checkOtherSessions() {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('[stress] Cannot check other benchmark sessions.')
  const processes = result.stdout.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S.*)$/)
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }] : []
  })
  const ancestors = new Set<number>()
  let pid = process.pid
  while (pid && !ancestors.has(pid)) {
    ancestors.add(pid)
    pid = processes.find((entry) => entry.pid === pid)?.parent ?? 0
  }
  const other = processes.find(
    (entry) =>
      !ancestors.has(entry.pid) &&
      /^(?:\S*\/)?(?:bun|k6|docker)\s/.test(entry.command) &&
      /perf:stress|perf\/stress\/stress\.ts|(?:^|\/)k6 run|grafana\/k6/.test(entry.command),
  )
  if (other)
    throw new Error(
      `[stress] Another benchmark session is running: pid=${other.pid} ${other.command}`,
    )
}

export function reserveStack(directory = DIRECTORY): () => void {
  try {
    mkdirSync(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    let owner = 'unknown owner'
    try {
      owner = readFileSync(join(directory, 'owner'), 'utf8').trim()
    } catch {
      // The other process may not have written its owner metadata yet.
    }
    throw new Error(
      `[stress] Another session reserved the stack: ${owner}. ` +
        `After verifying it stopped, remove ${directory} to clear a stale reservation.`,
      { cause: error },
    )
  }
  writeFileSync(join(directory, 'owner'), `pid=${process.pid} cwd=${process.cwd()}\n`)
  let released = false
  function release() {
    if (released) return
    released = true
    rmSync(directory, { recursive: true, force: true })
  }
  return release
}
