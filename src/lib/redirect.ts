// Where to go after sign-in: a path on this site from the `redirect` search parameter,
// never another origin ("//host" or "/\host" would leave the site).
export function safeRedirect(target: string | undefined, fallback = '/') {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
    return fallback
  }
  return target
}
