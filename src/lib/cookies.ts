// Cookies a page reads while it renders, for view state the server must render as the browser
// last left it, so the page hydrates at its final height and the router can restore its scroll.
// The server reads the page request's Cookie header, which src/server-entry.ts puts in the
// request context.
import { getGlobalStartContext } from '@tanstack/solid-start'
import { isServer } from 'solid-js/web'

// A year from the last change, renewed on each write.
const MAX_AGE = 60 * 60 * 24 * 365

function cookieHeader() {
  if (!isServer) return document.cookie
  return getGlobalStartContext()?.cookie ?? ''
}

export function readCookie(name: string) {
  for (const part of cookieHeader().split(';')) {
    const at = part.indexOf('=')
    if (at !== -1 && part.slice(0, at).trim() === name) {
      return decodeURIComponent(part.slice(at + 1).trim())
    }
  }
  return null
}

// Null removes the cookie.
export function writeCookie(name: string, value: string | null) {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  const age = value === null ? 0 : MAX_AGE
  document.cookie = `${name}=${encodeURIComponent(value ?? '')}; Path=/; Max-Age=${age}; SameSite=Lax${secure}`
}
