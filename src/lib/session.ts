import { type QueryClient, queryOptions } from '@tanstack/solid-query'
import { getAppSession } from '~/server/auth/auth.functions'

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

// Runs in <head> before the body paints. The server renders the theme setting as
// data-theme on <html>; this applies the `dark` class from it, resolving "system" with
// the browser's preference, and follows later changes to either.
export const themeScript = `(() => {
  const root = document.documentElement
  const dark = matchMedia('(prefers-color-scheme: dark)')
  const apply = () => root.classList.toggle('dark', root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && dark.matches))
  apply()
  dark.addEventListener('change', apply)
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-theme'] })
})()`
