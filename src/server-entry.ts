import handler from '@tanstack/solid-start/server-entry'
import { paraglideMiddleware } from '~/paraglide/server.js'
import { contentSecurityPolicy, newNonce } from '~/server/csp.server'

// Scopes the locale to each request, so messages rendered on the server use the request's
// cookie or Accept-Language even while requests run concurrently. Pages get a fresh CSP
// nonce, which getRouter reads from the request context and puts on every script.
export default {
  async fetch(request: Request) {
    const nonce = newNonce()
    const response = await paraglideMiddleware(request, () =>
      handler.fetch(request, { context: { nonce } }),
    )
    if (!response.headers.get('content-type')?.startsWith('text/html')) return response
    // A copy, because a response's headers can be immutable.
    const page = new Response(response.body, response)
    page.headers.set('content-security-policy', contentSecurityPolicy(nonce))
    return page
  },
}
