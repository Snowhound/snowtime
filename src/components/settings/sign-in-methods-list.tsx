// The sign-in methods of the Profile card: linked providers with Connect and Disconnect,
// the local password account, and passkeys. Better Auth refuses to unlink the last
// account, so Disconnect is disabled on it; passkeys don't count, since Better Auth stores
// them apart from accounts.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import KeyRoundIcon from 'lucide-solid/icons/key-round'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import type { Component, JSX } from 'solid-js'
import { For, Show, createSignal } from 'solid-js'
import { isServer } from 'solid-js/web'
import { authClient } from '../../lib/auth-client'
import { formatDateTime } from '../../lib/format'
import { m } from '../../paraglide/messages.js'
import type { SignInMethod } from '../../server/sign-in.server'
import { GitHubIcon, GoogleIcon, MicrosoftIcon } from '../auth/brand-logos'
import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

type SocialProvider = 'google' | 'github' | 'microsoft'

const PROVIDERS: { id: SocialProvider; name: string; Icon: Component }[] = [
  { id: 'google', name: 'Google', Icon: GoogleIcon },
  { id: 'github', name: 'GitHub', Icon: GitHubIcon },
  { id: 'microsoft', name: 'Microsoft', Icon: MicrosoftIcon },
]

// Better Auth's client calls resolve to { data, error }; queries want a throw.
async function unwrap<T>(call: Promise<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await call
  if (error || data === null) throw error ?? new Error('No data')
  return data
}

// Both lists come from the browser: the Better Auth client can't call itself during
// server rendering.
export const accountsQuery = queryOptions({
  queryKey: ['auth', 'accounts'],
  queryFn: () => unwrap(authClient.listAccounts()),
  enabled: !isServer,
})

export const passkeysQuery = queryOptions({
  queryKey: ['auth', 'passkeys'],
  queryFn: () => unwrap(authClient.passkey.listUserPasskeys()),
  enabled: !isServer,
})

// The `error` search parameter Better Auth sets when linking a provider fails.
export function linkErrorMessage(code: string) {
  if (code === 'email_does_not_match') return m.settings_link_error_email()
  if (code === 'account_already_linked_to_different_user') return m.settings_link_error_taken()
  return m.settings_link_error_failed()
}

// Unlinking and adding or removing a passkey need a session from the last day.
function actionError(error: unknown, fallback: () => string) {
  const code = (error as { code?: string } | null)?.code
  return code === 'SESSION_NOT_FRESH' ? m.settings_session_not_fresh() : fallback()
}

type Confirm = {
  title: string
  description: string
  action: string
  run: () => Promise<unknown>
}

function MethodRow(props: {
  icon: JSX.Element
  name: string
  badge?: JSX.Element
  detail: string
  children?: JSX.Element
}) {
  return (
    <li class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        {props.icon}
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
            {props.name}
            {props.badge}
          </p>
          <p class="text-muted-foreground text-sm break-words">{props.detail}</p>
        </div>
      </div>
      <Show when={props.children}>
        <div class="flex shrink-0 items-center gap-2">{props.children}</div>
      </Show>
    </li>
  )
}

