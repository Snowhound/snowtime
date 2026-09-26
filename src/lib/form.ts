// The text to show for a field's errors: strings, or Standard Schema issues from the Valibot
// schemas that TanStack Form takes as validators.
export function fieldError(errors: readonly unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  }
  return undefined
}
