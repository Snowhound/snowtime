import { createHmac } from 'node:crypto'
import { signInHeaders } from '../perf/lib/app'
import { USERS } from '../perf/lib/database'

function profile(email: string, verified = true, id = 'oauth-user') {
  return {
    sub: id,
    oid: id,
    id: id,
    email,
    email_verified: verified,
    name: 'Provider Name',
    picture: 'https://example.com/avatar.png',
    tid: 'fake-tenant',
  }
}

export interface OAuthObservation {
  label: string
  status: number
  expected: number
  text: string
}
export async function oauthFlow(
  app: { url: string },
  provider: string,
  observe: (result: OAuthObservation) => void,
) {
  let cookie = ''
  const ids = new Map<string, string>()
  const secrets = new Map<string, string>()
  let state = ''
  let authURL = ''
  let accountId = ''
  const fake = process.env.OAUTH_FAKE_PROVIDER ?? provider
  function mask(text: string) {
    let result = text.replaceAll(app.url, '$HOST').replaceAll(encodeURIComponent(app.url), '$HOST')
    for (const [from, to] of secrets) result = result.replaceAll(from, to)
    result = result.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g,
      (id) => {
        if (!ids.has(id)) ids.set(id, `$id${ids.size}`)
        return ids.get(id)!
      },
    )
    return result
  }
  function setCookies(response: Response) {
    const jar = new Map(
      cookie
        .split('; ')
        .filter(Boolean)
        .map((p) => {
          const i = p.indexOf('=')
          return [p.slice(0, i), p.slice(i + 1)]
        }),
    )
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0]
      const i = pair.indexOf('=')
      const name = pair.slice(0, i)
      const value = pair.slice(i + 1)
      // Native checks the persisted row rather than Better Auth's optional session cache.
      if (name.includes('session_data')) continue
      if (header.includes('Max-Age=0')) jar.delete(name)
      else jar.set(name, value)
      if (name === 'better-auth.state' && value) {
        const signed = decodeURIComponent(value)
        const at = signed.lastIndexOf('.')
        const expected = createHmac('sha256', 'perf-harness-secret-perf-harness-secret')
          .update(signed.slice(0, at))
          .digest('base64')
        if (
          signed.slice(at + 1) !== expected ||
          signed.slice(0, at) !== state ||
          !header.includes('Max-Age=300')
        )
          throw new Error('OAuth state cookie is not bound/signed')
      }
    }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  async function call(
    label: string,
    path: string,
    body: unknown,
    expected: number,
    options: { method?: string; cookie?: string; origin?: string; raw?: string } = {},
  ) {
    const response = await fetch(
      `${app.url}${path.startsWith('/api/') ? path : `/api/auth${path}`}`,
      {
        method: options.method ?? (body === undefined ? 'GET' : 'POST'),
        headers: {
          'content-type': options.raw ? 'application/x-www-form-urlencoded' : 'application/json',
          origin: options.origin ?? app.url,
          cookie: options.cookie ?? cookie,
          'x-bench-ip': '192.0.2.81',
          'user-agent': 'oauth-conformance',
        },
        body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
        redirect: 'manual',
      },
    )
    let text = await response.text()
    if (path === '/sign-in/social' || path === '/link-social') {
      if (response.ok) {
        const started = JSON.parse(text)
        authURL = started.url
        const url = new URL(authURL)
        state = url.searchParams.get('state')!
        const challenge = url.searchParams.get('code_challenge')!
        if (!/^[a-zA-Z0-9_-]{32}$/.test(state) || !/^[a-zA-Z0-9_-]{43}$/.test(challenge))
          throw new Error('Invalid state/PKCE')
        secrets.set(state, '$state')
        secrets.set(challenge, '$pkce')
      }
    }
    setCookies(response)
    if (path === '/list-accounts' && response.ok) {
      const accounts = JSON.parse(text)
      const social = accounts.find((a: { providerId: string }) => a.providerId !== 'credential')
      if (social) accountId = social.id
      for (const a of accounts)
        if (a.providerId !== 'credential') {
          text = text.replaceAll(a.createdAt, '$created').replaceAll(a.updatedAt, '$updated')
        }
    }
    if (path === '/api/v1/session' && response.ok) {
      const session = JSON.parse(text)
      if (!session?.user?.email) throw new Error('OAuth session is not usable by the app')
      if (
        label === 'existing profile and membership preserved' &&
        (session.user.email !== USERS.admin.email ||
          session.user.name === 'Provider Name' ||
          session.organizations.length === 0)
      )
        throw new Error('Implicit link changed the existing profile or membership')
      text = text.replaceAll(session.signedInAt, '$signedInAt')
    }
    const location = response.headers.get('location')
    if (label === 'callback newline provider' && location !== `${app.url}/api/auth/callback/%0A?`)
      throw new Error('Encoded callback provider path changed')
    if (label === 'callback non-ASCII location' && location !== '/ä')
      throw new Error('Latin-1 redirect header changed')
    observe({
      label,
      status: response.status,
      expected,
      text: mask(text) + (location === null ? '' : `\nLocation: ${mask(location)}`),
    })
    return response
  }
  async function begin(id = 'google', extra: Record<string, unknown> = {}, link = false) {
    await call(
      `begin ${id}${link ? ' link' : ''}`,
      link ? '/link-social' : '/sign-in/social',
      {
        provider: id,
        callbackURL: `${app.url}/timer`,
        errorCallbackURL: `${app.url}/sign-in?from=oauth`,
        ...extra,
      },
      200,
    )
  }
  async function issue(profile: Record<string, unknown>, scopes?: string) {
    const result = (await fetch(`${fake}/issue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authorizationURL: authURL, profile, scopes }),
    }).then((r) => r.json())) as { code: string }
    secrets.set(result.code, '$code')
    return result.code
  }
  for (const body of [
    null,
    [],
    {},
    { provider: 3 },
    { provider: 'not-configured' },
    { provider: 'google', scopes: [3] },
    { provider: 'google', additionalParams: { state: 'override' } },
    { provider: 'google', callbackURL: 'https://evil.example/' },
    { provider: 'google', idToken: null },
    { provider: 'google', additionalParams: { z: false, a: 3 } },
    {
      provider: 'google',
      callbackURL: 3,
      newUserCallbackURL: false,
      errorCallbackURL: null,
      disableRedirect: 3,
      scopes: [null],
      requestSignUp: 4,
      loginHint: [],
    },
  ]) {
    await call(
      `schema ${JSON.stringify(body)}`,
      '/sign-in/social',
      body,
      body && !Array.isArray(body) && (body as { provider?: string }).provider === 'not-configured'
        ? 404
        : body && (body as { callbackURL?: string }).callbackURL === 'https://evil.example/'
          ? 403
          : 400,
    )
  }
  await call(
    'callback ordered schema',
    '/callback/google',
    { code: 3, error: false, state: null },
    400,
  )
  await call('callback newline provider', '/callback/%0A', {}, 302)
  await begin('google', { callbackURL: '/ä' })
  const unicodeCode = await issue(profile(USERS.admin.email))
  await call(
    'callback non-ASCII location',
    `/callback/google?state=${state}&code=${unicodeCode}`,
    undefined,
    302,
  )
  cookie = ''
  await begin('google', { callbackURL: '/雪' })
  const wideCode = await issue(profile(USERS.admin.email))
  await call(
    'callback non-ByteString location',
    `/callback/google?state=${state}&code=${wideCode}`,
    undefined,
    500,
  )
  cookie = ''
  await call('signed out accounts', '/list-accounts', undefined, 401)
  await call('signed out link', '/link-social', { provider: 'google' }, 401)
  await call('signed out unlink', '/unlink-account', { accountId: 'missing' }, 401)
  await call('callback no state', '/callback/google?code=bad', undefined, 302)
  await call('callback unknown state', '/callback/google?state=unknown&code=bad', undefined, 302)
  await begin()
  const goodCookie = cookie
  await call('state missing cookie', `/callback/google?state=${state}&code=bad`, undefined, 302, {
    cookie: '',
  })
  await call('state forged cookie', `/callback/google?state=${state}&code=bad`, undefined, 302, {
    cookie: 'better-auth.state=forged',
  })
  await call(
    'provider denied',
    `/callback/google?state=${state}&error=access_denied&error_description=No+thanks`,
    undefined,
    302,
    { cookie: goodCookie },
  )
  await call('state replay', `/callback/google?state=${state}&code=bad`, undefined, 302)
  await begin()
  await call('callback no code', `/callback/google?state=${state}`, undefined, 302)
  await begin()
  await call('invalid code', `/callback/google?state=${state}&code=bad`, undefined, 302)
  await begin()
  await call(
    'callback unsupported provider',
    `/callback/missing?state=${state}&code=bad`,
    undefined,
    302,
  )
  await begin('google', {
    disableRedirect: true,
    scopes: ['extra'],
    loginHint: 'hint@example.com',
    additionalParams: { prompt: 'select_account', z: 'last', a: 'first' },
    additionalData: {
      callbackURL: 'https://evil.example/',
      codeVerifier: 'overridden',
      link: { userId: 'other', email: 'other@example.com' },
      serverContext: { forged: true },
      oauthState: 'overridden',
    },
  })
  let code = await issue(profile(USERS.admin.email))
  await call('callback form redirect', '/callback/google', {}, 302, {
    raw: `code=${code}&state=${state}`,
  })
  await call(
    'existing verified email implicit link',
    `/callback/google?state=${state}&code=${code}`,
    undefined,
    302,
  )
  await call('linked accounts', '/list-accounts', undefined, 200)
  await call('existing profile and membership preserved', '/api/v1/session', undefined, 200)
  await call('missing unlink', '/unlink-account', { accountId: 'missing' }, 400)
  await begin('google', {}, true)
  code = await issue(profile('different@example.com'))
  await call('link different email', `/callback/google?state=${state}&code=${code}`, undefined, 302)
  await begin('google', {}, true)
  code = await issue(profile(USERS.admin.email, false))
  await call(
    'link unverified email',
    `/callback/google?state=${state}&code=${code}`,
    undefined,
    302,
  )
  await begin('google', { scopes: ['extra', 'email'] }, true)
  code = await issue(profile(USERS.admin.email), 'email profile extra')
  await call('relink merges scopes', `/callback/google?state=${state}&code=${code}`, undefined, 302)
  await call('merged account scopes', '/list-accounts', undefined, 200)
  await call('unlink social', '/unlink-account', { accountId }, 200)
  await call('after unlink', '/list-accounts', undefined, 200)
  await call('unlink last account', '/unlink-account', { accountId: 'missing' }, 400)
  cookie = ''
  for (const id of ['google', 'github', 'microsoft']) {
    await begin(id, { newUserCallbackURL: `${app.url}/welcome` })
    code = await issue(profile(`${id}@oauth.example`, true, `new-${id}`))
    await call(
      `${id} new verified signup`,
      `/callback/${id}?state=${state}&code=${code}`,
      undefined,
      302,
    )
    await call(`${id} new account`, '/list-accounts', undefined, 200)
    await call(`${id} application session`, '/api/v1/session', undefined, 200)
    await call(`${id} last social account refuses`, '/unlink-account', { accountId }, 400)
    cookie = ''
    await begin(id)
    code = await issue(profile(`${id}@oauth.example`, true, `new-${id}`), 'changed-scope')
    await call(
      `${id} existing account signin`,
      `/callback/${id}?state=${state}&code=${code}`,
      undefined,
      302,
    )
    await call(`${id} retains stored scope`, '/list-accounts', undefined, 200)
    cookie = ''
    await begin(id)
    code = await issue(profile(`unverified-${id}@oauth.example`, false, `unverified-${id}`))
    await call(
      `${id} unverified signup refuses`,
      `/callback/${id}?state=${state}&code=${code}`,
      undefined,
      302,
    )
    await begin(id)
    code = await issue({
      ...profile('ignored@example.com', true, `missing-${id}`),
      email: undefined,
    })
    await call(
      `${id} missing email refuses`,
      `/callback/${id}?state=${state}&code=${code}`,
      undefined,
      302,
    )
  }
  for (const id of ['google', 'github', 'microsoft']) {
    cookie = ''
    await begin(id)
    code = await issue({
      ...profile(`redirect-${id}@oauth.example`, true, `redirect-${id}`),
      token_redirect: true,
    })
    await call(
      `${id} token redirect policy`,
      `/callback/${id}?state=${state}&code=${code}`,
      undefined,
      302,
    )
    if (id === 'github')
      await call('github redirected exchange session', '/list-accounts', undefined, 200)
  }
  for (const [id, claims] of [
    ['consumer', { tid: '9188040d-6c67-4c5b-b112-36a304b66dad' }],
    ['verified-domain', { xms_edov: true }],
  ] as const) {
    cookie = ''
    await begin('microsoft')
    code = await issue({ ...profile(`${id}@microsoft.example`, false, id), ...claims })
    await call(
      `microsoft ${id} trusted address`,
      `/callback/microsoft?state=${state}&code=${code}`,
      undefined,
      302,
    )
    await call(`microsoft ${id} account`, '/list-accounts', undefined, 200)
  }
  cookie = ''
  await begin()
  code = await issue(profile(USERS.admin.email, true, 'oauth-user'))
  await call(
    'restore admin account',
    `/callback/google?state=${state}&code=${code}`,
    undefined,
    302,
  )
  cookie = (await signInHeaders(app, 'member')).cookie
    .split('; ')
    .filter((p) => !p.includes('session_data'))
    .join('; ')
  await begin('google', {}, true)
  code = await issue(profile(USERS.member.email, true, 'oauth-user'))
  await call(
    'account owned by another user',
    `/callback/google?state=${state}&code=${code}`,
    undefined,
    302,
  )
}