export function SignInMethodsList(props: {
  methods: readonly SignInMethod[]
  timeZone: string
  linkError?: string | null
}) {
  const queryClient = useQueryClient()
  const accounts = useQuery(() => accountsQuery)
  const passkeys = useQuery(() => passkeysQuery)
  const [error, setError] = createSignal<string | null>(null)
  const [connecting, setConnecting] = createSignal<SocialProvider | null>(null)
  // The dialog keeps its last action while it closes, so its text doesn't blank out.
  const [confirm, setConfirm] = createSignal<Confirm | null>(null)
  const [confirmOpen, setConfirmOpen] = createSignal(false)
  function ask(action: Confirm) {
    confirmAction.reset()
    setConfirm(action)
    setConfirmOpen(true)
  }

  const alert = () => error() ?? props.linkError ?? null
  const date = (at: Date | string) =>
    formatDateTime(new Date(at), props.timeZone, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  const linked = (providerId: string) => accounts.data?.find((a) => a.providerId === providerId)
  const lastAccount = () => (accounts.data?.length ?? 0) <= 1

  // Configured providers, plus any linked one that was since switched off, so it can
  // still be disconnected.
  const providers = () =>
    PROVIDERS.filter((p) => props.methods.includes(p.id) || linked(p.id) !== undefined)

  // Linking leaves the page for the provider, which sends the user back here.
  async function connect(provider: SocialProvider) {
    setError(null)
    setConnecting(provider)
    const { error } = await authClient.linkSocial({
      provider,
      callbackURL: '/settings',
      errorCallbackURL: '/settings',
    })
    if (error) {
      setConnecting(null)
      setError(m.settings_link_error_failed())
    }
  }

  const confirmAction = useMutation(() => ({
    mutationFn: (action: Confirm) => action.run(),
    onSuccess: () => setConfirmOpen(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['auth'] }),
  }))

  function disconnect(provider: { id: SocialProvider; name: string }) {
    const account = linked(provider.id)
    if (!account) return
    ask({
      title: m.settings_disconnect_title({ provider: provider.name }),
      description: m.settings_disconnect_description({ provider: provider.name }),
      action: m.settings_disconnect(),
      run: () => unwrap(authClient.unlinkAccount({ accountId: account.id })),
    })
  }

  function removePasskey(passkey: { id: string; name?: string | null }) {
    ask({
      title: m.settings_passkey_remove_title(),
      description: m.settings_passkey_remove_description({
        name: passkey.name || m.settings_passkey(),
      }),
      action: m.settings_passkey_remove(),
      run: () => unwrap(authClient.passkey.deletePasskey({ id: passkey.id })),
    })
  }

  const addPasskey = useMutation(() => ({
    mutationFn: async () => {
      const result = await authClient.passkey.addPasskey()
      if (result?.error) throw result.error
    },
    onMutate: () => setError(null),
    onError: (error) => setError(actionError(error, m.settings_passkey_add_failed)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey }),
  }))

  return (
    <>
      <Show when={alert()}>
        <Alert variant="destructive" role="alert">
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>{alert()}</AlertDescription>
        </Alert>
      </Show>
      <Show
        when={accounts.data}
        fallback={
          <div class="text-muted-foreground flex items-center gap-2 rounded-md border px-4 py-3 text-sm">
            <LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
            {m.settings_methods_loading()}
          </div>
        }
      >
        <ul class="divide-y rounded-md border">
          <For each={providers()}>
            {(provider) => (
              <Show
                when={linked(provider.id)}
                fallback={
                  <MethodRow
                    icon={<provider.Icon />}
                    name={provider.name}
                    detail={m.settings_not_connected()}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={connecting() !== null}
                      onClick={() => connect(provider.id)}
                    >
                      <Show when={connecting() === provider.id} fallback={m.settings_connect()}>
                        <LoaderCircleIcon class="animate-spin" aria-hidden="true" />
                        {m.sign_in_redirecting({ provider: provider.name })}
                      </Show>
                    </Button>
                  </MethodRow>
                }
              >
                {(account) => (
                  <MethodRow
                    icon={<provider.Icon />}
                    name={provider.name}
                    badge={<Badge variant="secondary">{m.settings_connected()}</Badge>}
                    detail={m.settings_connected_since({ date: date(account().createdAt) })}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={lastAccount()}
                      title={lastAccount() ? m.settings_disconnect_last() : undefined}
                      onClick={() => disconnect(provider)}
                    >
                      {m.settings_disconnect()}
                    </Button>
                  </MethodRow>
                )}
              </Show>
            )}
          </For>
          <Show when={linked('credential')}>
            <MethodRow
              icon={<KeyRoundIcon class="size-5 shrink-0" aria-hidden="true" />}
              name={m.settings_password()}
              badge={<Badge variant="outline">{m.settings_password_badge()}</Badge>}
              detail={m.settings_password_detail()}
            />
          </Show>
          <For each={passkeys.data}>
            {(passkey) => (
              <MethodRow
                icon={<KeyRoundIcon class="size-5 shrink-0" aria-hidden="true" />}
                name={passkey.name || m.settings_passkey()}
                detail={m.settings_passkey_added({ date: date(passkey.createdAt) })}
              >
                <Button variant="ghost" size="sm" onClick={() => removePasskey(passkey)}>
                  {m.settings_passkey_remove()}
                </Button>
              </MethodRow>
            )}
          </For>
          <Show when={props.methods.includes('passkey')}>
            <MethodRow
              icon={
                <KeyRoundIcon class="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
              }
              name={m.settings_passkey()}
              detail={m.settings_passkey_detail()}
            >
              <Button
                variant="outline"
                size="sm"
                disabled={addPasskey.isPending}
                onClick={() => addPasskey.mutate()}
              >
                <Show when={addPasskey.isPending} fallback={m.settings_passkey_add()}>
                  <LoaderCircleIcon class="animate-spin" aria-hidden="true" />
                  {m.sign_in_passkey_waiting()}
                </Show>
              </Button>
            </MethodRow>
          </Show>
        </ul>
      </Show>

      <Dialog open={confirmOpen()} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm()?.title}</DialogTitle>
            <DialogDescription>{confirm()?.description}</DialogDescription>
          </DialogHeader>
          <Show when={confirmAction.isError}>
            <Alert variant="destructive" role="alert">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>
                {actionError(confirmAction.error, m.error_unexpected)}
              </AlertDescription>
            </Alert>
          </Show>
          <DialogFooter class="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {m.settings_cancel()}
            </Button>
            <Button
              variant="destructive"
              disabled={confirmAction.isPending}
              onClick={() => confirmAction.mutate(confirm()!)}
            >
              {confirm()?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
