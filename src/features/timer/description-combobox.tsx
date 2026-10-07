// The description field of the timer bar and the entry popover (prototypes/timer.html): a
// text field that lists recent work under it, following the WAI-ARIA combobox pattern. The
// list opens on focus and typing; arrows move through it, Enter or a click picks, and Escape
// closes only the list. Picking fills in the description, the ticket, and the project; typing
// never changes the project. The entry's ticket chip sits at the end of the field, which is
// drawn as one input around both. Kobalte's Combobox isn't used: it has no controlled input
// value and clears or resets free text on Escape and blur.
import { For, Show, createMemo, createSignal, createUniqueId } from 'solid-js'
import type { JSX } from 'solid-js'
import { ProjectDot } from '~/components/project-dot'
import { Button } from '~/components/ui/button'
import { TextField, TextFieldInput, TextFieldLabel } from '~/components/ui/text-field'
import type { Project } from '~/lib/queries/projects'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { recentTickets, suggestWork } from './entries'
import { IssuePicker } from './issue-picker'
import type { Entry } from './queries'
import { TicketLabel } from './ticket-chip'

export function DescriptionCombobox(props: {
  label: string
  labelClass?: string
  class?: string
  inputClass?: string
  placeholder: string
  value: string
  // The project and ticket in the form, '' and null for none, so their work isn't suggested
  // again.
  projectId: string
  ticket: string | null
  // The ticket's chip, at the end of the field.
  chip?: JSX.Element
  entries: readonly Entry[]
  projects: readonly Project[]
  disabled?: boolean
  ref?: (input: HTMLInputElement) => void
  onChange: (value: string) => void
  onPick: (entry: Entry) => void
  onAddTicket: (ticket: string) => void
  onBlur?: () => void
  // Keys the list doesn't take, such as Enter with nothing highlighted.
  onKeyDown?: (event: KeyboardEvent) => void
}) {
  const listId = createUniqueId()
  const [open, setOpen] = createSignal(false)
  const [active, setActive] = createSignal(-1)
  const [issueOpen, setIssueOpen] = createSignal(false)
  const [field, setField] = createSignal<HTMLDivElement>()
  let input: HTMLInputElement | undefined
  let quietFocus = false

  // The picker hangs from the field, since the suggestions' Add issue closes with them.
  function addIssue() {
    close()
    setIssueOpen(true)
  }

  function pickable(projectId: string | null) {
    if (!projectId) return true
    const project = props.projects.find((p) => p.id === projectId)
    return !!project && !project.archivedAt
  }
  const items = createMemo(() =>
    suggestWork(
      props.entries,
      { description: props.value, projectId: props.projectId || null, ticket: props.ticket },
      pickable,
    ),
  )
  function shown() {
    return open() && items().length > 0
  }

  function show() {
    setActive(-1)
    setOpen(true)
  }
  function close() {
    setOpen(false)
    setActive(-1)
  }
  function pick(entry: Entry) {
    close()
    props.onPick(entry)
  }

  function keyDown(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!shown()) return show()
      // Past either end, the highlight goes back to the input.
      const next = active() + (event.key === 'ArrowDown' ? 1 : -1)
      setActive(next >= items().length ? -1 : next < -1 ? items().length - 1 : next)
      document.getElementById(`${listId}-${active()}`)?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (event.key === 'Enter' && shown() && active() >= 0) {
      event.preventDefault()
      return pick(items()[active()])
    }
    if (event.key === 'Escape' && shown()) {
      // Keeps an entry popover around the field from closing too.
      event.preventDefault()
      event.stopPropagation()
      return close()
    }
    props.onKeyDown?.(event)
  }

  return (
    <div class={cn('relative min-w-0', props.class)}>
      <TextField
        class="grid gap-1.5"
        value={props.value}
        onChange={(value) => {
          props.onChange(value)
          show()
        }}
        disabled={props.disabled}
      >
        <TextFieldLabel class={props.labelClass}>{props.label}</TextFieldLabel>
        <div
          ref={setField}
          data-input-field
          class={cn(
            'border-input ring-offset-background focus-within:ring-ring flex min-h-10 w-full min-w-0 cursor-text items-center gap-1 rounded-md border bg-transparent py-1 pr-1.5 pl-2 text-sm focus-within:ring-2 focus-within:ring-offset-2',
            props.disabled && 'cursor-not-allowed opacity-50',
            props.inputClass,
          )}
          // A click on the field's padding puts the caret in the text.
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return
            event.preventDefault()
            event.currentTarget.querySelector('input')?.focus()
          }}
        >
          <TextFieldInput
            ref={(el) => {
              input = el
              props.ref?.(el)
            }}
            class="h-8 min-w-24 flex-1 rounded-none border-0 py-0 pr-1.5 pl-1 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-100"
            placeholder={props.placeholder}
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={shown()}
            aria-controls={shown() ? listId : undefined}
            aria-activedescendant={shown() && active() >= 0 ? `${listId}-${active()}` : undefined}
            onFocus={() => {
              if (quietFocus) quietFocus = false
              else show()
            }}
            onBlur={() => {
              close()
              props.onBlur?.()
            }}
            onKeyDown={keyDown}
          />
          {props.chip}
          <Show when={!props.ticket && !props.disabled}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="text-muted-foreground h-7 shrink-0 px-2 text-xs"
              aria-haspopup="dialog"
              aria-expanded={issueOpen()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={addIssue}
            >
              {m.ticket_add()}
            </Button>
          </Show>
        </div>
      </TextField>
      <Show when={shown()}>
        <div
          class="bg-popover text-popover-foreground absolute top-full left-0 z-50 mt-1 w-full min-w-72 rounded-md border p-1 shadow-md"
          // Keeps focus in the input, so a click doesn't blur it and close the list first.
          onMouseDown={(event) => event.preventDefault()}
        >
          <div
            id={listId}
            role="listbox"
            aria-label={m.entry_suggestions()}
            class="max-h-72 overflow-y-auto"
          >
            <For each={items()}>
              {(entry, index) => (
                <Suggestion
                  id={`${listId}-${index()}`}
                  entry={entry}
                  query={props.value.trim()}
                  project={props.projects.find((p) => p.id === entry.projectId)}
                  active={active() === index()}
                  onHover={() => setActive(index())}
                  onPick={() => pick(entry)}
                />
              )}
            </For>
          </div>
          <Show when={!props.ticket}>
            <div class="mt-1 border-t pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="text-muted-foreground h-7 w-full justify-start px-2 text-xs"
                onClick={addIssue}
              >
                {m.ticket_add_keep_description()}
              </Button>
            </div>
          </Show>
        </div>
      </Show>
      <IssuePicker
        open={issueOpen()}
        anchor={field()}
        tickets={recentTickets(props.entries)}
        returnFocus={() => {
          quietFocus = true
          return input
        }}
        onClose={() => setIssueOpen(false)}
        onPick={props.onAddTicket}
      />
    </div>
  )
}

