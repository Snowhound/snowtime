import { createHash, randomBytes } from 'node:crypto'

export function oauthEnv(url: string) {
  return {
    OAUTH_FAKE_PROVIDER: url,
    CLIENT_IP_HEADER: 'x-bench-ip',
    RENDERERS: '1',
    GOOGLE_CLIENT_ID: 'fake-google',
    GOOGLE_CLIENT_SECRET: 'fake-secret',
    GITHUB_CLIENT_ID: 'fake-github',
    GITHUB_CLIENT_SECRET: 'fake-secret',
    MICROSOFT_CLIENT_ID: 'fake-microsoft',
    MICROSOFT_CLIENT_SECRET: 'fake-secret',
  }
}
interface Grant {
  url: URL
  profile: Record<string, unknown>
  scopes: string
  used: boolean
}
export function startOAuthProvider() {
  const grants = new Map<string, Grant>()
  const tokens = new Map<string, Grant>()
  let exchanges = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url)
      if (url.pathname === '/issue') {
        const { authorizationURL, profile, scopes } = (await request.json()) as {
          authorizationURL: string
          profile: Record<string, unknown>
          scopes?: string
        }
        const auth = new URL(authorizationURL)
        if (
          auth.searchParams.get('code_challenge_method') !== 'S256' ||
          !auth.searchParams.get('state')
        )
          throw new Error('Missing PKCE/state')
        const code = randomBytes(24).toString('base64url')
        grants.set(code, {
          url: auth,
          profile,
          scopes: scopes ?? auth.searchParams.get('scope') ?? '',
          used: false,
        })
        return Response.json({ code })
      }
      if (url.pathname === '/stats') return Response.json({ exchanges })
      if (url.pathname !== '/proxy') return new Response('Not found', { status: 404 })
      const original = new URL(url.searchParams.get('url')!)
      if (original.pathname.endsWith('/token') || original.pathname.endsWith('/access_token')) {
        const form = new URLSearchParams(await request.text())
        const grant = grants.get(form.get('code') ?? '')
        if (
          !grant ||
          grant.used ||
          form.get('grant_type') !== 'authorization_code' ||
          form.get('redirect_uri') !== grant.url.searchParams.get('redirect_uri') ||
          form.get('client_id') !== grant.url.searchParams.get('client_id') ||
          form.get('client_secret') !== 'fake-secret' ||
          createHash('sha256')
            .update(form.get('code_verifier') ?? '')
            .digest('base64url') !== grant.url.searchParams.get('code_challenge')
        )
          return Response.json({ error: 'invalid_grant' }, { status: 400 })
        if (grant.profile.token_redirect && !original.searchParams.has('redirected')) {
          original.searchParams.set('redirected', 'true')
          return new Response(null, {
            status: 307,
            headers: {
              location: `${server.url.origin}/proxy?url=${encodeURIComponent(original.href)}`,
            },
          })
        }
        grant.used = true
        exchanges++
        const access = randomBytes(24).toString('base64url')
        tokens.set(access, grant)
        const jwt = `${Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(grant.profile)).toString('base64url')}.c2lnbmF0dXJl`
        return Response.json({
          access_token: access,
          refresh_token: 'fake-refresh',
          expires_in: grant.profile.token_expires_in ?? 3600,
          refresh_token_expires_in: grant.profile.token_expires_in ?? 7200,
          scope: grant.scopes,
          token_type: 'Bearer',
          id_token: jwt,
        })
      }
      const access = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
      const grant = tokens.get(access)
      if (original.hostname === 'graph.microsoft.com')
        return grant?.profile.graph_photo
          ? new Response(Buffer.alloc(2048, 42), { headers: { 'content-type': 'image/jpeg' } })
          : new Response(null, { status: 404 })
      if (!grant) return Response.json({ error: 'bad_token' }, { status: 401 })
      if (original.pathname === '/user/emails')
        return Response.json([
          { email: grant.profile.email, primary: true, verified: grant.profile.email_verified },
        ])
      if (original.pathname === '/user')
        return Response.json({
          ...grant.profile,
          avatar_url: grant.profile.picture,
          login: 'fake-login',
        })
      return new Response('Not found', { status: 404 })
    },
  })
  return { url: server.url.origin, stop: () => server.stop(true) }
}
