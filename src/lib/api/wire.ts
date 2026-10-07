// The contract's JSON encoding (task 084), which the API's input (src/server/http.server.ts)
// and the client's answers (request.ts) share. Dates travel as ISO 8601 strings; the schemas
// say which fields hold dates, so decoding turns those back into Date before it validates,
// and a GET's booleans, which arrive as query strings, back into booleans. An AppError travels
// as its code and key.
import * as v from 'valibot'
import type { AppErrorCode, AppErrorKey } from '~/server/errors'

// The body of a failed call. A rule's refusal carries its AppError's code and key. Anything
// else carries a message: input that fails the schema, or a refusal of Better Auth's, which
// adds Better Auth's code.
export type WireError =
  | { code: AppErrorCode; key: AppErrorKey }
  | { code?: string; message: string }

type AnySchema = v.GenericSchema & {
  type: string
  entries?: Record<string, AnySchema>
  item?: AnySchema
  wrapped?: AnySchema
  // A variant's key, and its options, each of which holds the key's literal.
  key?: string
  options?: AnySchema[]
  literal?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The value with each string the schema expects as a date or a boolean turned into one. A
// piped schema keeps its first schema's type and entries, so pipes need no case of their own.
function revive(schema: AnySchema, value: unknown): unknown {
  if (value === null || value === undefined) return value
  switch (schema.type) {
    case 'date':
      return typeof value === 'string' ? new Date(value) : value
    case 'boolean':
      if (value === 'true') return true
      if (value === 'false') return false
      return value
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
    case 'variant': {
      if (!isRecord(value)) return value
      const option = schema.options!.find(
        (o) => o.entries![schema.key!].literal === value[schema.key!],
      )
      return option ? revive(option, value) : value
    }
    default:
      return value
  }
}

// A JSON value, decoded and validated against the schema.
export function decode<S extends v.GenericSchema>(schema: S, value: unknown): v.InferOutput<S> {
  return v.parse(schema, revive(schema as unknown as AnySchema, value))
}
