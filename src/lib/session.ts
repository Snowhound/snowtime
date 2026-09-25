import { type QueryClient, queryOptions } from '@tanstack/solid-query'
import { getAppSession } from '~/server/auth/auth.functions'
import { DEVICE_SETTINGS_KEY } from './device-settings'
import { INTRO_PENDING_TIMEOUT, INTRO_SEASON_KEY, INTRO_SEEN_KEY } from './intro'
import { seasonByMonth } from './scene'

// The signed-in user, their organizations and settings, or null when signed out. The root
// route loads it before every page; changes to the session (switching organization,
// signing out, saving the theme) update or invalidate this query.
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: () => getAppSession(),
})

// After signing out: the session becomes null and every other query, all of them the user's
// data, is dropped. The session query itself stays in the cache, because the root watches it:
// clearing it would leave the root on a query the cache no longer holds, and the next sign-in's
// invalidation wouldn't refetch the session, so the new user stayed on the sign-in page.
export function forgetSignedInUser(queryClient: QueryClient) {
  queryClient.setQueryData(sessionQuery.queryKey, null)
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== sessionQuery.queryKey[0],
  })
}

// The season of each month, for the head script.
const MONTH_SEASONS = Array.from({ length: 12 }, (_, month) => seasonByMonth(new Date(2000, month)))

// The signed-in pages, where the intro plays once a season (src/routes/_app/).
const APP_PATHS = /^\/(timer|reports|projects|organization|settings)(\/|$)/

// Runs in <head> before the body paints. Signed in, the server renders the theme setting as
// data-theme on <html>; signed out it renders none, and the theme saved on this device applies
// (src/lib/device-settings.ts) until the root sets data-theme from it after hydration. This
// applies the `dark` class, resolving "system" with the browser's preference, and follows later
// changes to either.
//
// When the intro is due on this page by the device's settings (src/lib/intro.ts), it marks
// <html data-intro="pending">, which paints the page black until the intro starts; the frame
// clears it if the account's settings say otherwise, and a timeout clears it if nothing mounts.
// While <html> has data-intro, the page is dark.
export const themeScript = `(() => {
  const root = document.documentElement
  const dark = matchMedia('(prefers-color-scheme: dark)')
  let stored = {}
  try {
    stored = JSON.parse(localStorage.getItem(${JSON.stringify(DEVICE_SETTINGS_KEY)}) ?? '{}') ?? {}
  } catch {}
  try {
    const path = location.pathname
    const where = path === '/sign-in' ? 'sign-in' : ${APP_PATHS}.test(path) ? 'app' : null
    const due =
      where &&
      stored.sceneIntro !== false &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      (where === 'app'
        ? localStorage.getItem(${JSON.stringify(INTRO_SEASON_KEY)}) !== ${JSON.stringify(MONTH_SEASONS)}[new Date().getMonth()]
        : localStorage.getItem(${JSON.stringify(INTRO_SEEN_KEY)}) !== '1')
    if (due) {
      root.dataset.intro = 'pending'
      setTimeout(() => root.dataset.intro === 'pending' && delete root.dataset.intro, ${INTRO_PENDING_TIMEOUT})
    }
  } catch {}
  const theme = () => root.dataset.theme ?? stored.theme
  const apply = () =>
    root.classList.toggle('dark', root.dataset.intro !== undefined || theme() === 'dark' || (theme() !== 'light' && dark.matches))
  apply()
  dark.addEventListener('change', apply)
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-intro'] })
})()`
