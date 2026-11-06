// Text that copies itself. The copyDurationControl setting
// picks how: a click on the text, or a copy button beside it. `control` overrides it, where a
// click on the text does something else or where a button would crowd the text.
// A bubble shows the copied text for a moment, and CopyAnnouncer reads the same aloud.
import CheckIcon from 'lucide-solid/icons/check'
import CopyIcon from 'lucide-solid/icons/copy'
import XIcon from 'lucide-solid/icons/x'
import { type JSX, Show, createSignal, onCleanup } from 'solid-js'
import { useCopyControl } from '~/lib/display-format'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { announce } from './copy-announcer'

const SHOWN_MS = 2000

// A click doesn't move focus to the copy control: an entry row stays active while it holds
// focus (src/features/timer/row-activation.ts), which kept the row's hover controls showing
// after the pointer left. Keyboard focus is unchanged.
function keepFocus(event: MouseEvent) {
  event.preventDefault()
}

type Copied = { text: string } | { failed: true }

function message(result: Copied) {
  return 'text' in result ? m.duration_copied({ text: result.text }) : m.duration_copy_failed()
}

export function CopyText(props: {
  // What a click copies; null leaves nothing to copy.
  text: string | null
  // The button's name.
  label: string
  // Where the bubble shows: above, ending at the text's end (the default) or starting at its
  // start, where text near a card's left edge would clip it; or left of the text, where a card
  // would clip a bubble above, as in a day's header.
  side?: 'top' | 'start' | 'left'
  control?: 'text' | 'button'
  class?: string
  children: JSX.Element
}) {
  const setting = useCopyControl()
  function control() {
    return props.control ?? setting()
  }
  const [copied, setCopied] = createSignal<Copied | null>(null)
  let hide: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(hide))

  async function copy() {
    const text = props.text
    if (text === null) return
    let result: Copied
    try {
      await navigator.clipboard.writeText(text)
      result = { text }
    } catch {
      // The browser can refuse the clipboard: on a page without HTTPS, or without focus.
      result = { failed: true }
    }
    setCopied(result)
    announce(message(result))
    clearTimeout(hide)
    hide = setTimeout(() => setCopied(null), SHOWN_MS)
  }

  function label() {
    return props.text === null ? undefined : props.label
  }

  function Bubble() {
    return (
      <Show when={copied()}>
        {(result) => (
          <span
            aria-hidden="true"
            class={cn(
              'bg-popover text-popover-foreground pointer-events-none absolute z-20 flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap shadow-md',
              props.side === 'left'
                ? 'top-1/2 right-full mr-1.5 -translate-y-1/2'
                : props.side === 'start'
                  ? 'bottom-full left-0 mb-1.5'
                  : 'right-0 bottom-full mb-1.5',
              'failed' in result() && 'text-destructive',
            )}
          >
            <Show when={'text' in result()} fallback={<XIcon class="size-3.5" />}>
              <CheckIcon class="size-3.5" />
            </Show>
            <span class="max-w-80 truncate">{message(result())}</span>
          </span>
        )}
      </Show>
    )
  }

  return (
    <Show
      when={control() === 'button'}
      fallback={
        <button
          type="button"
          class={cn(
            'hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring relative -mx-1 inline-flex cursor-copy items-center rounded-sm px-1 outline-none focus-visible:ring-2 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-inherit',
            props.class,
          )}
          disabled={props.text === null}
          aria-label={label()}
          onMouseDown={keepFocus}
          onClick={() => void copy()}
        >
          {props.children}
          <Bubble />
        </button>
      }
    >
      {/* The button shows from 640 px only while the row or the duration is hovered or
          focused, like the rows' other controls; on touch screens it always shows. */}
      <span class={cn('group/copy relative inline-flex items-center gap-0.5', props.class)}>
        <span class="min-w-0">{props.children}</span>
        <button
          type="button"
          class={cn(
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 disabled:invisible [&_svg]:size-3.5',
            'sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:group-hover/copy:opacity-100 sm:focus-visible:opacity-100',
            copied() && 'sm:opacity-100',
          )}
          disabled={props.text === null}
          aria-label={label()}
          onMouseDown={keepFocus}
          onClick={() => void copy()}
        >
          <Show when={copied() && 'text' in copied()!} fallback={<CopyIcon aria-hidden="true" />}>
            <CheckIcon aria-hidden="true" />
          </Show>
        </button>
        <Bubble />
      </span>
    </Show>
  )
}
