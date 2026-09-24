import { createSerializationAdapter } from '@tanstack/solid-router'
import { createCsrfMiddleware, createStart } from '@tanstack/solid-start'
import { AppError, type AppErrorCode, type AppErrorKey } from '~/server/errors'

// Start drops everything but the message of a thrown error; this keeps AppError's code, so
// the client can tell "not found" from "forbidden", and its key, so the client can show
// the message in the user's language.
const appErrorAdapter = createSerializationAdapter({
  key: 'snowtime/AppError',
  test: (value): value is AppError => value instanceof AppError,
  toSerializable: (error) => ({ code: error.code, key: error.key }),
  fromSerializable: ({ code, key }: { code: AppErrorCode; key: AppErrorKey }) =>
    new AppError(code, key),
})

// Start applies this CSRF check by default only while there is no start instance.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
  serializationAdapters: [appErrorAdapter],
  requestMiddleware: [csrfMiddleware],
}))
