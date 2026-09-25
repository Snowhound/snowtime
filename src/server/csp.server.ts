// The Content-Security-Policy of every page (docs/architecture.md, "Content security
// policy"). Scripts run only with the page's nonce, or when a script that has it loads
// them ('strict-dynamic'), so injected markup can't run code.

// A fresh nonce per page, as CSP requires: a reused one would let an attacker who has
// seen it run scripts.
export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
}

export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    // Components render style attributes on the server, and a nonce can't cover those.
    "style-src 'self' 'unsafe-inline'",
    // Avatars come from the sign-in providers' image hosts.
    "img-src 'self' data: https:",
    // The build inlines small font files as data: URLs.
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}
