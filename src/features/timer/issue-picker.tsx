import { For, Show, createSignal, createUniqueId } from 'solid-js'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { Popover, PopoverContent } from '~/components/ui/popover'
import { TextField, TextFieldInput } from '~/components/ui/text-field'
import { parseTicket } from '~/lib/tickets'
import { m } from '~/paraglide/messages.js'

export function IssuePicker(props: {
  open: boolean
  anchor: HTMLElement | undefined
  tickets: readonly string[]
  returnFocus?: () => HTMLElement | undefined
  onClose: () => void
  onPick: (ticket: string) => void
}) {
  const titleId = createUniqueId()
  const inputId = createUniqueId()
  const errorId = createUniqueId()
  const [value, setValue] = createSignal('')
  const [invalid, setInvalid] = createSignal(false)
  let input: HTMLInputElement | undefined
  let interactedOutside = false

  function pick(ticket: string) {
    props.onClose()
    props.onPick(ticket)
  }

  function submit() {
    const ticket = parseTicket(value())
    if (ticket) pick(ticket)
    else setInvalid(true)
  }

  return (
    <Popover
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      anchorRef={() => props.anchor}
      placement="bottom-start"
    >
      <PopoverContent
        data-issue-picker
        class="grid w-80 max-w-[calc(100vw-1rem)] gap-3"
        aria-labelledby={titleId}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          setValue('')
          setInvalid(false)
          input?.focus()
        }}
        onInteractOutside={() => {
          interactedOutside = true
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!interactedOutside) {
            const target = props.returnFocus?.() ?? props.anchor
            if (target?.isConnected) target.focus()
          }
          interactedOutside = false
        }}
      >
        <h2 id={titleId} class="font-medium">
          {m.ticket_add()}
        </h2>
        <div class="grid gap-1.5">
          <Label for={inputId}>{m.ticket_key_or_url()}</Label>
          <TextField
            value={value()}
            onChange={(value) => {
              setValue(value)
              setInvalid(false)
            }}
            validationState={invalid() ? 'invalid' : 'valid'}
          >
            <TextFieldInput
              id={inputId}
              ref={(el) => (input = el)}
              placeholder={m.ticket_key_placeholder()}
              autocomplete="off"
              aria-describedby={invalid() ? errorId : undefined}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.isComposing) return
                event.preventDefault()
                submit()
              }}
            />
          </TextField>
          <Show when={invalid()}>
            <p id={errorId} role="alert" class="text-destructive text-xs">
              {m.ticket_key_error()}
            </p>
          </Show>
        </div>
        <div class="grid gap-1">
          <p class="text-muted-foreground text-xs">{m.ticket_recent()}</p>
          <div class="grid max-h-48 overflow-y-auto">
            <For
              each={props.tickets}
              fallback={<p class="text-muted-foreground py-2 text-xs">{m.ticket_recent_empty()}</p>}
            >
              {(ticket) => (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="justify-start"
                  onClick={() => pick(ticket)}
                >
                  {ticket}
                </Button>
              )}
            </For>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => props.onClose()}>
            {m.entry_cancel()}
          </Button>
          <Button type="button" size="sm" onClick={submit}>
            {m.ticket_add()}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