function Suggestion(props: {
  id: string
  entry: Entry
  query: string
  project: Project | undefined
  active: boolean
  onHover: () => void
  onPick: () => void
}) {
  return (
    <div
      id={props.id}
      role="option"
      aria-selected={props.active}
      class="aria-selected:bg-accent aria-selected:text-accent-foreground relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
      onMouseMove={() => !props.active && props.onHover()}
      onClick={() => props.onPick()}
    >
      <Show when={props.project}>{(p) => <ProjectDot color={p().color} />}</Show>
      <span class="min-w-0 flex-1 truncate">
        <Highlight text={props.entry.description} query={props.query} />
      </span>
      <Show when={props.entry.ticket}>
        {(ticket) => (
          <TicketLabel>
            <Highlight text={ticket()} query={props.query} />
          </TicketLabel>
        )}
      </Show>
      <Show when={props.project}>
        {(p) => (
          <span class="text-muted-foreground max-w-[40%] shrink-0 truncate text-xs">
            {p().name}
          </span>
        )}
      </Show>
    </div>
  )
}

// The text with the first match of the query in bold.
function Highlight(props: { text: string; query: string }): JSX.Element {
  function at() {
    return props.query
      ? props.text.toLocaleLowerCase().indexOf(props.query.toLocaleLowerCase())
      : -1
  }
  return (
    <Show when={at() >= 0} fallback={props.text}>
      {props.text.slice(0, at())}
      <span class="font-semibold">{props.text.slice(at(), at() + props.query.length)}</span>
      {props.text.slice(at() + props.query.length)}
    </Show>
  )
}
