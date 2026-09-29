// The General tab: the organization's name, its short name, which can't change, where ticket
// keys link (Issue links), and a note that organizations can't be deleted
// (disableOrganizationDeletion in better-auth.server.ts).
import { createForm } from '@tanstack/solid-form'
import InfoIcon from 'lucide-solid/icons/info'
import { For, createSignal } from 'solid-js'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '~/components/ui/card'
import {
  TextField,
  TextFieldDescription,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from '~/components/ui/text-field'
import { fieldError } from '~/lib/form'
import { m } from '~/paraglide/messages.js'
import {
  ISSUE_LINKS_MAX_LENGTH,
  IssueLinks,
  NAME_MAX_LENGTH,
  Name,
} from '~/server/auth/auth.schemas'

// The hint with {key} set as code, as the address has it.
function IssueLinksHint() {
  const parts = m.organization_issue_links_hint({ key: '\u0000' }).split('\u0000')
  return (
    <For each={parts}>
      {(part, i) => (
        <>
          {i() > 0 && <code class="font-mono">{'{key}'}</code>}
          {part}
        </>
      )}
    </For>
  )
}

export function GeneralTab(props: {
  name: string
  slug: string
  issueLinks: string | null
  // Only the changed fields; `done` runs once they are saved.
  onSave: (changes: { name?: string; issueLinks?: string | null }, done: () => void) => void
}) {
  const [status, setStatus] = createSignal<string | null>(null)

  const form = createForm(() => ({
    defaultValues: { name: props.name, issueLinks: props.issueLinks ?? '' },
    onSubmitInvalid: ({ formApi }) =>
      queueMicrotask(() => {
        const field = formApi.getFieldMeta('name')?.errors.length ? 'org-name' : 'org-issue-links'
        document.getElementById(field)?.focus()
      }),
    onSubmit: ({ value, formApi }) => {
      const name = value.name.trim()
      const issueLinks = value.issueLinks.trim() || null
      formApi.reset({ name, issueLinks: issueLinks ?? '' })
      props.onSave(
        {
          ...(name !== props.name ? { name } : {}),
          ...(issueLinks !== props.issueLinks ? { issueLinks } : {}),
        },
        () => setStatus(m.organization_saved()),
      )
    },
  }))
  const unchanged = form.useStore(
    (state) =>
      state.values.name.trim() === props.name &&
      (state.values.issueLinks.trim() || null) === props.issueLinks,
  )

  return (
    <Card class="max-w-2xl">
      <form
        novalidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <CardHeader>
          <h2 class="text-lg leading-none font-semibold tracking-tight">
            {m.organization_general()}
          </h2>
          <CardDescription>{m.organization_general_description()}</CardDescription>
        </CardHeader>
        <CardContent class="grid grid-cols-[minmax(0,1fr)] gap-4">
          <form.Field name="name" validators={{ onSubmit: Name }}>
            {(field) => (
              <TextField
                class="grid gap-2"
                value={field().state.value}
                onChange={(value) => {
                  setStatus(null)
                  field().handleChange(value)
                }}
                validationState={fieldError(field().state.meta.errors) ? 'invalid' : 'valid'}
              >
                <TextFieldLabel>{m.organization_name()}</TextFieldLabel>
                <TextFieldInput
                  id="org-name"
                  autocomplete="organization"
                  maxLength={NAME_MAX_LENGTH}
                  onBlur={field().handleBlur}
                />
                <TextFieldErrorMessage>
                  {fieldError(field().state.meta.errors)}
                </TextFieldErrorMessage>
              </TextField>
            )}
          </form.Field>
          <TextField class="grid gap-2" value={props.slug} readOnly>
            <TextFieldLabel>{m.organization_slug()}</TextFieldLabel>
            <TextFieldInput class="bg-muted/50 text-muted-foreground" />
            <TextFieldDescription class="text-xs">
              {m.organization_slug_hint()}
            </TextFieldDescription>
          </TextField>
          <form.Field name="issueLinks" validators={{ onSubmit: IssueLinks }}>
            {(field) => (
              <TextField
                class="grid gap-2"
                value={field().state.value}
                onChange={(value) => {
                  setStatus(null)
                  field().handleChange(value)
                }}
                validationState={fieldError(field().state.meta.errors) ? 'invalid' : 'valid'}
              >
                <TextFieldLabel>{m.organization_issue_links()}</TextFieldLabel>
                <TextFieldInput
                  id="org-issue-links"
                  type="url"
                  inputMode="url"
                  autocomplete="off"
                  placeholder="https://yourcompany.atlassian.net/browse/{key}"
                  maxLength={ISSUE_LINKS_MAX_LENGTH}
                  onBlur={field().handleBlur}
                />
                <TextFieldDescription class="text-xs">
                  <IssueLinksHint />
                </TextFieldDescription>
                <TextFieldErrorMessage>
                  {fieldError(field().state.meta.errors)}
                </TextFieldErrorMessage>
              </TextField>
            )}
          </form.Field>
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertDescription>{m.organization_no_delete()}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter class="justify-end gap-3">
          <p class="text-muted-foreground text-sm" aria-live="polite">
            {status()}
          </p>
          <Button type="submit" disabled={unchanged()}>
            {m.organization_save()}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
