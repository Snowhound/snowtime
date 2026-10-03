// The contract's JSON encoding (task 084), which the HTTP API and the render isolate's host
// share. Dates travel as ISO 8601 strings; the schemas say which fields hold dates, so
// decoding turns those back into Date before it validates. An AppError travels as its code
// and key.
import * as v from 'valibot'
import { AppError, type AppErrorCode, type AppErrorKey } from '~/server/errors'
import type { Operation } from '~/server/schemas'

// A response as a backend sends it: the status, and the body before JSON.stringify.
export interface WireResponse {
  status: number
  body: unknown
}

// The body of a failed call. A rule's refusal carries its AppError; anything else, such as
// input that fails the schema, only a message.
export type WireError = { code: AppErrorCode; key: AppErrorKey } | { message: string }

type AnySchema = v.GenericSchema & {
  type: string
  entries?: Record<string, AnySchema>
  item?: AnySchema
  wrapped?: AnySchema
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The value with each string the schema expects as a date turned into a Date. A piped
// schema keeps its first schema's type and entries, so pipes need no case of their own.
function revive(schema: AnySchema, value: unknown): unknown {
  if (value === null || value === undefined) return value
  switch (schema.type) {
    case 'date':
      return typeof value === 'string' ? new Date(value) : value
    case 'optional':
    case 'nullable':
    case 'nullish':
      return revive(schema.wrapped!, value)
    case 'array':
      return Array.isArray(value) ? value.map((item) => revive(schema.item!, item)) : value
    case 'object':
    case 'loose_object':
    case 'strict_object': {
      if (!isRecord(value)) return value
      const revived = { ...value }
      for (const [key, entry] of Object.entries(schema.entries!)) {
        if (key in revived) revived[key] = revive(entry, revived[key])
      }
      return revived
    }
    default:
      return value
  }
}

// A JSON value, decoded and validated against the schema.
export function decode<S extends v.GenericSchema>(schema: S, value: unknown): v.InferOutput<S> {
  return v.parse(schema, revive(schema as unknown as AnySchema, value))
}

function segments(path: string) {
  return path.split('/').filter(Boolean)
}

// The parameters of `pathname` if it matches the operation's path, else null.
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const expected = segments(pattern)
  const actual = segments(pathname)
  if (expected.length !== actual.length) return null
  const params: Record<string, string> = {}
  for (const [i, segment] of expected.entries()) {
    if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(actual[i])
    else if (segment !== actual[i]) return null
  }
  return params
}

// Where a call goes: its path with the parameters filled in from the input, and the rest of
// the input as the query string of a GET or the JSON body of a write.
export function requestOf(
  operation: Operation,
  input: unknown,
): { path: string; body: string | undefined } {
  const rest: Record<string, unknown> = isRecord(input) ? { ...input } : {}
  const path = segments(operation.path)
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      const name = segment.slice(1)
      const value = rest[name]
      delete rest[name]
      return encodeURIComponent(String(value))
    })
    .join('/')
  const fields = JSON.parse(JSON.stringify(rest)) as Record<string, unknown>
  if (operation.method === 'GET') {
    const query = new URLSearchParams(fields as Record<string, string>).toString()
    return { path: `/${path}${query ? `?${query}` : ''}`, body: undefined }
  }
  return {
    path: `/${path}`,
    body: Object.keys(fields).length > 0 ? JSON.stringify(fields) : undefined,
  }
}

// The call's result, or the error it failed with, thrown as the rule threw it.
export function resultOf<O extends Operation>(
  operation: O,
  response: WireResponse,
): v.InferOutput<O['output']> {
  if (response.status >= 200 && response.status < 300) {
    return decode(operation.output, response.body)
  }
  const error = isRecord(response.body) ? (response.body.error as WireError | undefined) : undefined
  if (error && 'key' in error) throw new AppError(error.code, error.key)
  throw new Error(error && 'message' in error ? error.message : `HTTP ${response.status}`)
}
