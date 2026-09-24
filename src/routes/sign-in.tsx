import { queryOptions, useQuery, useQueryClient } from '@tanstack/solid-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/solid-router'
import { Show, createSignal } from 'solid-js'
import * as v from 'valibot'
import { AuthHeading, AuthLayout } from '~/components/auth/auth-layout'
import {
  FormAlert,
  PasskeyButton,
  PasswordSignIn,
  ProviderButtons,
} from '~/components/auth/sign-in-methods'
import { getSignInMethods } from '~/functions/auth'
import { safeRedirect } from '~/lib/redirect'
import { sessionQuery } from '~/lib/session'
import { m } from '~/paraglide/messages.js'

export const signInMethodsQuery = queryOptions({
  queryKey: ['sign-in-methods'],
  queryFn: () => getSignInMethods(),
  staleTime: Infinity,
})

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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const methods = useQuery(() => signInMethodsQuery)
  const [error, setError] = createSignal<string | null>(
    search().error ? m.sign_in_error_failed() : null,
  )
  function target() {
    return safeRedirect(search().redirect)
  }
  function has(method: 'password' | 'passkey') {
    return methods.data?.includes(method) ?? false
  }

  // Password and passkey sign-in stay on the page, so the session is loaded again here.
  async function signedIn() {
    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey })
    await navigate({ href: target() })
  }

  return (
    <AuthLayout>
      <AuthHeading title={m.sign_in_title()} description={m.sign_in_description()} />
      <FormAlert message={error()} />
      <ProviderButtons
        methods={methods.data ?? []}
        callbackURL={target()}
        errorCallbackURL={`/sign-in?redirect=${encodeURIComponent(target())}`}
        onError={setError}
      />
      <Show when={has('passkey')}>
        <PasskeyButton onSuccess={signedIn} onError={setError} />
      </Show>
      <Show when={has('password')}>
        <PasswordSignIn
          submitLabel={m.sign_in_submit()}
          submittingLabel={m.sign_in_submitting()}
          onSuccess={signedIn}
        />
      </Show>
    </AuthLayout>
  )
}
