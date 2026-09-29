// Solid Query's useQuery and useInfiniteQuery, without their Solid resource. Its own hooks hand
// every cache update through a resource, which puts the nearest Suspense boundary back in its
// fallback for a moment: the page's nodes leave the document and come back, and a field loses
// focus after each write (TanStack/query#9955). A resource also fetches while the server
// renders and sends its data in the page a second time, next to the cache's. Here the query's
// result goes straight into a store, so a query never suspends, and the server renders the
// cache as the route loaders left it. The loaders fetch what a page shows, and one without
// data reads as pending.
import {
  type DefaultError,
  type DefaultedQueryObserverOptions,
  type InfiniteData,
  InfiniteQueryObserver,
  type InfiniteQueryObserverResult,
  type QueryClient,
  QueryObserver,
  type QueryObserverOptions,
  type QueryObserverResult,
  type QueryKey,
  type UseInfiniteQueryOptions,
  type UseQueryOptions,
  useQueryClient,
} from '@tanstack/solid-query'
import { batch, createComputed, createMemo, on, onCleanup } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { isServer } from 'solid-js/web'

// Any query's options and observer: the hooks below give them their types.
type Options = QueryObserverOptions<unknown, unknown>
type Observer = QueryObserver<unknown, unknown>
type Result = QueryObserverResult<unknown, unknown>
type Defaulted = DefaultedQueryObserverOptions<unknown, unknown>

function observe(
  options: () => Options,
  create: (client: QueryClient, options: Defaulted) => Observer,
): Result {
  const queryClient = useQueryClient()
  const defaulted = createMemo(() => {
    const defaultedOptions = queryClient.defaultQueryOptions(options())
    // The first result already says whether the query is about to fetch.
    // oxlint-disable-next-line no-underscore-dangle -- query-core's option, as Solid Query sets it.
    defaultedOptions._optimisticResults = 'optimistic'
    return defaultedOptions
  })
  // oxlint-disable-next-line solid/reactivity -- the computed below passes on later options.
  const observer = create(queryClient, defaulted())

  // A reconcile key (such as a list's id field) updates the stored data in place, so a
  // changed item keeps its nodes. Reconciling writes into the data, so the store gets a copy
  // rather than the cache's own.
  function reconcileKey() {
    // Solid Query's option, which query-core's observer types leave out.
    const key = (observer.options as { reconcile?: unknown }).reconcile
    return typeof key === 'string' ? key : undefined
  }
  function stored(result: Result): Result {
    return reconcileKey() && result.data !== undefined
      ? { ...result, data: structuredClone(result.data) }
      : result
  }

  const [state, setState] = createStore<Result>(stored(observer.getOptimisticResult(defaulted())))
  function update(result: Result) {
    const key = reconcileKey()
    if (!key || state.data === undefined || result.data === undefined) {
      setState(stored(result))
      return
    }
    const { data, ...rest } = stored(result)
    batch(() => {
      setState(rest)
      setState('data', reconcile(data, { key }))
    })
  }

  createComputed(
    on(
      defaulted,
      (opts) => {
        observer.setOptions(opts)
        update(observer.getOptimisticResult(opts))
      },
      { defer: true },
    ),
  )

  // The server renders the cache as the loaders left it, and fetches nothing more.
  if (!isServer) {
    // The observer can notify while Solid runs a computation, such as the options computed
    // above, so the store takes its latest result once that finishes.
    let queued = false
    const unsubscribe = observer.subscribe(() => {
      if (queued) return
      queued = true
      // oxlint-disable-next-line solid/reactivity -- it writes the store; nothing reads here.
      queueMicrotask(() => {
        queued = false
        update(observer.getCurrentResult())
      })
    })
    // A change between the first result and subscribing.
    observer.updateResult()
    onCleanup(unsubscribe)
  }

  return state
}

export function useQuery<
  TQueryFnData,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>) {
  return observe(
    options as () => Options,
    (client, opts) => new QueryObserver(client, opts),
  ) as QueryObserverResult<TData, TError>
}

export function useInfiniteQuery<
  TQueryFnData,
  TError = DefaultError,
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
>(options: UseInfiniteQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>) {
  return observe(
    options as unknown as () => Options,
    (client, opts) => new InfiniteQueryObserver(client, opts as never) as unknown as Observer,
  ) as unknown as InfiniteQueryObserverResult<TData, TError>
}
