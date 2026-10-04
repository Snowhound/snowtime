// The JSON API (task 084): the contract's calls over HTTP, and in process for Start's server
// render, running the rules through operations.server.ts. Clients outside the browser call
// it with a personal API key (docs/api.md). The native backend serves the
// same API, and the conformance tests (conformance/) check both.
import { getRequest } from '@tanstack/solid-start/server'
import { db } from '~/db'
import { withActor } from '~/db/actor'
import { appUrl, trustedOrigins } from '~/env'
import { type OperationName, operations } from '~/lib/api/operations'
import { hostTransport } from '~/lib/api/transports'
import { matchPath, type WireResponse } from '~/lib/api/wire'
import { ApiKeyRefusal, bearerKey } from './auth/api-keys.server'
import { AppError } from './errors'
import { keyUser, signedInUser, unavailableOr } from './guards.server'
import { failure, refusal, runOperation } from './operations.server'
import type { Operation } from './schemas'
import { serverTiming, withTiming } from './timing.server'

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

async function respond(request: Request): Promise<WireResponse> {
  const match = matchOperation(request.method, new URL(request.url).pathname)
  if (!match) return failure(404, { message: 'No such call.' })
  // Writes with the session cookie come only from the app's own pages: the public URL, not
  // the request's own, since a proxy in front may change the host. Another site can't set
  // a key's header, so a key's writes need no Origin.
  if (
    writes(match.name) &&
    !bearerKey(request.headers) &&
    !appOrigins.has(request.headers.get('origin') ?? '')
  ) {
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

// Runs one call for the API key or the session in `headers`, under the checks every call
// passes. A key alone signs its request in: the cookie is dropped, so a session can't widen
// what the key may do.
async function answer(headers: Headers, name: OperationName, input: unknown) {
  const operation: Operation = operations[name]
  const key = bearerKey(headers)
  try {
    if (key) {
      if (!operation.apiKeys) throw new ApiKeyRefusal('api_key_not_allowed')
      const userId = await keyUser(key, writes(name))
      const keyHeaders = new Headers(headers)
      keyHeaders.delete('cookie')
      return await withActor(userId, () =>
        runOperation(db, name, { userId, headers: keyHeaders }, input),
      )
    }
    if (operation.scope === 'public') {
      return await runOperation(db, name, { userId: null, headers }, input)
    }
    const userId = await signedInUser(headers, writes(name))
    return await withActor(userId, () => runOperation(db, name, { userId, headers }, input))
  } catch (error) {
    if (error instanceof ApiKeyRefusal) {
      return failure(error.status, { code: error.code, message: error.message })
    }
    const mapped = await unavailableOr(error)
    if (mapped instanceof AppError) return refusal(mapped)
    throw mapped
  }
}

// Start's server render calls the API in process, for the page's own request, as the
// native backend's host does for its render isolate.
export const renderTransport = hostTransport({
  call: (name, input) => answer(getRequest().headers, name as OperationName, input),
})

export function handleApiRequest(request: Request): Promise<Response> {
  return withTiming(async () => {
    const { status, body } = await respond(request)
    const headers = {
      'cache-control': 'no-store',
      'server-timing': serverTiming(['session', 'db']),
    }
    return Response.json(body, { status, headers })
  })
}
