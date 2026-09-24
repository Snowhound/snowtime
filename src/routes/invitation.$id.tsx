import { createFileRoute } from '@tanstack/solid-router'
import * as v from 'valibot'
import { InvitationPage, invitationQuery } from '~/features/auth/invitation-page'
import { signInMethodsQuery } from '~/lib/sign-in-methods'
import { m } from '~/paraglide/messages.js'

export const Route = createFileRoute('/invitation/$id')({
  validateSearch: v.object({ error: v.optional(v.string()) }),
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(invitationQuery(params.id)),
      context.queryClient.ensureQueryData(signInMethodsQuery),
    ]),
  head: () => ({ meta: [{ title: m.app_name() }] }),
  component: Invitation,
})

function Invitation() {
  const params = Route.useParams()
  const search = Route.useSearch()
  return <InvitationPage id={params().id} initialError={search().error} />
}
