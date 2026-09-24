import { queryOptions } from '@tanstack/solid-query'
import { getAppSession } from '../functions/auth'

// The signed-in user, their organizations and settings, or null when signed out. The root
// route loads it before every page; changes to the session (switching organization,
// signing out, saving the theme) update or invalidate this query.
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: () => getAppSession(),
})

// Signed-out pages and signed-in users without settings yet follow the system theme.
export type ThemeSetting = 'system' | 'light' | 'dark'

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
