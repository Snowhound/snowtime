import { createSerializationAdapter } from '@tanstack/solid-router'
import { createStart } from '@tanstack/solid-start'
import { AppError, type AppErrorCode, type AppErrorKey } from '~/server/errors'

// A server render sends its loaders' errors to the browser through Start's serializer, which
// keeps only an error's message. This keeps AppError's code, so the error page can tell "not
// found" from "forbidden", and its key, so it can show the message in the user's language.
const appErrorAdapter = createSerializationAdapter({
  key: 'snowtime/AppError',
  test: (value): value is AppError => value instanceof AppError,
  toSerializable: (error) => ({ code: error.code, key: error.key }),
  fromSerializable: ({ code, key }: { code: AppErrorCode; key: AppErrorKey }) =>
    new AppError(code, key),
})

export const startInstance = createStart(() => ({
  serializationAdapters: [appErrorAdapter],
}))
