// The description and ticket of the timer's, the entry popover's, and the rows' fields until
// they are saved. A commit (Enter, blur, Start, Save) finds the ticket in the text
// (src/lib/tickets.ts); the keys the loaded description had, and any turned back into text, are
// known and stay text.
import { createSignal } from 'solid-js'
import { detectTicket, keysIn, untick } from '~/lib/tickets'

// Where the draft keeps its values: its own signals, a form's fields, or a row's.
export interface TicketFields {
  description: () => string
  setDescription: (description: string) => void
  ticket: () => string | null
  setTicket: (ticket: string | null) => void
}

function signalFields(): TicketFields {
  const [description, setDescription] = createSignal('')
  const [ticket, setTicket] = createSignal<string | null>(null)
  return { description, setDescription, ticket, setTicket }
}

export function createTicketDraft(fields = signalFields()) {
  let known = new Set(keysIn(fields.description()))

  function commit() {
    const result = detectTicket(fields.description(), known, fields.ticket())
    fields.setDescription(result.description)
    fields.setTicket(result.ticket)
    return result
  }

  return {
    description: fields.description,
    setDescription: fields.setDescription,
    ticket: fields.ticket,
    // Shows other work: a loaded entry or a picked suggestion.
    reset(description: string, ticket: string | null) {
      fields.setDescription(description)
      fields.setTicket(ticket)
      known = new Set(keysIn(description))
    },
    commit,
    // Turns the chip back into text, after committing what was typed. Null without a ticket.
    untick(): TurnedKey | null {
      const key = commit().ticket
      if (!key) return null
      const result = untick(key, fields.description())
      fields.setDescription(result.description)
      fields.setTicket(null)
      known.add(key)
      return { description: result.description, key }
    },
  }
}

// Puts the caret after a key turned back into text at the start of the field.
export function caretAfterKey(input: HTMLInputElement | undefined, turned: TurnedKey) {
  if (!input) return
  input.focus()
  const caret = turned.description.startsWith(`${turned.key} `) ? turned.key.length + 1 : 0
  input.setSelectionRange(caret, caret)
}

export type TurnedKey = { description: string; key: string }
