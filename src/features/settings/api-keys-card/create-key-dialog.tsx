// Creating an API key (prototypes/settings.html): a name, a lifetime, and access, then the new
// key, shown once with Copy. Closing the dialog drops the key, so it lives only as long as
// the dialog shows it.
import { createForm } from '@tanstack/solid-form'
import CheckIcon from 'lucide-solid/icons/check'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import CopyIcon from 'lucide-solid/icons/copy'
import { For, Show, createSignal } from 'solid-js'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'
import { NativeSelect } from '~/components/ui/native-select'
import {
  TextField,
  TextFieldDescription,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from '~/components/ui/text-field'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { errorMessage } from '~/lib/errors'
import { fieldError } from '~/lib/form'
import { formatDateTime } from '~/lib/format'
import { m } from '~/paraglide/messages.js'
import {
  API_KEY_LIFETIMES,
  API_KEY_NAME_MAX_LENGTH,
  ApiKeyName,
  type ApiKeyAccess,
  type ApiKeyLifetime,
} from '~/server/auth/auth.schemas'
import { useCreateApiKey } from './queries'

const DAY = 24 * 60 * 60 * 1000

const LIFETIMES: Record<ApiKeyLifetime, { label: () => string; ms: number | null }> = {
  '30d': { label: m.settings_api_key_lifetime_30d, ms: 30 * DAY },
  '90d': { label: m.settings_api_key_lifetime_90d, ms: 90 * DAY },
  '1y': { label: m.settings_api_key_lifetime_1y, ms: 365 * DAY },
  none: { label: m.settings_api_key_lifetime_none, ms: null },
}

const ACCESS: { value: ApiKeyAccess; label: () => string }[] = [
  { value: 'read', label: m.settings_api_key_read },
  { value: 'write', label: m.settings_api_key_write },
]

export function CreateKeyDialog(props: { open: boolean; timeZone: string; onClose: () => void }) {
  // The new key while the dialog shows it; null on the form.
  const [created, setCreated] = createSignal<{ name: string; key: string } | null>(null)
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (open) return
        setCreated(null)
        props.onClose()
      }}
    >
      <DialogContent class="max-w-md grid-cols-[minmax(0,1fr)]">
        <Show
          when={created()}
          fallback={
            <Show when={props.open}>
              <KeyForm timeZone={props.timeZone} onCreated={setCreated} onCancel={props.onClose} />
            </Show>
          }
        >
          {(shown) => (
            <NewKey
              name={shown().name}
              value={shown().key}
              onDone={() => {
                setCreated(null)
                props.onClose()
              }}
            />
          )}
        </Show>
      </DialogContent>
    </Dialog>
  )
}

