import { useQueryClient } from '@tanstack/solid-query'
import { useNavigate } from '@tanstack/solid-router'
import { Show, createSignal } from 'solid-js'
import { AuthHeading, AuthLayout } from '~/components/auth-layout/auth-layout'
import { ErrorAlert } from '~/components/error-alert'
import { loginPolicyQuery } from '~/lib/queries/login-policy'
import { sessionQuery } from '~/lib/queries/session'
import { signInMethodsQuery } from '~/lib/queries/sign-in-methods'
import { useQuery } from '~/lib/queries/use-query'
import { safeRedirect } from '~/lib/redirect'
import { m } from '~/paraglide/messages.js'
import {
  PasskeyButton,
  PasswordSignIn,
  ProviderButtons,
  providerErrorMessage,
} from './sign-in-methods'

export function SignInPage(props: { redirect?: string; initialError?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const methods = useQuery(() => signInMethodsQuery)
  const policy = useQuery(() => loginPolicyQuery)
  const [error, setError] = createSignal<string | null>(
    props.initialError ? providerErrorMessage(props.initialError) : null,
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
      <Show when={policy.data?.demoMode}>
        <p role="note" class="rounded-lg border border-amber-300/40 bg-amber-100/10 p-3 text-sm">
          {m.sign_in_demo_notice()}
        </p>
      </Show>
      <Show when={policy.data?.allowedDomains.length}>
        <p role="note" class="text-muted-foreground text-sm">
          {m.sign_in_internal_notice({ domains: policy.data?.allowedDomains.join(', ') ?? '' })}
        </p>
      </Show>
      <ErrorAlert message={error()} />
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
