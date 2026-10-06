import { useMatches } from '@tanstack/solid-router'
import { createEffect, createSignal, on, onCleanup, onMount } from 'solid-js'
import { runningMs } from '~/lib/calendar'
import { formatClock } from '~/lib/format'
import { runningTimerQuery } from '~/lib/queries/timer'
import { useQuery } from '~/lib/queries/use-query'

export function TimerTitle(props: { userId: string | undefined }) {
  const pageTitle = useMatches({
    select: (matches) => {
      for (const match of matches.toReversed()) {
        for (const meta of (match.meta ?? []).toReversed()) {
          if (meta?.title) return meta.title
        }
      }
      return 'Snowtime'
    },
  })
  // Observe server results, optimistic writes, and rollbacks without fetching on other pages.
  const running = useQuery(() => ({ ...runningTimerQuery, enabled: false }))
  const [now, setNow] = createSignal(Date.now())
  const [startedAt, setStartedAt] = createSignal<Date | null>(null)
  createEffect(
    on(
      () => props.userId,
      (userId) => {
        setStartedAt(userId ? readStartedAt(timerStorageKey(userId)) : null)
      },
    ),
  )
  createEffect(
    on(
      () => [running.data, running.dataUpdatedAt] as const,
      ([timer]) => {
        const userId = props.userId
        if (!userId || timer === undefined || (timer && timer.userId !== userId)) return
        const start = timer?.startedAt ?? null
        setStartedAt(start)
        try {
          const key = timerStorageKey(userId)
          if (start) localStorage.setItem(key, String(start.getTime()))
          else localStorage.removeItem(key)
        } catch {
          // Storage can be blocked; the query cache still drives the title.
        }
      },
    ),
  )
  createEffect(() => {
    if (!startedAt()) return
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(tick))
  })
  function onVisible() {
    if (document.visibilityState === 'visible') setNow(Date.now())
  }
  function onStorage(event: StorageEvent) {
    const userId = props.userId
    if (
      userId &&
      event.storageArea === localStorage &&
      (event.key === timerStorageKey(userId) || event.key === null)
    ) {
      setStartedAt(readStartedAt(timerStorageKey(userId)))
    }
  }
  onMount(() => {
    window.addEventListener('storage', onStorage)
    onCleanup(() => window.removeEventListener('storage', onStorage))
    document.addEventListener('visibilitychange', onVisible)
    onCleanup(() => document.removeEventListener('visibilitychange', onVisible))
  })
  createEffect(() => {
    const current = startedAt()
    const title = current
      ? `${formatClock(runningMs(current, now()))} · ${pageTitle()}`
      : pageTitle()
    let active = true
    // Route head effects also write the title; apply the elapsed time after they finish.
    queueMicrotask(() => {
      if (active) document.title = title
    })
    onCleanup(() => (active = false))
  })
  onCleanup(() => {
    if (typeof document !== 'undefined') document.title = pageTitle()
  })
  return null
}

function timerStorageKey(userId: string) {
  return `snowtime.timer.${userId}`
}

function readStartedAt(key: string): Date | null {
  try {
    const stored = localStorage.getItem(key)
    if (!stored?.trim()) return null
    const timestamp = Number(stored)
    const date = new Date(timestamp)
    return Number.isFinite(timestamp) && timestamp >= 0 && !Number.isNaN(date.getTime())
      ? date
      : null
  } catch {
    return null
  }
}
