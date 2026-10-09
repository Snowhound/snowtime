// Personal API keys for clients outside the browser (prototypes/settings.html). The
// list names each key and shows no part of it; the key itself appears once, when it's created.
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import KeyRoundIcon from 'lucide-solid/icons/key-round'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import PlusIcon from 'lucide-solid/icons/plus'
import { For, Show, createSignal } from 'solid-js'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { errorMessage } from '~/lib/errors'
import { formatDateTime } from '~/lib/format'
import { useQuery } from '~/lib/queries/use-query'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import type { ApiKey } from '~/server/auth/auth.schemas'
import { CreateKeyDialog } from './create-key-dialog'
import { apiKeysQuery, useRevokeApiKey } from './queries'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
// A key expiring this soon says so in relative time.
const EXPIRES_SOON = 7 * DAY

// "4 minutes ago", "in 3 days": the nearest unit, in the UI language.
export function relativeTime(at: number, now: number) {
  const diff = at - now
  const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' })
  if (Math.abs(diff) < HOUR) return format.format(Math.round(diff / MINUTE), 'minute')
  if (Math.abs(diff) < DAY) return format.format(Math.round(diff / HOUR), 'hour')
  return format.format(Math.round(diff / DAY), 'day')
}

function isExpired(key: ApiKey, now: number) {
  return key.expiresAt !== null && new Date(key.expiresAt).getTime() <= now
}

