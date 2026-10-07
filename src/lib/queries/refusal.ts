import type { Mutation, QueryClient, QueryKey } from '@tanstack/solid-query'

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

// Writes the server refused, with their optimistic changes still in the caches, in the order
// they were made. A write made while one is pending waits behind it unsent, so retrying sends
// them in order and an older edit never overwrites a newer one. Nothing here sends a write
// on its own.
interface Change {
  variables: unknown
  context: object
  reapply: (key: QueryKey, data: unknown) => void
  mutation?: Mutation
}
interface PendingState {
  changes: Change[]
  retrying: boolean
  listeners: Set<() => void>
}
const clients = new WeakMap<QueryClient, PendingState>()
// Errors whose write stays pending, so their message says so rather than that it failed.
const keptErrors = new WeakSet<object>()

function notify(state: PendingState) {
  for (const listener of state.listeners) listener()
}

function pendingState(client: QueryClient): PendingState {
  const existing = clients.get(client)
  if (existing) return existing
  const state: PendingState = { changes: [], retrying: false, listeners: new Set() }
  clients.set(client, state)
  client.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'error') return
    const change = state.changes.find((c) => c.variables === event.mutation.state.variables)
    if (change) change.mutation = event.mutation
  })
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return
    for (const change of state.changes) change.reapply(event.query.queryKey, event.query.state.data)
  })
  return state
}

export function isPendingChange(error: unknown) {
  return typeof error === 'object' && error !== null && keptErrors.has(error)
}

// A pending write's optimistic context, so sending it again doesn't apply it twice.
export function pendingContext(client: QueryClient, variables: unknown) {
  return clients.get(client)?.changes.find((c) => c.variables === variables)?.context
}

// Whether a write must wait because one made before it is still pending.
export function waitsBehind(client: QueryClient, variables: unknown) {
  const changes = clients.get(client)?.changes ?? []
  const index = changes.findIndex((c) => c.variables === variables)
  return index === -1 ? changes.length > 0 : index > 0
}

// The error of a write that waits behind a pending one without being sent.
export function waitingError() {
  return Object.assign(new Error('An earlier change is pending'), {
    status: 503 as const,
    retryAfter: null,
  })
}

export function retainChange(
  client: QueryClient,
  variables: unknown,
  context: object,
  error: unknown,
  reapply: Change['reapply'],
) {
  if (typeof error === 'object' && error !== null) keptErrors.add(error)
  const state = pendingState(client)
  if (state.changes.some((c) => c.variables === variables)) return
  state.changes.push({ variables, context, reapply })
  notify(state)
}

export function finishChange(client: QueryClient, variables: unknown) {
  const state = clients.get(client)
  if (!state?.changes.some((c) => c.variables === variables)) return
  state.changes = state.changes.filter((c) => c.variables !== variables)
  notify(state)
}

export function pendingCount(client: QueryClient) {
  return clients.get(client)?.changes.length ?? 0
}

export function isRetrying(client: QueryClient) {
  return clients.get(client)?.retrying ?? false
}

// Sends the pending writes again, oldest first, and stops at the first the server refuses.
// One that fails for good rolls back, and the next is sent.
export async function retryPending(client: QueryClient) {
  const state = pendingState(client)
  if (state.retrying) return
  state.retrying = true
  notify(state)
  try {
    for (const change of state.changes) {
      if (!state.changes.includes(change) || !change.mutation) continue
      try {
        await change.mutation.execute(change.variables)
      } catch {
        // The mutation's callbacks keep a new refusal or roll back a permanent error.
      }
      if (state.changes.includes(change)) break
    }
  } finally {
    state.retrying = false
    notify(state)
  }
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
