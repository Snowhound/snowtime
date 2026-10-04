import type { AnyRouter, ServerManifest } from '@tanstack/router-core'

export interface PageInput {
  url: string
  method: string
  headers: [string, string][]
  cookie: string
  nonce: string
  locale: 'en' | 'et'
  manifest: ServerManifest
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
export interface Head {
  status: number
  headers: [string, string][]
}
export interface StartServerProps {
  router: AnyRouter
}

declare global {
  var renderContext: PageInput | undefined
  var renderPage: (input: PageInput) => Promise<void>
  var Deno: {
    core: {
      ops: {
        op_send: (input: ApiInput) => Promise<ApiAnswer>
        op_head: (head: Head) => void
        op_chunk: (chunk: Uint8Array) => Promise<void>
      }
    }
  }
  var originalNodes: Element[]
  var navigationMarker: string | undefined
}
