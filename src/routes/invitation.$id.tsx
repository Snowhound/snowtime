import { createFileRoute } from '@tanstack/solid-router'
import * as v from 'valibot'
import { InvitationPage } from '~/features/auth/invitation-page'
import { invitationQuery } from '~/features/auth/queries'
import { signInMethodsQuery } from '~/lib/queries/sign-in-methods'
import { m } from '~/paraglide/messages.js'

export const Route = createFileRoute('/invitation/$id')({
  validateSearch: v.object({ error: v.optional(v.string()) }),
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.query({ ...invitationQuery(params.id), staleTime: 'static' }),
      context.queryClient.query({ ...signInMethodsQuery, staleTime: 'static' }),
    ]),
  head: () => ({ meta: [{ title: m.app_name() }] }),
  component: Invitation,
})

function Invitation() {
  const params = Route.useParams()
  const search = Route.useSearch()
  return <InvitationPage id={params().id} initialError={search().error} />
}
