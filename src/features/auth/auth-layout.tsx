import type { JSX } from 'solid-js'
import { Show } from 'solid-js'
import { AppMark } from '~/components/app-mark'
import { Separator } from '~/components/ui/separator'
import { DEFAULT_APP_ICON } from '~/lib/app-icon'
import { m } from '~/paraglide/messages.js'

// The signed-out screens' frame: a centered card on a muted background, with the product
// mark and the tagline (prototypes/auth.html, 01 · Card).
export function AuthLayout(props: { children: JSX.Element }) {
  return (
    <main class="bg-muted/40 flex min-h-dvh flex-col items-center justify-start gap-6 px-4 py-10 sm:justify-center sm:py-16">
      <div class="bg-card text-card-foreground flex w-full max-w-sm flex-col gap-6 rounded-lg border p-6 shadow-sm sm:p-8">
        {/* Signed out there is no app icon setting yet, so the card shows the default. */}
        <div class="flex items-center gap-2 text-base font-bold tracking-[-0.02em]">
          <AppMark id={DEFAULT_APP_ICON} small class="size-7" />
          {m.app_name()}
        </div>
        <div class="flex flex-col gap-6">{props.children}</div>
      </div>
      <p class="text-muted-foreground text-center text-sm">{m.auth_tagline()}</p>
    </main>
  )
}

export function AuthHeading(props: { title: string; description?: string }) {
  return (
    <div class="flex flex-col gap-1.5">
      <h1 class="text-2xl font-semibold tracking-tight">{props.title}</h1>
      <Show when={props.description}>
        <p class="text-muted-foreground text-sm">{props.description}</p>
      </Show>
    </div>
  )
}

// The round badge above a status screen's heading (expired, wrong account).
export function AuthIcon(props: { children: JSX.Element }) {
  return (
    <div class="bg-muted flex size-12 items-center justify-center rounded-full [&_svg]:size-6">
      {props.children}
    </div>
  )
}

export function AuthDivider() {
  return (
    <div class="text-muted-foreground flex items-center gap-3 text-xs uppercase">
      <Separator class="flex-1" />
      <span>{m.auth_or()}</span>
      <Separator class="flex-1" />
    </div>
  )
}
