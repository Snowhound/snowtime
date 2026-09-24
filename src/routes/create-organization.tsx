import { createFileRoute, redirect } from '@tanstack/solid-router'
import { CreateOrganizationPage } from '~/features/auth/create-organization-page'
import { m } from '~/paraglide/messages.js'

export const Route = createFileRoute('/create-organization')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    return { session: context.session }
  },
  head: () => ({ meta: [{ title: `${m.create_org_title()} · ${m.app_name()}` }] }),
  component: CreateOrganization,
})

function CreateOrganization() {
  const context = Route.useRouteContext()
  return <CreateOrganizationPage email={context().session.user.email} />
}
