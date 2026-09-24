import handler from '@tanstack/solid-start/server-entry'
import { paraglideMiddleware } from '~/paraglide/server.js'

// Scopes the locale to each request, so messages rendered on the server use the request's
// cookie or Accept-Language even while requests run concurrently.
export default {
  fetch(request: Request) {
    return paraglideMiddleware(request, () => handler.fetch(request))
  },
}
