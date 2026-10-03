// The request Paraglide's middleware picks the locale from (src/server-entry.ts). The HTTP
// API answers in English whatever the request's cookie or Accept-Language (docs/api.md,
// "Errors"), so for /api/v1 it gets a copy with neither, and falls back to English.
export function localeRequest(request: Request): Request {
  return new URL(request.url).pathname.startsWith('/api/v1/') ? new Request(request.url) : request
}
