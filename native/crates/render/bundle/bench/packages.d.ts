// These JS-only benchmark packages install the standard web API constructors.
declare module 'text-encoding' {
  export const TextEncoder: typeof globalThis.TextEncoder
  export const TextDecoder: typeof globalThis.TextDecoder
}
declare module 'core-js/actual/url/index.js' {}
declare module 'core-js/actual/url-search-params/index.js' {}
