// Sign-in and session server functions. Thin wrappers: the rules live in sign-in.server.ts,
// session.server.ts and invitations.server.ts.
import { createServerFn } from '@tanstack/solid-start'
import { getRequestHeaders, setCookie } from '@tanstack/solid-start/server'
import { db } from '~/db'
import { SEED_PASSWORD, seedUsers } from '~/db/seed'
import { env } from '~/env'
import { cookieMaxAge, cookieName, getLocale } from '~/paraglide/runtime.js'
import { GetInvitationInput } from './auth.schemas'
import { auth } from './better-auth.server'
import { invitationPreview } from './invitations.server'
import { appSession } from './session.server'
import { passwordEnabled, signInMethods } from './sign-in.server'

// The sign-in view calls this signed out, so it has no session or scope middleware. It
// returns method ids only, never a client ID or secret.
export const getSignInMethods = createServerFn({ method: 'GET' }).handler(() => signInMethods(env))

// The seeded users and their shared password, for one-click sign-in in local development.
// Empty wherever password sign-in is off, so deployed environments never list them.
export const getDevUsers = createServerFn({ method: 'GET' }).handler(() =>
  passwordEnabled(env)
    ? seedUsers.map((u) => ({ name: u.name, email: u.email, password: SEED_PASSWORD }))
    : [],
)

// The app frame's view of the session, or null when signed out, so it runs without
// middleware. It also keeps two things in step with the account:
// - the active organization, when the session has none or one the user has left;
// - the locale cookie, from user_settings.locale. `localeChanged` tells the caller that
//   this request rendered in another language, so the page should load again.
export const getAppSession = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = getRequestHeaders()
  const session = await auth.api.getSession({ headers })
  if (!session) return null

  const { user } = session
  const current = session.session.activeOrganizationId ?? null
  const state = await appSession(db, user, current)
  if (state.activeOrganizationId !== current) {
    await auth.api.setActiveOrganization({
      headers,
      body: { organizationId: state.activeOrganizationId },
    })
  }

  const locale = state.settings?.locale
  const localeChanged = locale !== undefined && locale !== getLocale()
  if (localeChanged) {
    setCookie(cookieName, locale, { path: '/', maxAge: cookieMaxAge, sameSite: 'lax' })
  }

  return {
    user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
    ...state,
    localeChanged,
  }
})

export type AppSession = NonNullable<Awaited<ReturnType<typeof getAppSession>>>

// Named here so client code imports the type from this file, not from sign-in.server.ts.
export type { SignInMethod } from './sign-in.server'

// An invitation link's details, shown before sign-in; null when the id is unknown.
export const getInvitation = createServerFn({ method: 'GET' })
  .validator(GetInvitationInput)
  .handler(({ data }) => invitationPreview(db, data.id))
