// Decoders the API harness (api.ts) times in Chrome: Start's, for a server function's
// answer, and the JSON API's (src/lib/api/wire.ts), each from the response's text.
import { fromCrossJSON } from 'seroval'
import { operations } from '~/lib/api/operations'
import { decode } from '~/lib/api/wire'

declare global {
  interface Window {
    decoders: Record<'serverFunction' | 'api', (text: string) => unknown>
  }
}

window.decoders = {
  serverFunction: (text) => fromCrossJSON(JSON.parse(text), { refs: new Map(), plugins: [] }),
  api: (text) => decode(operations.listEntries.output, JSON.parse(text)),
}
