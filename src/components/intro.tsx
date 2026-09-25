import RotateCcwIcon from 'lucide-solid/icons/rotate-ccw'
// The seasonal intro's overlay and the page under it (src/lib/intro.ts). Each frame renders
// `Intro` and wraps its page in `IntroPage`. The overlay renders into <body>, outside the frame,
// so the frame's styles for controls over the image don't reach Skip intro.
import { For, type JSX, Show, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { Button } from '~/components/ui/button'
import { intro, playIntro, setIntroSkipButton, skipIntro } from '~/lib/intro'
import { type Season, createReducedMotion } from '~/lib/scene'
import { SEASON_COPY } from '~/lib/seasons'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && intro.playing()) skipIntro()
}

function colors() {
  return SEASON_COPY[intro.season()].colors
}

export function Intro() {
  onMount(() => {
    addEventListener('keydown', onKeyDown)
    onCleanup(() => removeEventListener('keydown', onKeyDown))
  })

  return (
    <Show when={intro.open()}>
      <Portal>
        <section
          class={cn('intro', intro.done() && 'intro-done')}
          aria-label={m.intro_label()}
          style={{
            '--intro-title': colors().title,
            '--intro-sub': colors().sub,
            '--intro-accent': colors().accent,
          }}
        >
          <div class={cn('intro-fade', intro.revealed() && 'reveal')} />
          <div class="intro-block">
            <For each={intro.lines()}>
              {(line, i) => (
                <p class={cn('intro-line', `intro-line-${i() + 1}`, intro.shown() > i() && 'show')}>
                  {line}
                </p>
              )}
            </For>
          </div>
          <Button
            ref={setIntroSkipButton}
            variant="outline"
            size="sm"
            class="intro-skip border-white/20 bg-black/40 text-white backdrop-blur hover:bg-black/60 hover:text-white"
            onClick={skipIntro}
          >
            {m.intro_skip()}
          </Button>
        </section>
      </Portal>
    </Show>
  )
}

// The page under the intro: hidden and inert while it plays, then it rises into place. It stays
// mounted throughout.
export function IntroPage(props: { class?: string; children: JSX.Element }) {
  return (
    <div
      class={cn(props.class, intro.pageActive() && 'intro-page')}
      data-intro-hidden={intro.playing() ? '' : undefined}
      inert={intro.playing() || undefined}
    >
      {props.children}
    </div>
  )
}

// Replay intro, for the Appearance menus. It's disabled with reduced motion, when the intro
// doesn't play. `onPlay` closes the menu; focus returns to `focus()` after the intro.
export function ReplayIntroButton(props: {
  season: Season
  signedIn: boolean
  focus: () => HTMLElement | undefined
  onPlay: () => void
  class?: string
}) {
  const reducedMotion = createReducedMotion()
  function replay() {
    props.onPlay()
    playIntro({ season: props.season, signedIn: props.signedIn, focus: props.focus() })
  }
  return (
    <Button
      variant="outline"
      size="sm"
      class={cn('h-8', props.class)}
      disabled={reducedMotion()}
      title={reducedMotion() ? m.scene_reduced_motion() : undefined}
      onClick={replay}
    >
      <RotateCcwIcon aria-hidden="true" />
      {m.intro_replay()}
    </Button>
  )
}
