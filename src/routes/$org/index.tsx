import { createFileRoute, redirect } from '@tanstack/solid-router'

// An organization opens at its timer.
export const Route = createFileRoute('/$org/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/$org/timer', params })
  },
})
