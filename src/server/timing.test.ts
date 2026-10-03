/// <reference types="bun" />

import type { Client } from '@libsql/client'
import { describe, expect, test } from 'bun:test'
import { serverTiming, time, timedClient, withTiming } from './timing.server'

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function durations(header: string) {
  return Object.fromEntries(
    header.split(', ').map((entry) => {
      const [name, duration] = entry.split(';dur=')
      return [name, Number(duration)]
    }),
  )
}

describe('time', () => {
  test('runs untimed outside withTiming', async () => {
    expect(await time('db', async () => 42)).toBe(42)
    expect(() => serverTiming(['db'])).toThrow()
  })

  test('counts calls open at the same time once', async () => {
    const header = await withTiming(async () => {
      await Promise.all([time('db', () => wait(30)), time('db', () => wait(30))])
      await time('db', () => wait(30))
      return serverTiming(['session', 'db'])
    })
    const { session, db } = durations(header)
    expect(session).toBe(0)
    expect(db).toBeGreaterThanOrEqual(55)
    expect(db).toBeLessThan(85)
  })

  test('keeps concurrent requests apart', async () => {
    const [slow, fast] = await Promise.all([
      withTiming(async () => {
        await time('db', () => wait(40))
        return durations(serverTiming(['db'])).db
      }),
      withTiming(async () => {
        await time('db', () => wait(5))
        return durations(serverTiming(['db'])).db
      }),
    ])
    expect(slow).toBeGreaterThanOrEqual(35)
    expect(fast).toBeLessThan(30)
  })

  test('counts a failed call', async () => {
    const header = await withTiming(async () => {
      await time('db', () => wait(20).then(() => Promise.reject(new Error('no')))).catch(() => {})
      return serverTiming(['db'])
    })
    expect(durations(header).db).toBeGreaterThanOrEqual(15)
  })

  test('formats durations only', async () => {
    const header = await withTiming(async () => serverTiming(['session', 'db', 'render']))
    expect(header).toBe('session;dur=0.0, db;dur=0.0, render;dur=0.0')
  })
})

describe('timedClient', () => {
  function statement() {
    return wait(20).then(() => ({ rows: [] }))
  }
  const fake = {
    closed: false,
    execute: statement,
    batch: statement,
    transaction: async () => ({ execute: statement, commit: () => wait(20) }),
  } as unknown as Client

  test('times statements, batches, and transaction steps as db', async () => {
    const client = timedClient(fake)
    const header = await withTiming(async () => {
      await client.execute('select 1')
      await client.batch(['select 1'])
      const transaction = await client.transaction('write')
      await transaction.execute('select 1')
      await transaction.commit()
      return serverTiming(['db'])
    })
    expect(durations(header).db).toBeGreaterThanOrEqual(75)
    expect(client.closed).toBe(false)
  })
})
