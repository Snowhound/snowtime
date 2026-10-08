// Redirect only installed providers' outbound HTTP calls to the local test provider.
const send = globalThis.fetch
const base = process.env.OAUTH_FAKE_PROVIDER
const hosts = new Set([
  'oauth2.googleapis.com',
  'www.googleapis.com',
  'api.github.com',
  'github.com',
  'login.microsoftonline.com',
  'graph.microsoft.com',
])
if (base) {
  const target = new URL(base)
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1')
    throw new Error('Fake OAuth provider must be loopback')
  globalThis.fetch = Object.assign(
    async function (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (!hosts.has(url.hostname)) return send(input, init)
      const request = new Request(input, init)
      return send(`${base}/proxy?url=${encodeURIComponent(url.href)}`, {
        method: request.method,
        headers: request.headers,
        body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
        redirect: request.redirect,
      })
    },
    { preconnect: send.preconnect },
  )
}
