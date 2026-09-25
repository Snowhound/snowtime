// Where to go after sign-in: a path on this site from the `redirect` search parameter,
// never another origin. The target is resolved as the browser will resolve it, since the
// URL parser drops tabs and newlines and reads "\" as "/": "/\t/host" and "/\host" both
// mean "//host", which leaves the site.
const base = 'http://snowtime.invalid'

export function safeRedirect(target: string | undefined, fallback = '/') {
  if (!target?.startsWith('/')) return fallback
  let url: URL
  try {
    url = new URL(target, base)
  } catch {
    return fallback
  }
  if (url.origin !== base) return fallback
  return url.pathname + url.search + url.hash
}
