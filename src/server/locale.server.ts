// The request Paraglide's middleware picks the locale from (src/server-entry.ts). The JSON
// API answers a key's requests in English whatever their cookie or Accept-Language
// (docs/api.md, "Errors"), so such a request gets a copy with neither, and falls back to
// English. The app's own calls keep the user's language.
import { bearerKey } from './auth/api-keys.server'

export function localeRequest(request: Request): Request {
  const api = new URL(request.url).pathname.startsWith('/api/v1/')
  return api && bearerKey(request.headers) ? new Request(request.url) : request
}
