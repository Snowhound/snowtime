// The sign-in methods shared by the sign-in and invitation screens. Each shows only when
// getSignInMethods returns it (docs/architecture.md, "Sign-in methods").
import { createForm } from '@tanstack/solid-form'
import { useQuery } from '@tanstack/solid-query'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import EyeIcon from 'lucide-solid/icons/eye'
import EyeOffIcon from 'lucide-solid/icons/eye-off'
import KeyRoundIcon from 'lucide-solid/icons/key-round'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import type { Component } from 'solid-js'
import { For, Show, createSignal } from 'solid-js'
import { GitHubIcon, GoogleIcon, MicrosoftIcon } from '~/components/brand-logos'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import {
  TextField,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from '~/components/ui/text-field'
import { authClient } from '~/lib/auth-client'
import { fieldError } from '~/lib/form'
import { m } from '~/paraglide/messages.js'
import { getDevUsers } from '~/server/auth/auth.functions'
import type { SignInMethod } from '~/server/auth/auth.functions'
import { SignInForm } from '~/server/auth/auth.schemas'
import { AuthDivider } from './auth-layout'

type SocialProvider = 'google' | 'github' | 'microsoft'

const PROVIDERS: { id: SocialProvider; name: string; label: () => string; Icon: Component }[] = [
  { id: 'google', name: 'Google', label: m.sign_in_google, Icon: GoogleIcon },
  { id: 'github', name: 'GitHub', label: m.sign_in_github, Icon: GitHubIcon },
  { id: 'microsoft', name: 'Microsoft', label: m.sign_in_microsoft, Icon: MicrosoftIcon },
]

// A button's label while it waits, with a spinner.
function Busy(props: { label: string }) {
  return (
    <>
      <LoaderCircleIcon class="animate-spin" aria-hidden="true" />
      {props.label}
    </>
  )
}

// The provider buttons. A provider sign-in leaves the page, and Better Auth brings the user
// back to `callbackURL`, or to `errorCallbackURL` with an `error` search parameter.
export function ProviderButtons(props: {
  methods: readonly SignInMethod[]
  callbackURL: string
  errorCallbackURL: string
  onError: (message: string) => void
}) {
  const [pending, setPending] = createSignal<SocialProvider | null>(null)
  function shown() {
    return PROVIDERS.filter((p) => props.methods.includes(p.id))
  }

  async function signIn(provider: SocialProvider) {
    setPending(provider)
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: props.callbackURL,
      errorCallbackURL: props.errorCallbackURL,
    })
    if (error) {
      setPending(null)
      props.onError(m.sign_in_error_failed())
    }
  }

  return (
    <Show when={shown().length > 0}>
      <div class="grid gap-2">
        <For each={shown()}>
          {(provider) => (
            <Button
              variant="outline"
              disabled={pending() !== null}
              onClick={() => signIn(provider.id)}
            >
              <Show
                when={pending() === provider.id}
                fallback={
                  <>
                    <provider.Icon />
                    {provider.label()}
                  </>
                }
              >
                <Busy label={m.sign_in_redirecting({ provider: provider.name })} />
              </Show>
            </Button>
          )}
        </For>
      </div>
    </Show>
  )
}

export function PasskeyButton(props: {
  onSuccess: () => void
  onError: (message: string) => void
}) {
  const [pending, setPending] = createSignal(false)

  async function signIn() {
    setPending(true)
    const result = await authClient.signIn.passkey()
    setPending(false)
    if (result?.error) props.onError(m.sign_in_error_failed())
    else props.onSuccess()
  }

  return (
    <Button variant="outline" disabled={pending()} onClick={signIn}>
      <Show
        when={pending()}
        fallback={
          <>
            <KeyRoundIcon aria-hidden="true" />
            {m.sign_in_passkey()}
          </>
        }
      >
        <Busy label={m.sign_in_passkey_waiting()} />
      </Show>
    </Button>
  )
}

// A form-level error, such as wrong credentials, above the fields.
export function FormAlert(props: { message: string | null }) {
  return (
    <Show when={props.message}>
      <Alert variant="destructive" role="alert">
        <CircleAlertIcon aria-hidden="true" />
        <AlertDescription>{props.message}</AlertDescription>
      </Alert>
    </Show>
  )
}

