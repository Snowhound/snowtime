// The load benchmark's k6 scenario (perf/README.md, "Load benchmark"). Each step is a
// constant-arrival-rate scenario: actions start at the usage model's rate for that many
// active users however slowly the server answers, so queueing shows as latency and dropped
// iterations instead of slowing the load down. An action replays the requests record.ts
// recorded in the browser, as a random dataset user.
//
// perf/stress/stress.ts runs it with these environment variables:
//   RECORDING, USERS  paths of the recording and the dataset's users
//   ORIGIN            https://<host>, which HOST_IP maps to an address, if set
//   SECRET            the server's BETTER_AUTH_SECRET, to sign session cookies
//   PLAN              JSON: [{ "name": "s1", "users": 100, "seconds": 120 }, ...]; a step
//                     with "action" and "perHour" runs that action alone at that rate

import crypto from 'k6/crypto'
import { SharedArray } from 'k6/data'
import exec from 'k6/execution'
import http from 'k6/http'
import { Counter, Trend } from 'k6/metrics'

const ORIGIN = __ENV.ORIGIN
const HOST = ORIGIN.replace(/^https:\/\//, '')
const SECRET = __ENV.SECRET
const PLAN = JSON.parse(__ENV.PLAN)
const SESSION_COOKIE = '__Secure-better-auth.session_token'
const LOCALE_COOKIE = 'PARAGLIDE_LOCALE'
const PASSWORD = 'snowtime-local'

// What an active user does in the peak hour (task 078, "Usage model"). The timer action
// starts a timer, or stops the one this load generator started for the user.
const MIX = [
  ['open', 1],
  ['return', 10],
  ['timer', 3],
  ['edit', 2],
  ['reports-week', 0.2],
  ['reports-month', 0.025],
  ['reports-year', 0.025],
  ['export', 0.01],
  ['sign-in', 0.1],
]
const ACTIONS_PER_HOUR = MIX.reduce((total, [, times]) => total + times, 0)

const users = new SharedArray('users', () => JSON.parse(open(__ENV.USERS)))
const recording = JSON.parse(open(__ENV.RECORDING))

const errors = new Counter('bench_errors')
const actionDuration = new Trend('bench_action_duration', true)

// A request's kind: the action and what it asks for, as the result tables group them.
function kindOf(action, request) {
  if (request.path.startsWith('/_serverFn/')) return `${action} fn`
  if (request.path.startsWith('/api/auth/')) return `${action} auth`
  return `${action} page`
}

const KINDS = [
  ...new Set(
    Object.entries(recording.actions).flatMap(([action, requests]) =>
      requests.map((r) => kindOf(action, r)),
    ),
  ),
]

// Per step and kind, the summary has a submetric only for those with a threshold.
const thresholds = {}
for (const step of PLAN) {
  for (const kind of KINDS) {
    thresholds[`http_req_duration{step:${step.name},kind:${kind}}`] = ['max>=0']
    thresholds[`http_reqs{step:${step.name},kind:${kind}}`] = ['count>=0']
  }
  thresholds[`http_reqs{step:${step.name}}`] = ['count>=0']
  thresholds[`dropped_iterations{step:${step.name}}`] = ['count>=0']
  thresholds[`bench_action_duration{step:${step.name}}`] = ['max>=0']
  for (const type of ['5xx', '429', '4xx', 'connection', 'timeout']) {
    thresholds[`bench_errors{step:${step.name},type:${type}}`] = ['count>=0']
  }
}

let start = 0
const scenarios = {}
for (const step of PLAN) {
  const perHour = Math.max(1, Math.round(step.perHour ?? step.users * ACTIONS_PER_HOUR))
  // Enough virtual users for every action to wait 30 s at the planned rate.
  const concurrent = Math.ceil((perHour / 3600) * 30) + 10
  scenarios[step.name] = {
    executor: 'constant-arrival-rate',
    rate: perHour,
    timeUnit: '1h',
    duration: `${step.seconds}s`,
    startTime: `${start}s`,
    preAllocatedVUs: Math.min(concurrent, 50),
    maxVUs: concurrent,
    gracefulStop: '30s',
    exec: 'act',
    tags: { step: step.name },
  }
  start += step.seconds
}

export const options = {
  scenarios,
  thresholds,
  hosts: __ENV.HOST_IP ? { [HOST]: __ENV.HOST_IP } : {},
  insecureSkipTLSVerify: __ENV.INSECURE === '1',
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max', 'count'],
  discardResponseBodies: true,
  userAgent: 'snowtime-bench (k6)',
}

function pickAction() {
  let r = Math.random() * ACTIONS_PER_HOUR
  for (const [action, times] of MIX) {
    r -= times
    if (r < 0) return action
  }
  return MIX[0][0]
}

function hex(n) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

function uuidv7() {
  const time = Date.now().toString(16).padStart(12, '0')
  const variant = '89ab'[Math.floor(Math.random() * 4)]
  return `${time.slice(0, 8)}-${time.slice(8)}-7${hex(3)}-${variant}${hex(3)}-${hex(12)}`
}

// Timers this virtual user started, by user index, so a later timer action stops them.
const started = new Map()

function fill(text, user, fresh) {
  return text
    .replaceAll('{{slug}}', user.slug)
    .replaceAll('{{userId}}', user.userId)
    .replaceAll('{{organizationId}}', user.organizationId)
    .replaceAll('{{entryId}}', user.entryId)
    .replaceAll('{{projectId}}', user.projectIds[0] ?? '')
    .replaceAll('{{email}}', user.email)
    .replace(/\{\{new(\d+)\}\}/g, (_, n) => {
      if (!fresh[n]) fresh[n] = uuidv7()
      return fresh[n]
    })
}

function classify(response) {
  if (response.error_code === 1050) return 'timeout'
  if (response.status === 0) return 'connection'
  if (response.status >= 500) return '5xx'
  if (response.status === 429) return '429'
  // A redirect is how a page answers a signed-out request, which shouldn't happen here.
  if (response.status >= 300) return '4xx'
  return null
}

export function act() {
  const step = exec.scenario.name
  const index = Math.floor(Math.random() * users.length)
  const user = users[index]
  let action = PLAN.find((s) => s.name === step).action ?? pickAction()
  const fresh = {}
  if (action === 'timer') {
    const running = started.get(index)
    if (running) {
      action = 'stop'
      fresh[0] = running
      started.delete(index)
    } else {
      action = 'start'
      fresh[0] = uuidv7()
      started.set(index, fresh[0])
    }
  }
  const signedIn = action !== 'sign-in'
  const jar = new http.CookieJar()
  // Without it, a page answers a user whose language isn't English with a redirect.
  jar.set(ORIGIN, LOCALE_COOKIE, user.locale)
  if (signedIn) {
    const signature = crypto.hmac('sha256', SECRET, user.token, 'base64')
    jar.set(ORIGIN, SESSION_COOKIE, encodeURIComponent(`${user.token}.${signature}`), {
      secure: true,
    })
  }
  // A client address per user, which Caddy trusts from the load generator.
  const ip = `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`

  function params(request) {
    const kind = kindOf(action, request)
    return {
      jar,
      timeout: '30s',
      redirects: 0,
      headers: {
        ...request.headers,
        Origin: ORIGIN,
        'CF-Connecting-IP': ip,
        'X-Bench-Kind': kind,
        'X-Bench-Step': step,
      },
      tags: {
        kind,
        name: `${request.method} ${request.path.split('?')[0].replace(user.slug, '{slug}')}`,
      },
    }
  }

  function check(response, request) {
    const type = classify(response)
    if (type) errors.add(1, { type, kind: kindOf(action, request) })
  }

  // A mutation or page load goes alone; the reads that follow it go at once, as the
  // browser's refetches do.
  const requests = recording.actions[action].map((r) => ({
    ...r,
    path: fill(r.path, user, fresh),
    body: r.body && fill(r.body, user, fresh).replace('snowtime-local', PASSWORD),
  }))
  const began = Date.now()
  for (let i = 0; i < requests.length;) {
    const request = requests[i]
    if (request.method !== 'GET' || !request.path.startsWith('/_serverFn/')) {
      const response = http.request(
        request.method,
        ORIGIN + request.path,
        request.body ?? null,
        params(request),
      )
      check(response, request)
      i++
      continue
    }
    const batch = []
    while (
      i < requests.length &&
      requests[i].method === 'GET' &&
      requests[i].path.startsWith('/_serverFn/')
    ) {
      batch.push(requests[i++])
    }
    const responses = http.batch(batch.map((r) => ['GET', ORIGIN + r.path, null, params(r)]))
    responses.forEach((response, n) => check(response, batch[n]))
  }
  actionDuration.add(Date.now() - began, { action })
}

export function handleSummary(data) {
  return { '/out/summary.json': JSON.stringify(data) }
}
