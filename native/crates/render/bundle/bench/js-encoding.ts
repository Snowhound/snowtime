import * as fallback from 'text-encoding'
Object.assign(globalThis, {
  JSTextEncoder: fallback.TextEncoder,
  JSTextDecoder: fallback.TextDecoder,
})
