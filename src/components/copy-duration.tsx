// A duration that copies itself (prototypes/copy-durations.html), formatted from its
// milliseconds with the copyDurationPattern setting rather than as shown. The
// copyDurationControl setting picks how: a click on the duration, or a copy button beside it.
// A bubble shows the copied text for a moment, and CopyAnnouncer reads the same aloud.
import CheckIcon from 'lucide-solid/icons/check'
import CopyIcon from 'lucide-solid/icons/copy'
import XIcon from 'lucide-solid/icons/x'
import { type JSX, Show, createSignal, onCleanup } from 'solid-js'
import { useCopyControl, useCopyPattern, useFormatHours } from '~/lib/display-format'
import { formatDurationPattern } from '~/lib/duration-pattern'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { Duration } from './duration'

const SHOWN_MS = 2000

// One live region for every duration, rendered once by AppFrame, the shell of every signed-in
// page: it is in the page before the first copy (a region added along with its text often
// isn't read), and rows don't each have one. See docs/architecture/timer.md, "Copying
// durations".
const [status, setStatus] = createSignal('')

function announce(text: string) {
  // Cleared first and set in a later task, so the same text twice is read twice. A timer
  // rather than a frame, which a hidden page never paints.
  setStatus('')
  setTimeout(() => setStatus(text), 50)
}

export function CopyAnnouncer() {
  return (
    <p class="sr-only" aria-live="polite">
      {status()}
    </p>
  )
}

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

export function CopyDuration(props: {
  ms: number | null
  // The duration as shown, for the button's name.
  label: string
  // Left where a card would clip a bubble above, as in a day's header.
  side?: 'top' | 'left'
  class?: string
  children: JSX.Element
}) {
  const pattern = useCopyPattern()
  const control = useCopyControl()
  const [copied, setCopied] = createSignal<Copied | null>(null)
  let hide: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(hide))

  async function copy() {
    if (props.ms === null) return
    const text = formatDurationPattern(props.ms, pattern())
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
    return props.ms === null ? undefined : m.duration_copy({ duration: props.label })
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
                : 'right-0 bottom-full mb-1.5',
              'failed' in result() && 'text-destructive',
            )}
          >
            <Show when={'text' in result()} fallback={<XIcon class="size-3.5" />}>
              <CheckIcon class="size-3.5" />
            </Show>
            {message(result())}
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
            'hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring relative -mx-1 inline-flex cursor-copy items-center rounded-sm px-1 tabular-nums outline-none focus-visible:ring-2 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-inherit',
            props.class,
          )}
          disabled={props.ms === null}
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
        <span class="tabular-nums">{props.children}</span>
        <button
          type="button"
          class={cn(
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 disabled:invisible [&_svg]:size-3.5',
            'sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:group-hover/copy:opacity-100 sm:focus-visible:opacity-100',
            copied() && 'sm:opacity-100',
          )}
          disabled={props.ms === null}
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

// A total in the user's duration format (Duration), which copies like any other duration.
export function CopyableDuration(props: { ms: number; side?: 'top' | 'left'; class?: string }) {
  const formatHours = useFormatHours()
  return (
    <CopyDuration ms={props.ms} label={formatHours(props.ms)} side={props.side} class={props.class}>
      <Duration ms={props.ms} />
    </CopyDuration>
  )
}
