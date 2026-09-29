import { render, screen } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { For, type JSX, Suspense } from 'solid-js'
import { describe, expect, test, vi } from 'vitest'
import { useQuery } from './use-query'

type Item = { id: string; name: string }

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper(props: { children: JSX.Element }) {
    return <QueryClientProvider client={queryClient}>{props.children}</QueryClientProvider>
  }
  return { queryClient, Wrapper }
}

describe('useQuery', () => {
  test('a write and its refetch leave the page in the document', async () => {
    const { queryClient, Wrapper } = setup()
    const queryFn = vi.fn(() => Promise.resolve([{ id: 'a', name: 'Refetched' }]))
    queryClient.setQueryData(['items'], [{ id: 'a', name: 'Loaded' }])
    const fallback = vi.fn(() => <p>Loading</p>)
    function Items() {
      const items = useQuery(() => ({ queryKey: ['items'], queryFn, staleTime: 60_000 }))
      return (
        <ul>
          <For each={items.data}>{(item) => <li>{item.name}</li>}</For>
        </ul>
      )
    }
    render(() => (
      <Wrapper>
        <Suspense fallback={fallback()}>
          <Items />
        </Suspense>
      </Wrapper>
    ))
    const list = screen.getByRole('list')

    queryClient.setQueryData(['items'], [{ id: 'a', name: 'Written' }])
    await screen.findByText('Written')
    await queryClient.invalidateQueries({ queryKey: ['items'] })
    await screen.findByText('Refetched')

    expect(queryFn).toHaveBeenCalledOnce()
    expect(list.isConnected).toBe(true)
    expect(screen.queryByText('Loading')).toBeNull()
  })

  test('a query without data reads as pending until it loads', async () => {
    const { Wrapper } = setup()
    let resolve!: (items: Item[]) => void
    function Items() {
      const items = useQuery(() => ({
        queryKey: ['items'],
        queryFn: () => new Promise<Item[]>((r) => (resolve = r)),
      }))
      return (
        <p>
          {items.status}: {items.data?.length ?? 'none'}
        </p>
      )
    }
    render(() => (
      <Wrapper>
        <Items />
      </Wrapper>
    ))
    expect(screen.getByText('pending: none')).toBeTruthy()

    resolve([{ id: 'a', name: 'Loaded' }])
    await screen.findByText('success: 1')
  })

  test('a reconcile key updates changed items in place, not the cache’s own data', async () => {
    const { queryClient, Wrapper } = setup()
    const cached = [{ id: 'a', name: 'Before' }]
    queryClient.setQueryData(['items'], cached)
    let items!: ReturnType<typeof useQuery<Item[]>>
    function Items() {
      items = useQuery(() => ({
        queryKey: ['items'],
        queryFn: () => Promise.resolve(cached),
        reconcile: 'id',
        staleTime: 60_000,
      }))
      return null
    }
    render(() => (
      <Wrapper>
        <Items />
      </Wrapper>
    ))
    const first = items.data?.[0]

    queryClient.setQueryData(['items'], [{ id: 'a', name: 'After' }])
    await vi.waitFor(() => expect(items.data?.[0]?.name).toBe('After'))

    expect(items.data?.[0]).toBe(first)
    expect(cached[0]?.name).toBe('Before')
  })
})
