// Valibot building blocks shared by the domain schemas. This file and every *.schemas.ts
// must stay importable from the browser: no server imports.
import * as v from 'valibot'
import { TICKET_PATTERN } from '~/lib/tickets'
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

// An entry's ticket key, such as NBW-412, or null for none. The client finds it in the
// description (src/lib/tickets.ts); the server checks only its shape.
export const TicketKey = v.pipe(
  v.string(),
  v.regex(TICKET_PATTERN, () => m.validation_ticket_format()),
)
export const Ticket = v.nullable(TicketKey)

export const Timestamp = v.date()

// A member's role in an organization: the strongest of Better Auth's roles they hold.
export const OrgRole = v.picklist(['owner', 'admin', 'member'])

// The organization an organization-scoped call acts in. scopeMiddleware checks it on the
// call's whole input and passes the input on unchanged, for the function's own schema; the
// server then checks that the caller is a member.
const OrganizationInput = v.object({ organizationId: v.pipe(v.string(), v.nonEmpty()) })

export function parseOrganizationInput<T extends { organizationId: string }>(input: T): T {
  v.parse(OrganizationInput, input)
  return input
}

// One call of the contract both backends serve (task 084): how the JSON API addresses it,
// and the shapes it takes and returns. An organization-scoped call names the organization
// in its path (`:organizationId`); a user-scoped one acts for the signed-in user anywhere.
// Other `:name` segments come from the input field of that name. The calls are listed in
// src/lib/api/operations.ts.
export interface Operation<
  TScope extends 'organization' | 'user' = 'organization' | 'user',
  TInput extends v.GenericSchema | undefined = v.GenericSchema | undefined,
  TOutput extends v.GenericSchema = v.GenericSchema,
> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  scope: TScope
  input: TInput
  output: TOutput
}
