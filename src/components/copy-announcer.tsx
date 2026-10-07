import { createSignal } from 'solid-js'

// One live region for every duration, rendered once by AppFrame, the shell of every signed-in
// page: it is in the page before the first copy (a region added along with its text often
// isn't read), and rows don't each have one. See docs/architecture/timer.md, "Copying
// durations".
const [status, setStatus] = createSignal('')

export function announce(text: string) {
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
