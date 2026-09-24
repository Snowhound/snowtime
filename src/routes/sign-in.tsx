import { createFileRoute, redirect } from '@tanstack/solid-router'
import * as v from 'valibot'
import { SignInPage } from '~/features/auth/sign-in-page'
import { safeRedirect } from '~/lib/redirect'
import { signInMethodsQuery } from '~/lib/sign-in-methods'
import { m } from '~/paraglide/messages.js'

export const Route = createFileRoute('/sign-in')({
  // `redirect` is where to return after signing in; `error` is set by Better Auth when a
  // provider sign-in fails.
  validateSearch: v.object({
    redirect: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  beforeLoad: ({ context, search }) => {
    if (context.session) throw redirect({ href: safeRedirect(search.redirect) })
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(signInMethodsQuery),
  head: () => ({ meta: [{ title: `${m.sign_in_title()} · ${m.app_name()}` }] }),
  component: SignIn,
})

function SignIn() {
  const search = Route.useSearch()
  return <SignInPage redirect={search().redirect} initialError={search().error} />
}
