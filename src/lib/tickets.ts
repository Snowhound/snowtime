// Ticket keys in entry descriptions (docs/architecture.md, "Ticket keys"). An entry has one
// ticket, found when its description is committed (Enter, blur, Save), never while typing.
// The client runs this on commit and the seeds on their descriptions; the server only checks
// a ticket's format.

// A key as Jira, Linear, and YouTrack write them: a letter, one to nine more letters or
// digits, a dash, and a number.
const KEY = String.raw`[A-Z][A-Z0-9]{1,9}-[1-9]\d{0,6}`
const KEYS = new RegExp(String.raw`(?<![\w-])${KEY}(?![\w-])`, 'g')
// A key at the start, optionally in brackets, and the separator after it.
const LEADING = new RegExp(String.raw`^\[?(${KEY})\]?(?:\s*[:|,/–—-]\s*|\s+|$)`)
// A pasted issue link, such as …/browse/KEY or …/issue/KEY, becomes its key.
const ISSUE_LINK = new RegExp(
  String.raw`https?://\S+?/(?:browse|issues?)/(${KEY})(?![\w-])\S*`,
  'gi',
)
// Standards whose numbers look like keys.
const NOT_TICKETS = new Set(['UTF', 'ISO', 'SHA', 'COVID'])

export const TICKET_PATTERN = new RegExp(`^${KEY}$`)
export const TICKET_MAX_LENGTH = 18

// The keys in a text, in order. The keys a saved description has are the `known` keys of
// detectTicket.
export function keysIn(text: string) {
  return [...text.matchAll(KEYS)].map((match) => match[0])
}

// The description and ticket after committing `text`. A key at the start becomes the ticket
// and leaves the text, replacing any ticket the entry had; a key later in the text becomes it
// only when there is none, and stays so the sentence still reads. Other keys stay text. Keys
// in `known`, the ones the saved text already had, stay text too; that is how a chip turned
// back into text isn't found again.
export function detectTicket(text: string, known: ReadonlySet<string>, ticket: string | null) {
  const description = text.replace(ISSUE_LINK, (_, key: string) => key.toUpperCase()).trim()
  function fresh(key: string) {
    return !known.has(key) && !NOT_TICKETS.has(key.split('-')[0])
  }
  const lead = LEADING.exec(description)
  if (lead && fresh(lead[1])) {
    return { description: description.slice(lead[0].length).trim(), ticket: lead[1] }
  }
  return { description, ticket: ticket ?? keysIn(description).find(fresh) ?? null }
}

// A chip's ×: the entry has no ticket, and the key goes back to the start of the text unless
// the text still has it. The caller adds the key to its known keys.
export function untick(ticket: string, text: string) {
  const description = keysIn(text).includes(ticket) ? text : `${ticket} ${text}`.trim()
  return { description, ticket: null }
}

// Where a chip links with the organization's Issue links setting, a URL with {key}.
export function issueUrl(template: string | null | undefined, ticket: string) {
  return template ? template.replace('{key}', encodeURIComponent(ticket)) : null
}
