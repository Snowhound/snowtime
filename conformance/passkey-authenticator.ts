import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'

function b64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url')
}
function bytes(...parts: Uint8Array[]) {
  return Buffer.concat(parts)
}
function cborHead(major: number, length: number) {
  if (length < 24) return Buffer.from([major * 32 + length])
  if (length < 256) return Buffer.from([major * 32 + 24, length])
  return Buffer.from([major * 32 + 25, length >> 8, length & 255])
}
function decode(value: string | undefined) {
  return Buffer.from(value!, 'base64url')
}
function cbor(value: number | string | Uint8Array | Map<number | string, unknown>): Buffer {
  if (typeof value === 'number') return cborHead(value < 0 ? 1 : 0, value < 0 ? -1 - value : value)
  if (typeof value === 'string')
    return bytes(cborHead(3, Buffer.byteLength(value)), Buffer.from(value))
  if (value instanceof Uint8Array) return bytes(cborHead(2, value.length), value)
  return bytes(
    cborHead(5, value.size),
    ...Array.from(value).flatMap(([key, item]) => [
      cbor(key),
      cbor(item as Parameters<typeof cbor>[0]),
    ]),
  )
}

// Produces real COSE keys and signed assertions; no browser or authenticator service is used.
export class PasskeyAuthenticator {
  readonly id = b64(randomBytes(32))
  readonly publicKey: Buffer
  readonly privateKey: KeyObject
  constructor(readonly algorithm: 'ES256' | 'EdDSA' | 'RS256' = 'ES256') {
    const pair =
      algorithm === 'ES256'
        ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
        : algorithm === 'EdDSA'
          ? generateKeyPairSync('ed25519')
          : generateKeyPairSync('rsa', { modulusLength: 2048 })
    this.privateKey = pair.privateKey
    const jwk = pair.publicKey.export({ format: 'jwk' })
    const fields: [number, number | Uint8Array][] =
      algorithm === 'ES256'
        ? [
            [1, 2],
            [3, -7],
            [-1, 1],
            [-2, decode(jwk.x)],
            [-3, decode(jwk.y)],
          ]
        : algorithm === 'EdDSA'
          ? [
              [1, 1],
              [3, -8],
              [-1, 6],
              [-2, decode(jwk.x)],
            ]
          : [
              [1, 3],
              [3, -257],
              [-1, decode(jwk.n)],
              [-2, decode(jwk.e)],
            ]
    this.publicKey = cbor(new Map(fields))
  }
  registration(challenge: string, origin: string, flags = 1) {
    const client = Buffer.from(
      JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }),
    )
    const id = Buffer.from(this.id, 'base64url')
    const auth = bytes(
      createHash('sha256').update(new URL(origin).hostname).digest(),
      Buffer.from([flags | 64]),
      Buffer.alloc(4),
      Buffer.alloc(16),
      Buffer.from([0, id.length]),
      id,
      this.publicKey,
    )
    const attestation = cbor(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', auth],
      ]),
    )
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64(client),
        attestationObject: b64(attestation),
        transports: ['internal'],
      },
    }
  }
  authentication(challenge: string, origin: string, counter = 1, flags = 1) {
    const client = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }),
    )
    const count = Buffer.alloc(4)
    count.writeUInt32BE(counter)
    const auth = bytes(
      createHash('sha256').update(new URL(origin).hostname).digest(),
      Buffer.from([flags]),
      count,
    )
    const signature = sign(
      this.algorithm === 'EdDSA' ? null : 'sha256',
      bytes(auth, createHash('sha256').update(client).digest()),
      this.privateKey,
    )
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64(client),
        authenticatorData: b64(auth),
        signature: b64(signature),
        userHandle: null,
      },
    }
  }
}
