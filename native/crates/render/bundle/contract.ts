import type { AnyRouter, ServerManifest } from '@tanstack/router-core'

export interface PageInput {
  url: string
  method: string
  headers: [string, string][]
  cookie: string
  nonce: string
  // Absent in the host, which leaves it to the request's cookie and Accept-Language.
  locale?: 'en' | 'et'
  now?: number | null
}
export interface ApiInput {
  method: string
  path: string
  headers: [string, string][]
  body: number[]
}
export interface ApiAnswer {
  status: number
  headers: [string, string][]
  body: number[] | Uint8Array<ArrayBuffer>
}
export interface StartServerProps {
  router: AnyRouter
}

declare global {
  var renderContext: PageInput | undefined
  var renderPage: (input: PageInput) => Promise<void>
  // The client manifest of the build whose assets the host serves, set once per isolate.
  var renderManifest: ServerManifest
  var Deno: {
    core: {
      ops: {
        op_send: (input: ApiInput) => Promise<ApiAnswer>
        op_head: (status: number, headers: [string, string][]) => void
        op_chunk: (chunk: Uint8Array) => void
      }
    }
  }
  var originalNodes: Element[]
  var navigationMarker: string | undefined
}
