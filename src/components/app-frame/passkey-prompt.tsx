// Offers a passkey after sign-in, since nobody signs up with one (docs/architecture.md,
// "Sign-in methods"). It shows above the page while the session can still add a passkey,
// to a user without one, in a browser with WebAuthn, until they add one or dismiss it on
// this device.
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import KeyRoundIcon from 'lucide-solid/icons/key-round'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import { Show, createSignal, onMount } from 'solid-js'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { authClient } from '~/lib/auth-client'
import { FRESH_SESSION_MS, passkeysQuery } from '~/lib/passkeys'
import { m } from '~/paraglide/messages.js'

export const PASSKEY_PROMPT_KEY = 'snowtime.passkeyPromptDismissed'

function dismissed() {
  try {
    return localStorage.getItem(PASSKEY_PROMPT_KEY) === '1'
  } catch {
    return false
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(PASSKEY_PROMPT_KEY, '1')
  } catch {
    // Storage is blocked: the prompt may show again on the next page load.
  }
}

export function PasskeyPrompt(props: { signedInAt: Date | string }) {
  const queryClient = useQueryClient()
  // Decided on mount, since only the browser knows WebAuthn and localStorage.
  const [due, setDue] = createSignal(false)
  const [added, setAdded] = createSignal(false)
  onMount(() => {
    const fresh = Date.now() - new Date(props.signedInAt).getTime() < FRESH_SESSION_MS
    setDue(fresh && typeof PublicKeyCredential !== 'undefined' && !dismissed())
  })
  const passkeys = useQuery(() => ({ ...passkeysQuery, enabled: due() }))

  function close() {
    rememberDismissed()
    setDue(false)
  }

  const add = useMutation(() => ({
    mutationFn: async () => {
      const result = await authClient.passkey.addPasskey()
      if (result?.error) throw result.error
    },
    onSuccess: () => {
      rememberDismissed()
      setAdded(true)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey }),
  }))

  function shown() {
    return due() && (added() || passkeys.data?.length === 0)
  }

  return (
    <Show when={shown()}>
      <Alert class="mb-6 flex flex-col gap-3 py-3 sm:flex-row sm:items-center [&>svg]:top-3 sm:[&>svg]:top-1/2 sm:[&>svg]:-translate-y-1/2 [&>svg~*]:pl-8">
        <KeyRoundIcon class="size-5" aria-hidden="true" />
        <div class="flex-1">
          <AlertTitle class="text-sm">
            {added() ? m.passkey_prompt_added_title() : m.passkey_prompt_title()}
          </AlertTitle>
          <AlertDescription class="text-muted-foreground text-[13px]">
            <Show
              when={added()}
              fallback={
                <Show when={add.isError} fallback={m.passkey_prompt_description()}>
                  <span class="text-destructive">{m.settings_passkey_add_failed()}</span>
                </Show>
              }
            >
              {m.passkey_prompt_added_description()}
            </Show>
          </AlertDescription>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Show
            when={!added()}
            fallback={
              <Button variant="outline" size="sm" onClick={close}>
                {m.passkey_prompt_done()}
              </Button>
            }
          >
            <Button size="sm" disabled={add.isPending} onClick={() => add.mutate()}>
              <Show when={add.isPending} fallback={m.settings_passkey_add()}>
                <LoaderCircleIcon class="animate-spin" aria-hidden="true" />
                {m.sign_in_passkey_waiting()}
              </Show>
            </Button>
            <Button variant="ghost" size="sm" disabled={add.isPending} onClick={close}>
              {m.passkey_prompt_later()}
            </Button>
          </Show>
        </div>
      </Alert>
    </Show>
  )
}
