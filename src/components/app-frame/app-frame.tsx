import { useQuery, useQueryClient } from '@tanstack/solid-query'
import { useMatches } from '@tanstack/solid-router'
import { type ParentProps, createContext, onMount, useContext } from 'solid-js'
import { Intro, IntroPage } from '~/components/intro'
import { SceneLayer } from '~/components/scene-layer'
import { introDue, introScene, playIntro, releaseIntroPending } from '~/lib/intro'
import { SCENE_DEFAULTS, currentSeason, sceneAttributes } from '~/lib/scene'
import { SeasonProvider } from '~/lib/seasons'
import { sessionQuery } from '~/lib/session'
import { cn } from '~/lib/utils'
import { getLocale } from '~/paraglide/runtime.js'
import type { AppSession } from '~/server/auth/auth.functions'
import { getSettings } from '~/server/settings/settings.functions'
import { AppHeader } from './app-header'
import { PasskeyPrompt } from './passkey-prompt'

// The organization of the app frame a component renders in, undefined outside one, so a page
// that picks its own frame, such as the error page, doesn't add a second one.
const InAppFrame = createContext<() => string | undefined>(() => undefined)

export function useInAppFrame() {
  return useContext(InAppFrame)
}

// The frame of an organization's pages: `organizationId` is the one the tab's URL names.
export function AppFrame(props: ParentProps<{ session: AppSession; organizationId: string }>) {
  const queryClient = useQueryClient()
  const session = useQuery(() => sessionQuery)
  function organizationId() {
    return props.organizationId
  }
  // A wide page, such as Reports, lays out its own width within the whole window.
  const wide = useMatches({ select: (matches) => matches.some((m) => m.staticData.wide) })
  // The session query, not the route's copy, so a saved setting shows at once.
  function scene() {
    return session.data?.settings ?? SCENE_DEFAULTS
  }
  // While the intro plays, the scene follows it.
  function shown() {
    return introScene(scene())
  }

  // The intro plays on the first page opened in a calendar season it hasn't played in.
  onMount(() => {
    if (introDue('app', scene().sceneIntro)) {
      playIntro({ season: currentSeason(scene().sceneSeason) })
    } else releaseIntroPending()
  })

  // The first getSettings call creates the user's settings from the browser's time zone
  // and language (docs/architecture.md, "User settings"); the server can't know the zone.
  onMount(async () => {
    if (props.session.settings) return
    await getSettings({
      data: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: getLocale() },
    })
    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey })
  })

  return (
    <div class="isolate flex min-h-dvh flex-col" {...sceneAttributes(shown())}>
      <SceneLayer settings={shown()} pace="calm" />
      <IntroPage class="flex flex-1 flex-col">
        <AppHeader organizationId={props.organizationId} />
        <SeasonProvider value={() => currentSeason(scene().sceneSeason)}>
          <main class={cn('mx-auto w-full flex-1 px-4 py-6 sm:px-8', !wide() && 'max-w-6xl')}>
            <PasskeyPrompt signedInAt={props.session.signedInAt} />
            <InAppFrame.Provider value={organizationId}>{props.children}</InAppFrame.Provider>
          </main>
        </SeasonProvider>
      </IntroPage>
      <Intro />
    </div>
  )
}