// Email and password, for seeded users in local development only. The seeded users are
// listed above the form; picking one fills in their email and password.
export function PasswordSignIn(props: {
  email?: string
  submitLabel: string
  submittingLabel: string
  onSuccess: () => void
}) {
  const [formError, setFormError] = createSignal<string | null>(null)
  const [revealed, setRevealed] = createSignal(false)
  const devUsers = useQuery(() => ({
    queryKey: ['dev-users'],
    queryFn: () => getDevUsers(),
    staleTime: Infinity,
  }))
  let formRef!: HTMLFormElement

  const form = createForm(() => ({
    defaultValues: { email: props.email ?? '', password: '' },
    validators: { onSubmit: SignInForm },
    onSubmitInvalid: () =>
      queueMicrotask(() =>
        formRef.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus(),
      ),
    onSubmit: async ({ value }) => {
      setFormError(null)
      const { error } = await authClient.signIn.email({
        email: value.email.trim(),
        password: value.password,
      })
      if (!error) return props.onSuccess()
      setFormError(
        error.code === 'INVALID_EMAIL_OR_PASSWORD'
          ? m.sign_in_error_credentials()
          : m.sign_in_error_failed(),
      )
    },
  }))
  const submitting = form.useStore((state) => state.isSubmitting)

  return (
    <>
      <AuthDivider />
      <Show when={devUsers.data?.length}>
        <div class="grid gap-2">
          <p class="text-muted-foreground text-xs font-medium">{m.sign_in_dev_users()}</p>
          <ul class="max-h-40 overflow-y-auto rounded-md border p-1">
            <For each={devUsers.data}>
              {(user) => (
                <li>
                  <button
                    type="button"
                    class="hover:bg-accent focus-visible:bg-accent flex w-full min-w-0 flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm focus-visible:outline-none"
                    onClick={() => {
                      form.setFieldValue('email', user.email)
                      form.setFieldValue('password', user.password)
                      setFormError(null)
                    }}
                  >
                    <span class="w-full truncate font-medium">{user.name}</span>
                    <span class="text-muted-foreground w-full truncate text-xs">{user.email}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
      <form
        ref={formRef}
        class="grid gap-4"
        novalidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <FormAlert message={formError()} />
        <form.Field name="email">
          {(field) => (
            <TextField
              class="grid gap-2"
              value={field().state.value}
              onChange={field().handleChange}
              validationState={fieldError(field().state.meta.errors) ? 'invalid' : 'valid'}
            >
              <TextFieldLabel>{m.sign_in_email()}</TextFieldLabel>
              <TextFieldInput
                type="email"
                name="email"
                autocomplete="username webauthn"
                onBlur={field().handleBlur}
              />
              <TextFieldErrorMessage>{fieldError(field().state.meta.errors)}</TextFieldErrorMessage>
            </TextField>
          )}
        </form.Field>
        <form.Field name="password">
          {(field) => (
            <TextField
              class="grid gap-2"
              value={field().state.value}
              onChange={field().handleChange}
              validationState={fieldError(field().state.meta.errors) ? 'invalid' : 'valid'}
            >
              <TextFieldLabel>{m.sign_in_password()}</TextFieldLabel>
              <div class="relative">
                <TextFieldInput
                  class="pr-10"
                  type={revealed() ? 'text' : 'password'}
                  name="password"
                  autocomplete="current-password"
                  onBlur={field().handleBlur}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  class="absolute top-0 right-0 hover:bg-transparent"
                  aria-label={revealed() ? m.sign_in_hide_password() : m.sign_in_show_password()}
                  aria-pressed={revealed()}
                  onClick={() => setRevealed(!revealed())}
                >
                  <Show when={revealed()} fallback={<EyeIcon aria-hidden="true" />}>
                    <EyeOffIcon aria-hidden="true" />
                  </Show>
                </Button>
              </div>
              <TextFieldErrorMessage>{fieldError(field().state.meta.errors)}</TextFieldErrorMessage>
            </TextField>
          )}
        </form.Field>
        <Button type="submit" disabled={submitting()}>
          <Show when={submitting()} fallback={props.submitLabel}>
            <Busy label={props.submittingLabel} />
          </Show>
        </Button>
      </form>
    </>
  )
}
