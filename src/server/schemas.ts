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
