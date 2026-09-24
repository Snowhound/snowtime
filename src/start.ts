import { createSerializationAdapter } from '@tanstack/solid-router'
import { createCsrfMiddleware, createStart } from '@tanstack/solid-start'
import { AppError, type AppErrorCode } from './server/errors'

// Start drops everything but the message of a thrown error; this keeps AppError's code, so
// the client can tell "not found" from "forbidden".
const appErrorAdapter = createSerializationAdapter({
  key: 'snowtime/AppError',
  test: (value): value is AppError => value instanceof AppError,
  toSerializable: (error) => ({ code: error.code, message: error.message }),
  fromSerializable: ({ code, message }: { code: AppErrorCode; message: string }) =>
    new AppError(code, message),
})

// Start applies this CSRF check by default only while there is no start instance.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
  serializationAdapters: [appErrorAdapter],
  requestMiddleware: [csrfMiddleware],
}))
