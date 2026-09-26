// Valibot building blocks shared by the domain schemas. This file and every *.schemas.ts
// must stay importable from the browser: no server imports.
import * as v from 'valibot'
import { m } from '~/paraglide/messages.js'

// App-owned rows get their id on the client, so optimistic updates keep a stable key.
export const Uuidv7 = v.pipe(
  v.string(),
  v.regex(/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i, () =>
    m.validation_invalid_id(),
  ),
)

export const Description = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(500, (issue) => m.validation_too_long({ max: issue.requirement })),
)

export const Timestamp = v.date()

// The organization an organization-scoped call acts in. scopeMiddleware checks it on the
// call's whole input and passes the input on unchanged, for the function's own schema; the
// server then checks that the caller is a member.
export const OrganizationInput = v.object({ organizationId: v.pipe(v.string(), v.nonEmpty()) })

export function parseOrganizationInput<T extends { organizationId: string }>(input: T): T {
  v.parse(OrganizationInput, input)
  return input
}
