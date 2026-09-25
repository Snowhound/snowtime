// The description field of the timer bar and the entry popover (prototypes/timer.html): a
// text field that lists recent work under it, following the WAI-ARIA combobox pattern. The
// list opens on focus and typing; arrows move through it, Enter or a click picks, and Escape
// closes only the list. Picking fills in the description and the project; typing never
// changes the project. Kobalte's Combobox isn't used: it has no controlled input value and
// clears or resets free text on Escape and blur.
import { For, Show, createMemo, createSignal, createUniqueId } from 'solid-js'
import type { JSX } from 'solid-js'
import { ProjectDot } from '~/components/project-dot'
import { TextField, TextFieldInput, TextFieldLabel } from '~/components/ui/text-field'
import type { Project } from '~/lib/projects'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { suggestWork } from './entries'
import type { Entry } from './queries'

export function DescriptionCombobox(props: {
  label: string
  labelClass?: string
  class?: string
  inputClass?: string
  placeholder: string
  value: string
  // The project in the form, or '' for none, so its pair isn't suggested again.
  projectId: string
  entries: readonly Entry[]
  projects: readonly Project[]
  disabled?: boolean
  onChange: (value: string) => void
  onPick: (entry: Entry) => void
  onBlur?: () => void
  // Keys the list doesn't take, such as Enter with nothing highlighted.
  onKeyDown?: (event: KeyboardEvent) => void
}) {
  const listId = createUniqueId()
  const [open, setOpen] = createSignal(false)
  const [active, setActive] = createSignal(-1)

  function pickable(projectId: string | null) {
    if (!projectId) return true
    const project = props.projects.find((p) => p.id === projectId)
    return !!project && !project.archivedAt
  }
  const items = createMemo(() =>
    suggestWork(
      props.entries,
      { description: props.value, projectId: props.projectId || null },
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
        <TextFieldInput
          class={props.inputClass}
          placeholder={props.placeholder}
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown()}
          aria-controls={shown() ? listId : undefined}
          aria-activedescendant={shown() && active() >= 0 ? `${listId}-${active()}` : undefined}
          onFocus={show}
          onBlur={() => {
            close()
            props.onBlur?.()
          }}
          onKeyDown={keyDown}
        />
      </TextField>
      <Show when={shown()}>
        <div
          id={listId}
          role="listbox"
          aria-label={m.entry_suggestions()}
          class="bg-popover text-popover-foreground absolute top-full left-0 z-50 mt-1 max-h-80 w-full min-w-72 overflow-y-auto rounded-md border p-1 shadow-md"
          // Keeps focus in the input, so a click doesn't blur it and close the list first.
          onMouseDown={(event) => event.preventDefault()}
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
      </Show>
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
