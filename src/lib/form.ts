// TanStack Form takes the Valibot schemas (src/server/*/*.schemas.ts) directly as
// validators, since both implement Standard Schema:
//
//   const form = createForm(() => ({
//     defaultValues: { name: '' },
//     validators: { onSubmit: CreateProjectForm },
//     onSubmit: ({ value }) => mutation.mutateAsync(value),
//   }))
//
// A field's errors are then Standard Schema issues or strings; this picks the text to show.
export function fieldError(errors: readonly unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  }
  return undefined
}
