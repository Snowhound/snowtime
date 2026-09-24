// Helpers of the Projects view.
import { getLocale } from '~/paraglide/runtime.js'

export function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, getLocale())
}

// The teams to assign and unassign to go from one set to the other.
export function teamChanges(before: readonly string[], after: readonly string[]) {
  return {
    assign: after.filter((t) => !before.includes(t)),
    unassign: before.filter((t) => !after.includes(t)),
  }
}
