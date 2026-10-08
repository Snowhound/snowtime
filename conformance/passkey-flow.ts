import { signInHeaders } from '../perf/lib/app'
import { PasskeyAuthenticator } from './passkey-authenticator'

export interface PasskeyObservation {
  label: string
  status: number
  expected: number
  text: string
}
export async function passkeyFlow(
  server: { url: string },
  authenticators: PasskeyAuthenticator[],
  observe: (result: PasskeyObservation) => void,
) {
  const admin = await signInHeaders(server, 'admin')
  const member = await signInHeaders(server, 'member')
  const ids = new Map<string, string>()
  let sequence = 0
  async function call(
    label: string,
    path: string,
    expected: number,
    options: {
      method?: string
      body?: unknown
      raw?: string
      cookie?: string
      origin?: string
      generated?: boolean
    } = {},
  ) {
    const response = await fetch(`${server.url}/api/auth/passkey/${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'x-bench-ip': '127.0.0.1',
        origin: options.origin ?? server.url,
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    })
    let text = await response.text()
    const body = text ? JSON.parse(text) : null
    if (options.generated && response.ok) {
      if (
        typeof body.challenge !== 'string' ||
        Buffer.from(body.challenge, 'base64url').length !== 32
      )
        throw new Error(`${label}: invalid challenge`)
      text = text.replace(JSON.stringify(body.challenge), '"$challenge"')
      if (body.user) {
        if (!/^[a-z0-9]{32}$/.test(Buffer.from(body.user.id, 'base64url').toString()))
          throw new Error(`${label}: invalid user handle`)
        text = text.replace(JSON.stringify(body.user.id), '"$userHandle"')
      }
    }
    if (path === 'verify-registration' && response.ok) {
      if (!/^[0-9a-f-]{36}$/.test(body.id) || body.id[14] !== '7')
        throw new Error('Expected UUIDv7 passkey ID')
      ids.set(body.id, `$passkey${sequence++}`)
    }
    if (body?.session) {
      if (body.session.id[14] !== '7' || !/^[a-zA-Z0-9]{32}$/.test(body.session.token))
        throw new Error('Invalid session ID/token')
      ids.set(body.session.id, '$sessionId')
      ids.set(body.session.token, '$sessionToken')
    }
    for (const [id, paired] of ids)
      text = text.replaceAll(JSON.stringify(id), JSON.stringify(paired))
    // Keep the seeded user's dates exact; only the new credential/session clocks advance.
    const userAt = body?.session ? text.indexOf(',"user":') : -1
    const staticUser = userAt < 0 ? '' : text.slice(userAt)
    const dynamic = userAt < 0 ? text : text.slice(0, userAt)
    text =
      dynamic.replaceAll(/"(?:createdAt|updatedAt|expiresAt)":"[^"]*"/g, (field) =>
        field.replace(/:"[^"]*"$/, ':"$time"'),
      ) + staticUser
    observe({ label, status: response.status, expected, text })
    if (response.status !== expected)
      throw new Error(`${label}: expected ${expected}, got ${response.status}: ${text}`)
    const cookie = response.headers
      .getSetCookie()
      .map((s) => s.split(';')[0])
      .join('; ')
    return { body, cookie, headers: response.headers }
  }
  await call('signed-out listing', 'list-user-passkeys', 401)
  await call('signed-out registration options', 'generate-register-options', 401)
  await call('empty listing', 'list-user-passkeys', 200, { cookie: admin.cookie })
  await call(
    'attachment Zod enum',
    'generate-register-options?authenticatorAttachment=invalid',
    400,
    { cookie: admin.cookie },
  )
  for (const invalid of [undefined, null, [], 3, false]) {
    await call(`delete schema ${JSON.stringify(invalid)}`, 'delete-passkey', 400, {
      method: 'POST',
      body: { id: invalid },
      cookie: admin.cookie,
    })
    await call(`auth schema ${JSON.stringify(invalid)}`, 'verify-authentication', 400, {
      method: 'POST',
      body: { response: invalid },
    })
  }
  await call('registration ordered Zod fields', 'verify-registration', 400, {
    method: 'POST',
    body: { name: 1, createSession: 'yes' },
    cookie: admin.cookie,
  })
  await call('malformed JSON', 'verify-registration', 400, {
    method: 'POST',
    raw: '{',
    cookie: admin.cookie,
  })
  await call('bad HTTP origin', 'verify-registration', 403, {
    method: 'POST',
    body: {},
    cookie: admin.cookie,
    origin: 'https://evil.example',
  })
  await call('missing registration challenge', 'verify-registration', 400, {
    method: 'POST',
    body: { response: {} },
    cookie: admin.cookie,
  })
  await call('missing authentication challenge', 'verify-authentication', 400, {
    method: 'POST',
    body: { response: {} },
  })
  await call('missing passkey', 'delete-passkey', 404, {
    method: 'POST',
    body: { id: 'unknown' },
    cookie: admin.cookie,
  })
  await call('empty passkey ID', 'delete-passkey', 400, {
    method: 'POST',
    body: { id: '' },
    cookie: admin.cookie,
  })
  for (const [i, authenticator] of authenticators.entries()) {
    const flags = i === 1 ? 1 | 8 | 16 : 1 // UV false, plus a backed-up multi-device credential.
    const register = await call(
      `${authenticator.algorithm} register options`,
      'generate-register-options?authenticatorAttachment=platform',
      200,
      { cookie: admin.cookie, generated: true },
    )
    if (register.headers.getSetCookie().every((s) => !s.includes('Max-Age=300')))
      throw new Error('Challenge cookie must last five minutes')
    const registration = authenticator.registration(register.body.challenge, server.url, flags)
    const registered = await call(
      `${authenticator.algorithm} registration UV=false`,
      'verify-registration',
      200,
      {
        method: 'POST',
        body: {
          response: registration,
          name: '  Test key  ',
          ...(i === 2 ? { createSession: true } : {}),
        },
        cookie: `${admin.cookie}; ${register.cookie}`,
      },
    )
    if (registered.body.publicKey !== authenticator.publicKey.toString('base64'))
      throw new Error('COSE bytes changed')
    if (
      registered.body.name !== 'Test key' ||
      registered.body.deviceType !== (flags & 8 ? 'multiDevice' : 'singleDevice')
    )
      throw new Error('Incorrect registered key metadata')
    await call(`${authenticator.algorithm} registration replay`, 'verify-registration', 400, {
      method: 'POST',
      body: { response: registration },
      cookie: `${admin.cookie}; ${register.cookie}`,
    })
    await call(`${authenticator.algorithm} listing`, 'list-user-passkeys', 200, {
      cookie: admin.cookie,
    })
    await call(
      `${authenticator.algorithm} registration excludes saved keys`,
      'generate-register-options',
      200,
      { cookie: admin.cookie, generated: true },
    )
    await call(`${authenticator.algorithm} session options`, 'generate-authenticate-options', 200, {
      cookie: admin.cookie,
      generated: true,
    })
    const auth = await call(
      `${authenticator.algorithm} discoverable options`,
      'generate-authenticate-options',
      200,
      { generated: true },
    )
    const assertion = authenticator.authentication(auth.body.challenge, server.url, 1, flags)
    const signedIn = await call(
      `${authenticator.algorithm} sign-in UV=false`,
      'verify-authentication',
      200,
      { method: 'POST', body: { response: assertion }, cookie: auth.cookie },
    )
    if (!signedIn.cookie.includes('better-auth.session_token='))
      throw new Error('Missing signed session')
    await call(`${authenticator.algorithm} signed-in listing`, 'list-user-passkeys', 200, {
      cookie: signedIn.cookie,
    })
    await call(`${authenticator.algorithm} assertion replay`, 'verify-authentication', 400, {
      method: 'POST',
      body: { response: assertion },
      cookie: auth.cookie,
    })
    const stale = await call(
      `${authenticator.algorithm} stale counter options`,
      'generate-authenticate-options',
      200,
      { generated: true },
    )
    await call(`${authenticator.algorithm} stale counter`, 'verify-authentication', 400, {
      method: 'POST',
      body: { response: authenticator.authentication(stale.body.challenge, server.url, 1, flags) },
      cookie: stale.cookie,
    })
    const bad = await call(
      `${authenticator.algorithm} wrong origin options`,
      'generate-authenticate-options',
      200,
      { generated: true },
    )
    await call(`${authenticator.algorithm} wrong ceremony origin`, 'verify-authentication', 400, {
      method: 'POST',
      body: {
        response: authenticator.authentication(bad.body.challenge, 'http://evil.example', 2, flags),
      },
      cookie: bad.cookie,
    })
    for (const [label, mutate] of [
      [
        'wrong challenge',
        (_challenge: string) =>
          authenticator.authentication('wrong-challenge', server.url, 2, flags),
      ],
      [
        'invalid signature',
        (challenge: string) => {
          const response = authenticator.authentication(challenge, server.url, 2, flags)
          const signature = Buffer.from(response.response.signature, 'base64url')
          signature[signature.length - 1] ^= 1
          response.response.signature = signature.toString('base64url')
          return response
        },
      ],
      [
        'no user presence',
        (challenge: string) => authenticator.authentication(challenge, server.url, 2, flags & ~1),
      ],
    ] as const) {
      const challenge = await call(
        `${authenticator.algorithm} ${label} options`,
        'generate-authenticate-options',
        200,
        { generated: true },
      )
      const response = mutate(challenge.body.challenge)
      await call(
        `${authenticator.algorithm} ${label}`,
        'verify-authentication',
        label === 'invalid signature' ? 401 : 400,
        { method: 'POST', body: { response }, cookie: challenge.cookie },
      )
      await call(`${authenticator.algorithm} ${label} consumed`, 'verify-authentication', 400, {
        method: 'POST',
        body: {
          response: authenticator.authentication(challenge.body.challenge, server.url, 2, flags),
        },
        cookie: challenge.cookie,
      })
    }
    const uv = await call(
      `${authenticator.algorithm} UV=true options`,
      'generate-authenticate-options',
      200,
      { generated: true },
    )
    await call(`${authenticator.algorithm} UV=true sign-in`, 'verify-authentication', 200, {
      method: 'POST',
      body: {
        response: authenticator.authentication(
          uv.body.challenge,
          server.url,
          2,
          flags | 4 | 8 | 16,
        ),
      },
      cookie: uv.cookie,
    })
    await call(
      `${authenticator.algorithm} counter and registration backup metadata`,
      'list-user-passkeys',
      200,
      { cookie: admin.cookie },
    )
    const wrongUser = await call(
      `${authenticator.algorithm} owner challenge`,
      'generate-register-options',
      200,
      { cookie: admin.cookie, generated: true },
    )
    await call(`${authenticator.algorithm} wrong registration owner`, 'verify-registration', 401, {
      method: 'POST',
      body: { response: authenticator.registration(wrongUser.body.challenge, server.url) },
      cookie: `${member.cookie}; ${wrongUser.cookie}`,
    })
    const wrongType = await call(
      `${authenticator.algorithm} authentication challenge`,
      'generate-authenticate-options',
      200,
      { generated: true },
    )
    await call(`${authenticator.algorithm} wrong ceremony`, 'verify-registration', 400, {
      method: 'POST',
      body: { response: registration },
      cookie: `${admin.cookie}; ${wrongType.cookie}`,
    })
    await call(`${authenticator.algorithm} wrong deletion owner`, 'delete-passkey', 401, {
      method: 'POST',
      body: { id: registered.body.id },
      cookie: member.cookie,
    })
    await call(`${authenticator.algorithm} remove`, 'delete-passkey', 200, {
      method: 'POST',
      body: { id: registered.body.id },
      cookie: admin.cookie,
    })
    await call(`${authenticator.algorithm} removal repeat`, 'delete-passkey', 404, {
      method: 'POST',
      body: { id: registered.body.id },
      cookie: admin.cookie,
    })
    const removed = await call(
      `${authenticator.algorithm} removed-key options`,
      'generate-authenticate-options',
      200,
      { generated: true },
    )
    await call(`${authenticator.algorithm} removed key sign-in`, 'verify-authentication', 401, {
      method: 'POST',
      body: {
        response: authenticator.authentication(removed.body.challenge, server.url, 2, flags),
      },
      cookie: removed.cookie,
    })
  }
  await call('final empty listing', 'list-user-passkeys', 200, { cookie: admin.cookie })
}
