// The JSON API (task 084): each domain's routes behind the checks in http.server.ts, over
// HTTP, and in process for Start's server render. The native backend serves the same API,
// and the conformance tests (conformance/) check both.
import { getRequest } from '@tanstack/solid-start/server'
import { Hono } from 'hono'
import { db } from '~/db'
import { withActor } from '~/db/actor'
import { appUrl, trustedOrigins } from '~/env'
import { type OperationName, operations } from '~/lib/api/operations'
import { hostTransport } from '~/lib/api/transports'
import { matchPath, type WireResponse } from '~/lib/api/wire'
import { signedInUser } from './auth/auth.server'
import { entryRoutes } from './entries/entries.routes'
import { known, organization, refused, refusalOf, signedIn, unavailableOr } from './http.server'
import { failure, runOperation } from './operations.server'
import type { Operation } from './schemas'
import { serverTiming, withTiming } from './timing.server'

export const api = new Hono()
  .basePath('/api/v1')
  .use(known, signedIn)
  .use('/organizations/:organizationId/*', organization)
  .route('/organizations/:organizationId', entryRoutes)
  .onError(refused)

function matchOperation(method: string, pathname: string) {
  for (const [name, operation] of Object.entries(operations)) {
    if (operation.method !== method) continue
    const params = matchPath(operation.path, pathname)
    if (params) return { name: name as OperationName, params }
  }
  return null
}

async function inputOf(request: Request, params: Record<string, string>) {
  if (request.method === 'GET') {
    return { ...Object.fromEntries(new URL(request.url).searchParams), ...params }
  }
  const text = await request.text()
  const body: unknown = text ? JSON.parse(text) : {}
  return { ...(body as object), ...params }
}

// A preview also accepts its deployment URL (src/lib/app-url.ts).
const appOrigins = new Set([new URL(appUrl).origin, ...trustedOrigins])

// A GET reads, and so does a POST marked `read`; every other call writes.
function writes(name: OperationName) {
  const operation: Operation = operations[name]
  return operation.method !== 'GET' && !operation.read
}

async function respond(
  request: Request,
  match: { name: OperationName; params: Record<string, string> },
): Promise<WireResponse> {
  // Writes come only from the app's own pages: the public URL, not the request's own,
  // since a proxy in front may change the host.
  if (writes(match.name) && !appOrigins.has(request.headers.get('origin') ?? '')) {
    return failure(403, { message: 'Cross-origin request refused.' })
  }
  let input: unknown
  try {
    input = await inputOf(request, match.params)
  } catch {
    return failure(400, { message: 'The body is not JSON.' })
  }
  return answer(request.headers, match.name, input)
}

// Runs one call for the session in `headers`, under the checks every call passes.
async function answer(headers: Headers, name: OperationName, input: unknown) {
  try {
    if (operations[name].scope === 'public') {
      return await runOperation(db, name, { userId: null, headers }, input)
    }
    const userId = await signedInUser(headers, writes(name))
    return await withActor(userId, () => runOperation(db, name, { userId, headers }, input))
  } catch (error) {
    const refusal = refusalOf(await unavailableOr(error))
    if (!refusal) throw error
    return failure(refusal.status, refusal.error)
  }
}

// Start's server render calls the API in process, for the page's own request, as the
// native backend's host does for its render isolate.
export const renderTransport = hostTransport({
  call: (name, input) => answer(getRequest().headers, name as OperationName, input),
})

export function handleApiRequest(request: Request): Promise<Response> {
  return withTiming(async () => {
    const match = matchOperation(request.method, new URL(request.url).pathname)
    let response: Response
    if (match) {
      const { status, body } = await respond(request, match)
      response = Response.json(body, { status })
    } else {
      response = await api.fetch(request)
    }
    response.headers.set('cache-control', 'no-store')
    response.headers.set('server-timing', serverTiming(['session', 'db']))
    return response
  })
}
