import { APIError } from 'better-auth/api'

// Better Auth writes callback URLs as Latin-1 Location headers. Encode wider characters
// before storing the OAuth state so valid Unicode URLs can complete the redirect.
export function encodeCallbackUrls(path: string, body: Record<string, unknown> | undefined) {
  if (!body || (path !== '/sign-in/social' && path !== '/link-social')) return
  for (const field of ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL']) {
    const value = body[field]
    if (typeof value !== 'string') continue
    try {
      body[field] = Array.from(value, (character) =>
        character.charCodeAt(0) <= 255 ? character : encodeURIComponent(character),
      ).join('')
    } catch (error) {
      if (!(error instanceof URIError)) throw error
      throw new APIError('BAD_REQUEST', {
        code: 'INVALID_CALLBACK_URL',
        message: 'Invalid callback URL',
      })
    }
  }
}
