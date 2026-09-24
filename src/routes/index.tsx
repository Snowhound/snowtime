import { createFileRoute, redirect } from '@tanstack/solid-router'

// The app starts at the timer; the signed-in layout sends signed-out users to sign-in.
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    throw redirect({ to: context.session ? '/timer' : '/sign-in' })
  },
})
