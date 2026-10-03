// The app's /api/v1 endpoints, for the route files in src/routes/api/v1/.
import { db } from '~/db'
import { env } from '~/env'
import { auth, rateLimitStore } from '../auth/better-auth.server'
import { createApiRoute } from './api.server'
import { createEndpoints } from './endpoints.server'

const apiRoute = createApiRoute({
  db,
  verifyKey: (key) => auth.api.verifyApiKey({ body: { key } }),
  rateLimitStore,
  loginDomains: env.ALLOWED_LOGIN_DOMAINS ?? [],
})

export const v1 = createEndpoints(apiRoute, db)
