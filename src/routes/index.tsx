import { createFileRoute, redirect } from '@tanstack/solid-router'
import { defaultOrganization, withoutOrganization } from '~/lib/session'

// The app starts at the default organization's timer.
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    const { session } = context
    if (!session) throw redirect({ to: '/sign-in' })
    const organization = defaultOrganization(session)
    if (!organization) throw withoutOrganization(session)
    throw redirect({ to: '/$org/timer', params: { org: organization.slug } })
  },
})
