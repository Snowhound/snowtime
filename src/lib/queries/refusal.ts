import type { QueryClient, QueryKey } from '@tanstack/solid-query'

export function isRefused(error: unknown): error is { status: 503; retryAfter?: string | null } {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 503
}

export function retryAfterMs(error: unknown, now = Date.now()) {
  if (!isRefused(error) || !error.retryAfter) return 0
  const seconds = Number(error.retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(error.retryAfter)
  return Number.isFinite(date) ? Math.max(0, date - now) : 0
}

export function readRetryDelay(attempt: number, error: unknown) {
  const backoff = Math.min(1000 * 2 ** attempt, 30_000)
  return Math.max(backoff, retryAfterMs(error)) + Math.random() * backoff
}

export interface PendingChange {
  id: number
  retrying: boolean
  retry: () => Promise<void>
}
interface RetainedChange extends PendingChange {
  context: object
  reapply: (key: QueryKey, data: unknown) => void
}
interface PendingState {
  changes: RetainedChange[]
  listeners: Set<() => void>
  nextId: number
}
const clients = new WeakMap<QueryClient, PendingState>()

function notify(state: PendingState) {
  for (const listener of state.listeners) listener()
}

function pendingState(client: QueryClient): PendingState {
  const existing = clients.get(client)
  if (existing) return existing
  const state: PendingState = { changes: [], listeners: new Set(), nextId: 0 }
  clients.set(client, state)
  client.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'error') return
    const change = state.changes.find((change) => change.context === event.mutation.state.context)
    if (!change) return
    const mutation = event.mutation
    const variables = mutation.state.variables
    change.retry = async () => {
      if (change.retrying || !state.changes.includes(change)) return
      change.retrying = true
      notify(state)
      try {
        await mutation.execute(variables)
      } catch {
        // The mutation callbacks retain a new refusal or roll back a permanent error.
      } finally {
        change.retrying = false
        notify(state)
      }
    }
    notify(state)
  })
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return
    for (const change of state.changes) change.reapply(event.query.queryKey, event.query.state.data)
  })
  return state
}

export function retainChange(
  client: QueryClient,
  context: object,
  reapply: RetainedChange['reapply'],
) {
  const state = pendingState(client)
  if (state.changes.some((change) => change.context === context)) return
  state.changes.push({
    id: ++state.nextId,
    context,
    reapply,
    retrying: false,
    retry: async () => {},
  })
}

export function finishChange(client: QueryClient, context: object) {
  const state = pendingState(client)
  state.changes = state.changes.filter((change) => change.context !== context)
  notify(state)
}

export function pendingChanges(client: QueryClient): readonly PendingChange[] {
  return pendingState(client).changes.map(({ id, retrying, retry }) => ({ id, retrying, retry }))
}

export function subscribePending(client: QueryClient, listener: () => void) {
  const state = pendingState(client)
  state.listeners.add(listener)
  return () => state.listeners.delete(listener)
}

export function clearPending(client: QueryClient) {
  const state = clients.get(client)
  if (!state) return
  state.changes = []
  notify(state)
}
