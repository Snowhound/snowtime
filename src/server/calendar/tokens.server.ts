// Sealing calendar tokens and the OAuth state with AES-GCM, under keys derived from
// BETTER_AUTH_SECRET with HKDF. Rotating the secret makes every sealed token unreadable, and
// each connection then asks the user to reconnect.
import { env } from '~/env'

const encoder = new TextEncoder()
const keys = new Map<string, Promise<CryptoKey>>()

function keyFor(purpose: string) {
  let key = keys.get(purpose)
  if (!key) {
    key = crypto.subtle
      .importKey('raw', encoder.encode(env.BETTER_AUTH_SECRET), 'HKDF', false, ['deriveKey'])
      .then((secret) =>
        crypto.subtle.deriveKey(
          {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: encoder.encode('snowtime'),
            info: encoder.encode(purpose),
          },
          secret,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      )
    keys.set(purpose, key)
  }
  return key
}

function toBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url')
}

export type SealPurpose = 'calendar-token' | 'calendar-state'

export async function seal(purpose: SealPurpose, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await keyFor(purpose),
    encoder.encode(text),
  )
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`
}

// Null for anything this deployment didn't seal for the purpose, or sealed under an older
// secret.
export async function unseal(purpose: SealPurpose, value: string): Promise<string | null> {
  const [version, iv, data] = value.split('.')
  if (version !== 'v1' || !iv || !data) return null
  try {
    const text = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(iv, 'base64url') },
      await keyFor(purpose),
      Buffer.from(data, 'base64url'),
    )
    return new TextDecoder().decode(text)
  } catch {
    return null
  }
}

// PKCE (RFC 7636): the verifier stays sealed in the state, the challenge goes to the provider.
export async function pkce() {
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) }
}
