// The session cookie Better Auth would set for a dataset user's token (better-call's
// signCookieValue): the token, a dot, and its HMAC-SHA256 under the server's secret in base64.
import { createHmac } from 'node:crypto'

export const SESSION_COOKIE = '__Secure-better-auth.session_token'

export function sessionCookie(token: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return encodeURIComponent(`${token}.${signature}`)
}
