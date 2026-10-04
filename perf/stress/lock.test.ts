import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reserveStack } from './lock'

test('a second worktree cannot acquire or clear the active reservation', () => {
  const parent = mkdtempSync(join(tmpdir(), 'stress-lock-test-'))
  const directory = join(parent, 'lock')
  try {
    const release = reserveStack(directory)
    const owner = readFileSync(join(directory, 'owner'), 'utf8')
    expect(() => reserveStack(directory)).toThrow('Another session reserved the stack')
    expect(readFileSync(join(directory, 'owner'), 'utf8')).toBe(owner)
    release()
    const releaseNext = reserveStack(directory)
    release()
    expect(() => reserveStack(directory)).toThrow('Another session reserved the stack')
    releaseNext()
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})
