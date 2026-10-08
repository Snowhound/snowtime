import { RouterProvider } from '@tanstack/solid-router'
import { createRequestHandler, renderRouterToStream } from '@tanstack/solid-router/ssr/server'
import { sharedConfig } from 'solid-js'
import { setSend } from '~/lib/api/request'
import { extractLocaleFromRequest, overwriteGetLocale } from '~/paraglide/runtime.js'
import { getRouter } from '~/router'
import { contentSecurityPolicy } from '~/server/csp.server'
import { startInstance } from '~/start'
import { installClock } from './clock'
import type { PageInput, StartServerProps } from './contract'

let locale: PageInput['locale']
// The host adds the page's cookie and client address to each call, and drops other headers
// but Content-Type and Accept.
setSend(async (path, init) => {
  const headers = new Headers(init.headers)
  const answer = await Deno.core.ops.op_send({
    method: init.method ?? 'GET',
    path,
    headers: [...headers],
    body: init.body ? Array.from(new Uint8Array(await new Response(init.body).arrayBuffer())) : [],
  })
  return new Response(
    answer.body instanceof Uint8Array ? answer.body : new Uint8Array(answer.body),
    { status: answer.status, headers: answer.headers },
  )
})
overwriteGetLocale(() => locale ?? 'en')

globalThis.renderPage = async function (input: PageInput) {
  installClock(input.now)
  globalThis.renderContext = input
  const request = new Request(input.url, { method: input.method ?? 'GET', headers: input.headers })
  // The cookie, then Accept-Language, as Start's paraglideMiddleware reads them.
  locale = input.locale ?? extractLocaleFromRequest(request)
  const startOptions = await startInstance.getOptions()
  const response = await createRequestHandler({
    request,
    createRouter: () => {
      const router = getRouter()
      router.options.serializationAdapters = startOptions.serializationAdapters
      return router
    },
    getRouterManifest: () => globalThis.renderManifest,
  })(({ request, router, responseHeaders }) => {
    for (const match of router.state.matches) if (match.error) console.error(match.error)
    responseHeaders.set('content-security-policy', contentSecurityPolicy(input.nonce))
    responseHeaders.set('cache-control', 'no-store')
    return renderRouterToStream({
      request,
      router,
      responseHeaders,
      children: () => <StartServer router={router} />,
    })
  })
  Deno.core.ops.op_head(response.status, [...response.headers])
  if (response.body) {
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        Deno.core.ops.op_chunk(value)
      }
    } finally {
      reader.releaseLock()
    }
  }
  locale = undefined
  globalThis.renderContext = undefined
  // Solid's server render leaves its context set, which would keep this page's whole graph
  // alive until the next one.
  sharedConfig.context = undefined
}

function StartServer(props: StartServerProps) {
  return <RouterProvider router={props.router} />
}
