// Records what each action of the usage model sends, in Chrome against the server under test,
// so the load generator replays the requests of this build: server functions are addressed by
// a hash from the build, and Start encodes their bodies itself (perf/README.md, "Load
// benchmark"). The recording user's IDs become placeholders that each virtual user fills in.
//
// Static files are left out: the browser and Cloudflare cache them.

import { chromium, type BrowserContext, type Page, type Request } from 'playwright-core'
import { addDays } from '~/lib/calendar'
import type { BenchUser } from './dataset'
import { SESSION_COOKIE, sessionCookie } from './session'

const ACTIONS = [
  'open',
  'edit',
  'return',
  'start',
  'stop',
  'reports-week',
  'reports-month',
  'export',
  'reports-year',
  'sign-in',
] as const
type Action = (typeof ACTIONS)[number]

interface RecordedRequest {
  method: string
  // Path and query, with placeholders such as {{slug}}.
  path: string
  headers: Record<string, string>
  body?: string
}

export interface Recording {
  recordedAt: string
  origin: string
  actions: Record<Action, RecordedRequest[]>
}

const STATIC = /^\/(?:assets|backgrounds|brand|fonts)\/|\.(?:png|svg|ico|webmanifest|woff2?)$/
// Start's CSRF check reads Sec-Fetch-Site first. Behind Caddy the app sees its own URL as
// http, so Origin alone never matches it.
const KEPT_HEADERS = ['accept', 'content-type', 'x-tsr-serverfn', 'sec-fetch-site']
const UUID = /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/g
const SEED_PASSWORD = 'snowtime-local'

// The recording user's values, as the placeholders replace them. IDs that aren't the user's
// are new ones the client made, such as a started timer's; each gets a fresh ID per replay.
// In an edit, the one unknown ID is the edited entry's, which becomes the user's.
function template(
  text: string,
  user: BenchUser,
  fresh: Map<string, string>,
  edited: boolean,
): string {
  const known = new Map<string, string>([
    [user.userId, '{{userId}}'],
    [user.organizationId, '{{organizationId}}'],
    [user.entryId, '{{entryId}}'],
    ...user.projectIds.map((id) => [id, '{{projectId}}'] as [string, string]),
  ])
  return text
    .replace(UUID, (id) => {
      const placeholder = known.get(id)
      if (placeholder) return placeholder
      if (!fresh.has(id)) fresh.set(id, edited ? '{{entryId}}' : `{{new${fresh.size}}}`)
      return fresh.get(id)!
    })
    .replaceAll(`/${user.slug}/`, '/{{slug}}/')
    .replaceAll(encodeURIComponent(user.email), '{{email}}')
    .replaceAll(user.email, '{{email}}')
}

class Recorder {
  current: Action | undefined
  requests: Partial<Record<Action, Promise<RecordedRequest>[]>> = {}
  pending = 0
  fresh = new Map<string, string>()

  constructor(
    readonly origin: string,
    readonly user: BenchUser,
  ) {}

  watch(context: BrowserContext) {
    context.on('request', (request) => {
      const url = new URL(request.url())
      if (url.origin !== this.origin || STATIC.test(url.pathname)) return
      this.pending++
      void request.response().finally(() => this.pending--)
      if (this.current) (this.requests[this.current] ??= []).push(this.read(request, url))
    })
  }

  async read(request: Request, url: URL): Promise<RecordedRequest> {
    const all = await request.allHeaders()
    const headers = Object.fromEntries(
      KEPT_HEADERS.filter((name) => all[name]).map((name) => [name, all[name]]),
    )
    const body = request.postData() ?? undefined
    return {
      method: request.method(),
      path: template(url.pathname + url.search, this.user, this.fresh, this.current === 'edit'),
      headers,
      ...(body !== undefined && {
        body: template(body, this.user, this.fresh, this.current === 'edit'),
      }),
    }
  }

  // Waits until the page has been quiet for a second.
  async settle() {
    for (let quiet = 0; quiet < 1000; quiet = this.pending === 0 ? quiet + 100 : 0) {
      await Bun.sleep(100)
    }
  }

  // Runs the action and records every request until the page has been quiet for a second.
  async record(action: Action, run: () => Promise<unknown>) {
    this.current = action
    this.fresh = action === 'stop' ? this.fresh : new Map()
    await run()
    await this.settle()
    this.current = undefined
    const requests = await Promise.all(this.requests[action] ?? [])
    if (requests.length === 0) throw new Error(`[stress] Recording ${action} sent no requests`)
    console.log(
      `[stress] ${action}: ${requests.map((r) => `${r.method} ${r.path.slice(0, 60)}`).join(', ')}`,
    )
  }
}

