// The description and ticket of the timer's and the entry popover's fields until they are
// saved. A commit (Enter, blur, Start, Save) finds the ticket in the text (src/lib/tickets.ts);
// the keys the loaded description had, and any turned back into text, are known and stay text.
import { createSignal } from 'solid-js'
import { detectTicket, keysIn, untick } from '~/lib/tickets'

export function createTicketDraft(description = '', ticket: string | null = null) {
  const [text, setText] = createSignal(description)
  const [current, setCurrent] = createSignal(ticket)
  let known = new Set(keysIn(description))

  function commit() {
    const result = detectTicket(text(), known, current())
    setText(result.description)
    setCurrent(result.ticket)
    return result
  }

  return {
    description: text,
    setDescription: setText,
    ticket: current,
    // Shows other work: a loaded entry or a picked suggestion.
    reset(description: string, ticket: string | null) {
      setText(description)
      setCurrent(ticket)
      known = new Set(keysIn(description))
    },
    commit,
    // Turns the chip back into text, after committing what was typed. Null without a ticket.
    untick() {
      const key = commit().ticket
      if (!key) return null
      const result = untick(key, text())
      setText(result.description)
      setCurrent(null)
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
