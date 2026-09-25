// The language cookie holds only a chosen language: the account's (docs/architecture.md,
// "Cookies and consent"). Paraglide's getLocale writes the cookie on its first call in the
// browser, even when the language only came from the browser's own preference, so a first
// visit would store one without anyone choosing it. This skips that write; the browser's
// language needs no cookie, since the server reads Accept-Language. Imported for its effect
// by the root route, before anything renders.
import {
  baseLocale,
  cookieName,
  extractLocaleFromNavigator,
  overwriteSetLocale,
  setLocale,
} from '~/paraglide/runtime.js'

// Whether setLocale should write the cookie: when one is already there, to change or renew
// it, or when the language differs from the browser's.
export function storesLocale(locale: string, cookie: string, preferred: string) {
  const hasCookie = cookie.split('; ').some((part) => part.startsWith(`${cookieName}=`))
  return hasCookie || locale !== preferred
}

if (typeof document !== 'undefined') {
  const paraglideSetLocale = setLocale
  overwriteSetLocale((locale, options) => {
    const preferred = extractLocaleFromNavigator() ?? baseLocale
    if (!storesLocale(locale, document.cookie, preferred)) return
    return paraglideSetLocale(locale, options)
  })
}
