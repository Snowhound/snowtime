// Errors server functions throw on purpose. The code tells the client what went wrong
// without it parsing messages.
export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'NO_ACTIVE_ORGANIZATION'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  // Input that passed the schema but not a rule that needs the database, e.g. an update
  // that would end an entry before it starts.
  | 'INVALID'

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}