async function returnToTab(page: Page) {
  await page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- it runs in the page, which can't see this module.
    function set(hidden: boolean) {
      Object.defineProperty(document, 'visibilityState', {
        value: hidden ? 'hidden' : 'visible',
        configurable: true,
      })
      Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
      window.dispatchEvent(new Event('visibilitychange'))
      document.dispatchEvent(new Event('visibilitychange'))
    }
    set(true)
    set(false)
    window.dispatchEvent(new Event('focus'))
  })
}

// Records every action as the user. `resolve` maps the origin's host to another address and
// port (host:port), for a server that its name doesn't reach.
export async function record({
  origin,
  user,
  secret,
  resolve,
  ignoreHTTPSErrors = false,
}: {
  origin: string
  user: BenchUser
  secret: string
  resolve?: string
  ignoreHTTPSErrors?: boolean
}): Promise<Recording> {
  const { hostname } = new URL(origin)
  const browser = await chromium.launch({
    channel: 'chrome',
    args: resolve ? [`--host-resolver-rules=MAP ${hostname} ${resolve}`] : [],
  })
  const recorder = new Recorder(origin, user)
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors,
      viewport: { width: 1440, height: 900 },
    })
    await context.addInitScript(() => {
      localStorage.setItem('snowtime.introSeen', '1')
      localStorage.setItem('snowtime.passkeyPromptDismissed', '1')
    })
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: sessionCookie(user.token, secret),
        domain: hostname,
        path: '/',
        secure: true,
        httpOnly: true,
      },
    ])
    recorder.watch(context)
    const page = await context.newPage()
    const timer = `${origin}/${user.slug}/timer`
    // The first visit fills the browser's cache, as a returning user's is.
    await page.goto(timer, { waitUntil: 'networkidle' })

    await recorder.record('open', () => page.goto(timer, { waitUntil: 'networkidle' }))
    await recorder.record('edit', async () => {
      const description = page.locator('main').getByRole('textbox', { name: 'Description' }).first()
      await description.click()
      await description.fill(`Benchmark edit ${Date.now()}`)
      await description.press('Enter')
    })
    // Queries go stale after 30 seconds and refetch when the tab shows again.
    await page.waitForTimeout(31_000)
    await recorder.record('return', () => returnToTab(page))
    const bar = page.getByRole('region', { name: 'Timer' })
    const running = bar.getByRole('button', { name: 'Stop', exact: true })
    if (await running.isVisible()) {
      await running.click()
      await recorder.settle()
    }
    await recorder.record('start', () =>
      bar.getByRole('button', { name: 'Start', exact: true }).click(),
    )
    await page.waitForTimeout(1000)
    await recorder.record('stop', () =>
      bar.getByRole('button', { name: 'Stop', exact: true }).click(),
    )
    await recorder.record('reports-week', () =>
      page.getByRole('link', { name: 'Reports' }).first().click(),
    )
    await recorder.record('reports-month', () =>
      page.goto(`${origin}/${user.slug}/reports?range=last-month`, { waitUntil: 'networkidle' }),
    )
    await recorder.record('export', async () => {
      await page.getByRole('button', { name: 'Export' }).click()
      const download = page.waitForEvent('download', { timeout: 120_000 })
      await page.getByRole('menuitem', { name: /Excel/ }).click()
      await download
    })
    const today = new Date().toISOString().slice(0, 10)
    const from = `${addDays(today, -365).slice(0, 8)}01`
    await recorder.record('reports-year', () =>
      page.goto(`${origin}/${user.slug}/reports?range=custom&from=${from}&to=${today}`, {
        waitUntil: 'networkidle',
      }),
    )

    const signedOut = await browser.newContext({ ignoreHTTPSErrors })
    recorder.watch(signedOut)
    const signIn = await signedOut.newPage()
    await recorder.record('sign-in', async () => {
      await signIn.goto(`${origin}/sign-in`, { waitUntil: 'networkidle' })
      const email = signIn.getByRole('textbox', { name: 'Email' })
      const password = signIn.getByRole('textbox', { name: 'Password' })
      // Hydration empties fields filled before it.
      while ((await email.inputValue()) !== user.email) {
        await email.fill(user.email)
        await password.fill(SEED_PASSWORD)
        await signIn.waitForTimeout(500)
      }
      await signIn.getByRole('button', { name: 'Sign in', exact: true }).click()
      await signIn.waitForURL(/\/timer/, { timeout: 30_000 })
    })

    const actions = {} as Record<Action, RecordedRequest[]>
    for (const action of ACTIONS) actions[action] = await Promise.all(recorder.requests[action]!)
    return { recordedAt: new Date().toISOString(), origin, actions }
  } finally {
    await browser.close()
  }
}
