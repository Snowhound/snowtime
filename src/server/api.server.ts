// The JSON API (task 084): the contract's calls over HTTP, beside the server functions and
// running the same rules (operations.server.ts). The native backend serves the same API, and
// the conformance tests (conformance/) check both.
import { db } from '~/db'
import { withActor } from '~/db/actor'
import { env } from '~/env'
import { type OperationName, operations } from '~/lib/api/operations'
import { matchPath, type WireResponse } from '~/lib/api/wire'
import { AppError } from './errors'
import { signedInUser, unavailableOr } from './guards.server'
import { failure, refusal, runOperation } from './operations.server'

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

const appOrigin = new URL(env.BETTER_AUTH_URL).origin

async function respond(request: Request): Promise<WireResponse> {
  const match = matchOperation(request.method, new URL(request.url).pathname)
  if (!match) return failure(404, { message: 'No such call.' })
  // Writes come only from the app's own pages: the public URL, not the request's own,
  // since a proxy in front may change the host.
  const write = request.method !== 'GET'
  if (write && request.headers.get('origin') !== appOrigin) {
    return failure(403, { message: 'Cross-origin request refused.' })
  }
  let input: unknown
  try {
    input = await inputOf(request, match.params)
  } catch {
    return failure(400, { message: 'The body is not JSON.' })
  }
  try {
    const userId = await signedInUser(request.headers, write)
    return await withActor(userId, () => runOperation(db, match.name, userId, input))
  } catch (error) {
    const mapped = await unavailableOr(error)
    if (mapped instanceof AppError) return refusal(mapped)
    throw mapped
  }
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const { status, body } = await respond(request)
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}
