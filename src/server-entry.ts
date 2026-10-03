import handler from '@tanstack/solid-start/server-entry'
import { setTransport } from '~/lib/api/client'
import { paraglideMiddleware } from '~/paraglide/server.js'
import { renderTransport } from '~/server/api.server'
import { contentSecurityPolicy, newNonce } from '~/server/csp.server'
import { serverTiming, time, withTiming } from '~/server/timing.server'

// The route loaders' calls during a server render go to the API in process.
setTransport(renderTransport)

// Scopes the locale to each request, so messages rendered on the server use the request's
// cookie or Accept-Language even while requests run concurrently. Pages get a fresh CSP
// nonce, which getRouter reads from the request context and puts on every script, and the
// request's cookies, which src/lib/cookies.ts reads while the page renders. Start resolves
// the response once the loaders finish and streams the HTML after it, so a page's `render`
// time ends at its first byte.
export default {
  fetch(request: Request) {
    return withTiming(async () => {
      const nonce = newNonce()
      const cookie = request.headers.get('cookie') ?? ''
      const response = await time('render', () =>
        paraglideMiddleware(request, () => handler.fetch(request, { context: { nonce, cookie } })),
      )
      if (!response.headers.get('content-type')?.startsWith('text/html')) return response
      // A copy, because a response's headers can be immutable.
      const page = new Response(response.body, response)
      page.headers.set('content-security-policy', contentSecurityPolicy(nonce))
      page.headers.set('server-timing', serverTiming(['session', 'db', 'render']))
      return page
    })
  },
}