function KeyForm(props: {
  timeZone: string
  onCreated: (created: { name: string; key: string }) => void
  onCancel: () => void
}) {
  const create = useCreateApiKey()
  // The least access is preselected.
  const form = createForm(() => ({
    defaultValues: {
      name: '',
      lifetime: '90d' as ApiKeyLifetime,
      access: 'read' as ApiKeyAccess,
    },
    onSubmitInvalid: () => queueMicrotask(() => document.getElementById('api-key-name')?.focus()),
    onSubmit: async ({ value }) => {
      const name = value.name.trim()
      const { key } = await create.mutateAsync({
        name,
        lifetime: value.lifetime,
        access: value.access,
      })
      props.onCreated({ name, key })
    },
  }))
  const lifetime = form.useStore((state) => state.values.lifetime)
  const access = form.useStore((state) => state.values.access)

  function lifetimeHint() {
    const ms = LIFETIMES[lifetime()].ms
    if (ms === null) return m.settings_api_key_lifetime_hint_none()
    const date = formatDateTime(Date.now() + ms, props.timeZone, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    return m.settings_api_key_lifetime_hint({ date })
  }

  return (
    <form
      class="grid min-w-0 gap-4"
      novalidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit().catch(() => undefined)
      }}
    >
      <DialogHeader>
        <DialogTitle>{m.settings_api_key_create_title()}</DialogTitle>
        <DialogDescription>{m.settings_api_key_create_description()}</DialogDescription>
      </DialogHeader>
      <Show when={create.isError}>
        <Alert variant="destructive" role="alert">
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>{errorMessage(create.error)}</AlertDescription>
        </Alert>
      </Show>
      <form.Field name="name" validators={{ onSubmit: ApiKeyName }}>
        {(field) => (
          <TextField
            class="grid gap-2"
            value={field().state.value}
            onChange={field().handleChange}
            validationState={fieldError(field().state.meta.errors) ? 'invalid' : 'valid'}
          >
            <TextFieldLabel>{m.settings_api_key_name()}</TextFieldLabel>
            <TextFieldInput
              id="api-key-name"
              autocomplete="off"
              placeholder={m.settings_api_key_name_placeholder()}
              onBlur={field().handleBlur}
            />
            <TextFieldDescription class="text-muted-foreground text-xs">
              {m.settings_api_key_name_hint({ max: API_KEY_NAME_MAX_LENGTH })}
            </TextFieldDescription>
            <TextFieldErrorMessage>{fieldError(field().state.meta.errors)}</TextFieldErrorMessage>
          </TextField>
        )}
      </form.Field>
      <form.Field name="lifetime">
        {(field) => (
          <div class="grid gap-2">
            <Label for="api-key-lifetime">{m.settings_api_key_expiry()}</Label>
            <NativeSelect
              id="api-key-lifetime"
              aria-describedby="api-key-lifetime-hint"
              value={field().state.value}
              onChange={(event) =>
                field().handleChange(event.currentTarget.value as ApiKeyLifetime)
              }
            >
              <For each={API_KEY_LIFETIMES}>
                {(value) => (
                  <option value={value} selected={value === field().state.value}>
                    {LIFETIMES[value].label()}
                  </option>
                )}
              </For>
            </NativeSelect>
            <p id="api-key-lifetime-hint" class="text-muted-foreground text-xs">
              {lifetimeHint()}
            </p>
          </div>
        )}
      </form.Field>
      <form.Field name="access">
        {(field) => (
          <div class="grid gap-2">
            <span class="text-sm leading-none font-medium" id="api-key-access-label">
              {m.settings_api_key_access()}
            </span>
            <ToggleGroup
              variant="outline"
              class="justify-start"
              aria-labelledby="api-key-access-label"
              aria-describedby="api-key-access-hint"
              value={field().state.value}
              onChange={(value) => value && field().handleChange(value as ApiKeyAccess)}
            >
              <For each={ACCESS}>
                {(option) => (
                  <ToggleGroupItem value={option.value}>{option.label()}</ToggleGroupItem>
                )}
              </For>
            </ToggleGroup>
            <p id="api-key-access-hint" class="text-muted-foreground text-xs">
              {access() === 'write'
                ? m.settings_api_key_access_write_hint()
                : m.settings_api_key_access_read_hint()}
            </p>
          </div>
        )}
      </form.Field>
      <DialogFooter class="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={() => props.onCancel()}>
          {m.settings_cancel()}
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {m.settings_api_keys_create()}
        </Button>
      </DialogFooter>
    </form>
  )
}

function NewKey(props: { name: string; value: string; onDone: () => void }) {
  const [copy, setCopy] = createSignal<'idle' | 'copied' | 'failed'>('idle')
  async function copyKey() {
    try {
      await navigator.clipboard.writeText(props.value)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }
  return (
    <div class="grid min-w-0 gap-4">
      <DialogHeader>
        <DialogTitle>{m.settings_api_key_new_title()}</DialogTitle>
        <DialogDescription>{m.settings_api_key_new_description()}</DialogDescription>
      </DialogHeader>
      <TextField class="grid gap-2" value={props.value} readOnly>
        <TextFieldLabel>{props.name}</TextFieldLabel>
        <div class="flex gap-2">
          <TextFieldInput
            id="api-key-value"
            spellcheck={false}
            class="min-w-0 flex-1 font-mono text-xs"
            ref={(input: HTMLInputElement) => queueMicrotask(() => input.select())}
            onFocus={(event: FocusEvent) => (event.currentTarget as HTMLInputElement).select()}
          />
          <Button type="button" variant="outline" class="shrink-0" onClick={() => void copyKey()}>
            <Show
              when={copy() === 'copied'}
              fallback={
                <>
                  <CopyIcon aria-hidden="true" />
                  {m.settings_api_key_copy()}
                </>
              }
            >
              <CheckIcon aria-hidden="true" />
              {m.settings_api_key_copied()}
            </Show>
          </Button>
        </div>
        <p class="text-muted-foreground text-xs" aria-live="polite">
          {copy() === 'copied'
            ? m.settings_api_key_copied_status()
            : copy() === 'failed'
              ? m.settings_api_key_copy_failed()
              : ''}
        </p>
      </TextField>
      <DialogFooter>
        <Button type="button" onClick={() => props.onDone()}>
          {m.settings_api_key_done()}
        </Button>
      </DialogFooter>
    </div>
  )
}
