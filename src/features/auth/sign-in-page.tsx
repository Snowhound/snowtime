import { useQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate } from '@tanstack/solid-router'
import { Show, createSignal } from 'solid-js'
import { safeRedirect } from '~/lib/redirect'
import { sessionQuery } from '~/lib/session'
import { signInMethodsQuery } from '~/lib/sign-in-methods'
import { m } from '~/paraglide/messages.js'
import { AuthHeading, AuthLayout } from './auth-layout'
import { FormAlert, PasskeyButton, PasswordSignIn, ProviderButtons } from './sign-in-methods'

export function SignInPage(props: { redirect?: string; initialError?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const methods = useQuery(() => signInMethodsQuery)
  const [error, setError] = createSignal<string | null>(
    props.initialError ? m.sign_in_error_failed() : null,
  )
  function target() {
    return safeRedirect(props.redirect)
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
    <AuthLayout firstVisitIntro>
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
