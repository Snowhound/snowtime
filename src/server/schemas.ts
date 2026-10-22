// Valibot building blocks shared by the domain schemas. This file and every *.schemas.ts
// must stay importable from the browser: no server imports.
import * as v from 'valibot'
import { TICKET_PATTERN } from '~/lib/tickets'
import { m } from '~/paraglide/messages.js'

export type ValidationParams = Record<string, string | number>
type ValidationMessage = (inputs?: ValidationParams, options?: { locale?: 'en' | 'et' }) => string
type Issue = v.BaseIssue<unknown>

// The schemas' messages by key. The API answers the key, and the client shows its text
// (task 095); validation_invalid stands for valibot's own checks, which have no key.
const validationMessages = {
  validation_color_format: m.validation_color_format,
  validation_copy_duration_pattern: m.validation_copy_duration_pattern,
  validation_date_format: m.validation_date_format,
  validation_date_unknown: m.validation_date_unknown,
  validation_email: m.validation_email,
  validation_end_before_start: m.validation_end_before_start,
  validation_entry_too_long: m.validation_entry_too_long,
  validation_invalid: m.validation_invalid,
  validation_invalid_id: m.validation_invalid_id,
  validation_issue_links_https: m.validation_issue_links_https,
  validation_issue_links_key: m.validation_issue_links_key,
  validation_member_or_team: m.validation_member_or_team,
  validation_name_required: m.validation_name_required,
  validation_password_required: m.validation_password_required,
  validation_range_end_before_start: m.validation_range_end_before_start,
  validation_range_too_long: m.validation_range_too_long,
  validation_slug_format: m.validation_slug_format,
  validation_slug_reserved: m.validation_slug_reserved,
  validation_ticket_format: m.validation_ticket_format,
  validation_time_zone_format: m.validation_time_zone_format,
  validation_time_zone_unknown: m.validation_time_zone_unknown,
  validation_too_long: m.validation_too_long,
}

export type ValidationKey = keyof typeof validationMessages

// A validation key's text, in the user's language or the locale given; undefined for a key
// this build doesn't know.
export function validationText(
  key: string,
  params?: ValidationParams,
  locale?: 'en' | 'et',
): string | undefined {
  if (!Object.hasOwn(validationMessages, key)) return undefined
  const message = validationMessages[key as ValidationKey] as ValidationMessage
  return message(params, locale ? { locale } : undefined)
}

const issueMessages = new WeakMap<Issue, { key: ValidationKey; params?: ValidationParams }>()

// A schema message by its key: the text in the user's language, as the forms show it, with
// the key and parameters kept for the issue, so the API can answer the key (task 095).
// Valibot passes the message function the issue it reports.
export function keyed(key: ValidationKey, params?: (issue: Issue) => ValidationParams) {
  return (issue: Issue) => {
    const values = params?.(issue)
    issueMessages.set(issue, { key, params: values })
    return validationText(key, values) ?? key
  }
}

export function issueMessage(issue: Issue) {
  return issueMessages.get(issue)
}

// App-owned rows get their id on the client, so optimistic updates keep a stable key.
export const Uuidv7 = v.pipe(
  v.string(),
  v.regex(
    /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
    keyed('validation_invalid_id'),
  ),
)

export const Description = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(
    500,
    keyed('validation_too_long', (issue) => ({ max: Number(issue.requirement) })),
  ),
)

// An entry's ticket key, such as NBW-412, or null for none. The client finds it in the
// description (src/lib/tickets.ts); the server checks only its shape.
export const TicketKey = v.pipe(
  v.string(),
  v.regex(TICKET_PATTERN, keyed('validation_ticket_format')),
)
export const Ticket = v.nullable(TicketKey)

export const Timestamp = v.date()

// A member's role in an organization: the strongest of Better Auth's roles they hold.
export const OrgRole = v.picklist(['owner', 'admin', 'member'])