export function ApiKeysCard(props: { timeZone: string }) {
  const keys = useQuery(() => apiKeysQuery)
  const revoke = useRevokeApiKey()
  const [creating, setCreating] = createSignal(false)
  const [status, setStatus] = createSignal('')
  // The key being revoked; it stays while the dialog closes, so its text doesn't blank out.
  const [revoking, setRevoking] = createSignal<ApiKey | null>(null)
  const [confirmOpen, setConfirmOpen] = createSignal(false)
  // A revoked key's row leaves with its button, so focus goes to Create key instead.
  let createButton: HTMLButtonElement | undefined
  let revoked = false

  function date(at: Date | string) {
    return formatDateTime(new Date(at), props.timeZone, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  function askRevoke(key: ApiKey) {
    revoke.reset()
    revoked = false
    setRevoking(key)
    setConfirmOpen(true)
  }

  function confirmRevoke() {
    const key = revoking()
    if (!key) return
    setStatus('')
    revoked = true
    revoke.mutate(key, {
      onSuccess: () => setStatus(m.settings_api_key_revoked({ name: key.name })),
    })
    setConfirmOpen(false)
  }

  function revokingExpired() {
    const key = revoking()
    return key !== null && isExpired(key, Date.now())
  }

  return (
    <Card role="region" id="api-keys" class="scroll-mt-6" aria-labelledby="api-keys-title">
      <CardHeader>
        <div class="flex items-center justify-between gap-4">
          <CardTitle id="api-keys-title">{m.settings_api_keys()}</CardTitle>
          <Button
            ref={createButton}
            variant="outline"
            size="sm"
            class="shrink-0"
            aria-haspopup="dialog"
            onClick={() => {
              setStatus('')
              setCreating(true)
            }}
          >
            <PlusIcon aria-hidden="true" />
            {m.settings_api_keys_create()}
          </Button>
        </div>
        <CardDescription>{m.settings_api_keys_description()}</CardDescription>
      </CardHeader>
      <CardContent class="grid grid-cols-[minmax(0,1fr)] gap-3">
        <Show when={keys.error ?? (revoke.isError ? revoke.error : null)}>
          {(error) => (
            <Alert variant="destructive" role="alert">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{errorMessage(error())}</AlertDescription>
            </Alert>
          )}
        </Show>
        <Show
          when={keys.data}
          fallback={
            <Show when={!keys.isError}>
              <div class="text-muted-foreground flex items-center gap-2 rounded-md border px-4 py-3 text-sm">
                <LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
                {m.settings_api_keys_loading()}
              </div>
            </Show>
          }
        >
          {(list) => (
            <Show
              when={list().length > 0}
              fallback={
                <p class="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
                  {m.settings_api_keys_empty()}
                </p>
              }
            >
              <ul class="divide-y rounded-md border" aria-label={m.settings_api_keys_list()}>
                <For each={list()}>
                  {(key) => <KeyRow item={key} date={date} onRevoke={() => askRevoke(key)} />}
                </For>
              </ul>
            </Show>
          )}
        </Show>
        <p class="text-muted-foreground text-sm empty:hidden" aria-live="polite">
          {status()}
        </p>
      </CardContent>

      <CreateKeyDialog
        open={creating()}
        timeZone={props.timeZone}
        onClose={() => setCreating(false)}
      />

      <Dialog open={confirmOpen()} onOpenChange={setConfirmOpen}>
        <DialogContent
          onCloseAutoFocus={(event: Event) => {
            if (!revoked) return
            event.preventDefault()
            createButton?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {revokingExpired()
                ? m.settings_api_key_remove_title({ name: revoking()?.name ?? '' })
                : m.settings_api_key_revoke_title({ name: revoking()?.name ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {revokingExpired()
                ? m.settings_api_key_remove_description()
                : m.settings_api_key_revoke_description()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter class="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {m.settings_cancel()}
            </Button>
            <Button variant="destructive" onClick={confirmRevoke}>
              {revokingExpired()
                ? m.settings_api_key_remove_confirm()
                : m.settings_api_key_revoke_confirm()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function KeyRow(props: {
  item: ApiKey
  date: (at: Date | string) => string
  onRevoke: () => void
}) {
  function expired() {
    return isExpired(props.item, Date.now())
  }

  function expiry() {
    const { expiresAt } = props.item
    if (expiresAt === null) return { text: m.settings_api_key_never_expires(), soon: false }
    if (expired()) {
      return { text: m.settings_api_key_expired_on({ date: props.date(expiresAt) }), soon: false }
    }
    const at = new Date(expiresAt).getTime()
    const now = Date.now()
    if (at - now < EXPIRES_SOON) {
      return { text: m.settings_api_key_expires({ date: relativeTime(at, now) }), soon: true }
    }
    return { text: m.settings_api_key_expires({ date: props.date(expiresAt) }), soon: false }
  }

  function lastUsed() {
    const at = props.item.lastUsedAt
    if (at === null) return m.settings_api_key_never_used()
    return m.settings_api_key_last_used({ when: relativeTime(new Date(at).getTime(), Date.now()) })
  }

  return (
    <li class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <div class="flex min-w-0 flex-1 items-start gap-3">
        <KeyRoundIcon
          class={cn(
            'mt-0.5 size-5 shrink-0',
            expired() ? 'text-muted-foreground/60' : 'text-muted-foreground',
          )}
          aria-hidden="true"
        />
        <div class="grid min-w-0 gap-0.5">
          <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            <span class="min-w-0 break-words">{props.item.name}</span>
            <Show
              when={expired()}
              fallback={
                <Badge variant="secondary">
                  {props.item.access === 'write'
                    ? m.settings_api_key_write()
                    : m.settings_api_key_read()}
                </Badge>
              }
            >
              <Badge variant="outline" class="border-destructive/50 text-destructive">
                {m.settings_api_key_expired()}
              </Badge>
            </Show>
          </div>
          <p class="text-muted-foreground text-sm">
            {m.settings_api_key_created({ date: props.date(props.item.createdAt) })} ·{' '}
            <span class={cn(expiry().soon && 'text-foreground font-medium')}>{expiry().text}</span>
          </p>
          <p class="text-muted-foreground text-sm">{lastUsed()}</p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            expired()
              ? m.settings_api_key_remove_label({ name: props.item.name })
              : m.settings_api_key_revoke_label({ name: props.item.name })
          }
          onClick={() => props.onRevoke()}
        >
          {expired() ? m.settings_api_key_remove() : m.settings_api_key_revoke()}
        </Button>
      </div>
    </li>
  )
}
