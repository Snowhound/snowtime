/// <reference types="bun" />

import { expect, test } from 'bun:test'
import { memoryStore } from './rate-limit.server'

const rule = { window: 60, max: 3 }

function clock() {
  let time = 1_000_000
  return { now: () => time, advance: (seconds: number) => (time += seconds * 1000) }
}

test('allows max requests in a window, then refuses with the seconds left', async () => {
  const c = clock()
  const store = memoryStore(c.now)
  for (let i = 0; i < 3; i++) expect((await store.consume('a', rule)).allowed).toBe(true)
  c.advance(20)
  expect(await store.consume('a', rule)).toEqual({ allowed: false, retryAfter: 40 })
})

test('a new window starts once the old one ends, and refusals do not extend it', async () => {
  const c = clock()
  const store = memoryStore(c.now)
  for (let i = 0; i < 5; i++) await store.consume('a', rule)
  c.advance(60)
  expect((await store.consume('a', rule)).allowed).toBe(true)
})

test('keys count separately', async () => {
  const store = memoryStore(clock().now)
  for (let i = 0; i < 3; i++) await store.consume('a', rule)
  expect((await store.consume('a', rule)).allowed).toBe(false)
  expect((await store.consume('b', rule)).allowed).toBe(true)
})
