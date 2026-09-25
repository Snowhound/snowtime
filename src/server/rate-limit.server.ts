// Request counts for rate limits (docs/architecture.md, "Abuse limits"). With Upstash Redis
// configured, every function instance shares the counts; without it they live in this
// process's memory, which holds on one long-running server but not across Vercel's
// instances. Better Auth takes the same store for /api/auth/*. Pure: better-auth.server.ts
// builds the store from the environment.
import { Redis } from '@upstash/redis'

// Seconds, as Better Auth's rateLimit options take them.
export type RateLimitRule = { window: number; max: number }

// Better Auth's customStorage shape: count one request and say whether it fits, in one
// atomic step, so concurrent requests can't all pass the same stale count.
export type RateLimitStore = {
  consume(
    key: string,
    rule: RateLimitRule,
  ): Promise<{ allowed: boolean; retryAfter: number | null }>
}

// Fixed windows: the first request starts a window of rule.window seconds, and the count
// resets when it ends.
export function memoryStore(now = Date.now): RateLimitStore {
  const windows = new Map<string, { count: number; endsAt: number }>()
  return {
    async consume(key, rule) {
      const time = now()
      // Drops ended windows now and then, so keys of past users don't pile up.
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (w.endsAt <= time) windows.delete(k)
      }
      let current = windows.get(key)
      if (!current || current.endsAt <= time) {
        current = { count: 0, endsAt: time + rule.window * 1000 }
        windows.set(key, current)
      }
      current.count++
      if (current.count <= rule.max) return { allowed: true, retryAfter: null }
      return { allowed: false, retryAfter: Math.ceil((current.endsAt - time) / 1000) }
    },
  }
}

// The same fixed window in Redis. The script runs atomically there and costs one request.
const consumeScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}`

export function redisStore(redis: Redis): RateLimitStore {
  return {
    async consume(key, rule) {
      const [count, ttl] = await redis.eval<[string], [number, number]>(
        consumeScript,
        [`rate-limit:${key}`],
        [String(rule.window)],
      )
      if (count <= rule.max) return { allowed: true, retryAfter: null }
      return { allowed: false, retryAfter: Math.max(ttl, 1) }
    },
  }
}

export function createRateLimitStore(config: {
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
}): RateLimitStore {
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = config
  return url && token ? redisStore(new Redis({ url, token })) : memoryStore()
}
