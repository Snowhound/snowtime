import ClockIcon from 'lucide-solid/icons/clock'
import type { JSX } from 'solid-js'
import { Show } from 'solid-js'
import { m } from '../../paraglide/messages.js'
import { Separator } from '../ui/separator'

// The signed-out screens' frame: a centered card on a muted background, with the product
// mark and the tagline (prototypes/auth.html, 01 · Card).
export function AuthLayout(props: { children: JSX.Element }) {
  return (
    <main class="flex min-h-dvh flex-col items-center justify-start gap-6 bg-muted/40 px-4 py-10 sm:justify-center sm:py-16">
      <div class="flex w-full max-w-sm flex-col gap-6 rounded-lg border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <div class="flex items-center gap-2 text-sm font-medium">
          <ClockIcon class="size-5" aria-hidden="true" />
          {m.app_name()}
        </div>
        <div class="flex flex-col gap-6">{props.children}</div>
      </div>
      <p class="text-center text-sm text-muted-foreground">{m.auth_tagline()}</p>
    </main>
  )
}

export function AuthHeading(props: { title: string; description?: string }) {
  return (
    <div class="flex flex-col gap-1.5">
      <h1 class="text-2xl font-semibold tracking-tight">{props.title}</h1>
      <Show when={props.description}>
        <p class="text-sm text-muted-foreground">{props.description}</p>
      </Show>
    </div>
  )
}

// The round badge above a status screen's heading (expired, wrong account).
export function AuthIcon(props: { children: JSX.Element }) {
  return (
    <div class="flex size-12 items-center justify-center rounded-full bg-muted [&_svg]:size-6">
      {props.children}
    </div>
  )
}

export function AuthDivider() {
  return (
    <div class="flex items-center gap-3 text-xs uppercase text-muted-foreground">
      <Separator class="flex-1" />
      <span>{m.auth_or()}</span>
      <Separator class="flex-1" />
    </div>
  )
}
