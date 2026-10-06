import {
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
  ReadableStream,
  TransformStream,
  WritableStream,
} from 'web-streams-polyfill'
// Web APIs the render bundle needs that the jsc shell lacks. Built with
// `bun build --target browser --format iife` into polyfills.iife.js.
// Phase B (Solid's synchronous render) calls none of these; they only affect A and C.
import 'core-js/actual/url/index.js'
import 'core-js/actual/url-search-params/index.js'

const g = globalThis
Object.assign(g, {
  ReadableStream,
  WritableStream,
  TransformStream,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
})

// performance.now from the shell's microsecond clock
const origin = preciseTime()
g.performance = { now: () => (preciseTime() - origin) * 1000, timeOrigin: origin * 1000 }

g.queueMicrotask = (fn) => {
  void Promise.resolve().then(fn)
}

// Timers over the shell's one-shot setTimeout
const shellSetTimeout = g.setTimeout
let nextTimer = 1
const live = new Set()
g.setTimeout = (fn, ms = 0, ...args) => {
  const id = nextTimer++
  live.add(id)
  shellSetTimeout(() => {
    if (live.delete(id)) fn(...args)
  }, ms)
  return id
}
g.clearTimeout = (id) => {
  live.delete(id)
}
g.setInterval = (fn, ms = 0, ...args) => {
  const id = nextTimer++
  live.add(id)
  function tick() {
    if (!live.has(id)) return
    fn(...args)
    shellSetTimeout(tick, ms)
  }
  shellSetTimeout(tick, ms)
  return id
}
g.clearInterval = g.clearTimeout

function format(args) {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error)
        return a.stack ? a.name + ': ' + a.message + '\n' + a.stack : String(a)
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}
g.console = {
  log: (...a) => print(format(a)),
  info: (...a) => print(format(a)),
  debug: (...a) => print(format(a)),
  warn: (...a) => printErr(format(a)),
  error: (...a) => printErr(format(a)),
  trace: (...a) => printErr(format(a)),
}

class DOMException extends Error {
  constructor(message = '', name = 'Error') {
    super(message)
    this.name = name
  }
}
g.DOMException = DOMException

// Events whose stopImmediatePropagation() ran
const stopped = new WeakSet()
class Event {
  constructor(type, init = {}) {
    this.type = type
    this.bubbles = !!init.bubbles
    this.cancelable = !!init.cancelable
    this.defaultPrevented = false
    this.target = null
    this.currentTarget = null
    this.timeStamp = g.performance.now()
  }
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true
  }
  stopPropagation() {}
  stopImmediatePropagation() {
    stopped.add(this)
  }
}
class EventTarget {
  #listeners = new Map()
  addEventListener(type, listener, options) {
    if (!listener) return
    const once = typeof options === 'object' && !!options?.once
    let list = this.#listeners.get(type)
    if (!list) this.#listeners.set(type, (list = []))
    if (!list.some((l) => l.listener === listener)) list.push({ listener, once })
    const signal = typeof options === 'object' ? options?.signal : undefined
    signal?.addEventListener('abort', () => this.removeEventListener(type, listener))
  }
  removeEventListener(type, listener) {
    const list = this.#listeners.get(type)
    if (!list) return
    const i = list.findIndex((l) => l.listener === listener)
    if (i >= 0) list.splice(i, 1)
  }
  dispatchEvent(event) {
    event.target = event.currentTarget = this
    const handler = this['on' + event.type]
    if (typeof handler === 'function') handler.call(this, event)
    for (const l of (this.#listeners.get(event.type) ?? []).slice()) {
      if (l.once) this.removeEventListener(event.type, l.listener)
      if (typeof l.listener === 'function') l.listener.call(this, event)
      else l.listener.handleEvent(event)
      if (stopped.has(event)) break
    }
    return !event.defaultPrevented
  }
}
g.Event = Event
g.EventTarget = EventTarget

class AbortSignal extends EventTarget {
  aborted = false
  reason = undefined
  onabort = null
  throwIfAborted() {
    if (this.aborted) throw this.reason
  }
  static abort(reason) {
    const c = new AbortController()
    c.abort(reason)
    return c.signal
  }
  static timeout(ms) {
    const c = new AbortController()
    g.setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms)
    return c.signal
  }
  static any(signals) {
    const c = new AbortController()
    for (const s of signals) {
      if (s.aborted) {
        c.abort(s.reason)
        break
      }
      s.addEventListener('abort', () => c.abort(s.reason), { once: true })
    }
    return c.signal
  }
}
class AbortController {
  signal = new AbortSignal()
  abort(reason = new DOMException('This operation was aborted', 'AbortError')) {
    const s = this.signal
    if (s.aborted) return
    s.aborted = true
    s.reason = reason
    s.dispatchEvent(new Event('abort'))
  }
}
g.AbortSignal = AbortSignal
g.AbortController = AbortController

// UTF-8
function utf8Length(s) {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d < 0xe000) {
        n += 4
        i++
      } else n += 3
    } else n += 3
  }
  return n
}
// Writes s from index `from` into out; stops before a character that doesn't fit.
function utf8Write(s, from, out) {
  let w = 0
  let i = from
  const cap = out.length
  for (; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c < 0x80) {
      if (w >= cap) break
      out[w++] = c
      continue
    }
    if (c < 0x800) {
      if (w + 2 > cap) break
      out[w++] = 0xc0 | (c >> 6)
      out[w++] = 0x80 | (c & 63)
      continue
    }
    if (c >= 0xd800 && c < 0xe000) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0
      if (c < 0xdc00 && d >= 0xdc00 && d < 0xe000) {
        if (w + 4 > cap) break
        const cp = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00)
        out[w++] = 0xf0 | (cp >> 18)
        out[w++] = 0x80 | ((cp >> 12) & 63)
        out[w++] = 0x80 | ((cp >> 6) & 63)
        out[w++] = 0x80 | (cp & 63)
        i++
        continue
      }
      c = 0xfffd
    }
    if (w + 3 > cap) break
    out[w++] = 0xe0 | (c >> 12)
    out[w++] = 0x80 | ((c >> 6) & 63)
    out[w++] = 0x80 | (c & 63)
  }
  return { read: i - from, written: w }
}
class TextEncoder {
  get encoding() {
    return 'utf-8'
  }
  encode(input) {
    const s = input === undefined ? '' : String(input)
    const out = new Uint8Array(utf8Length(s))
    utf8Write(s, 0, out)
    return out
  }
  encodeInto(input, target) {
    return utf8Write(String(input), 0, target)
  }
}
class TextDecoder {
  #fatal
  #ignoreBOM
  constructor(label = 'utf-8', options = {}) {
    if (!/^utf-?8$/i.test(label)) throw new RangeError('Unsupported encoding ' + label)
    this.#fatal = !!options.fatal
    this.#ignoreBOM = !!options.ignoreBOM
  }
  get encoding() {
    return 'utf-8'
  }
  decode(input) {
    if (input === undefined) return ''
    const b = ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input)
    let i = !this.#ignoreBOM && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0
    let s = ''
    const units = []
    while (i < b.length) {
      const c = b[i]
      let cp
      if (c < 0x80) {
        cp = c
        i++
      } else if (c >= 0xc2 && c < 0xe0 && (b[i + 1] & 0xc0) === 0x80) {
        cp = ((c & 31) << 6) | (b[i + 1] & 63)
        i += 2
      } else if (
        c >= 0xe0 &&
        c < 0xf0 &&
        (b[i + 1] & 0xc0) === 0x80 &&
        (b[i + 2] & 0xc0) === 0x80
      ) {
        cp = ((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63)
        i += 3
      } else if (
        c >= 0xf0 &&
        c < 0xf5 &&
        (b[i + 1] & 0xc0) === 0x80 &&
        (b[i + 2] & 0xc0) === 0x80 &&
        (b[i + 3] & 0xc0) === 0x80
      ) {
        cp = ((c & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63)
        i += 4
      } else {
        if (this.#fatal) throw new TypeError('The encoded data was not valid utf-8')
        cp = 0xfffd
        i++
      }
      if (cp > 0xffff) {
        cp -= 0x10000
        units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023))
      } else units.push(cp)
      if (units.length >= 8192) {
        s += String.fromCharCode.apply(null, units)
        units.length = 0
      }
    }
    return s + String.fromCharCode.apply(null, units)
  }
}
g.TextEncoder = TextEncoder
g.TextDecoder = TextDecoder

const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function btoa(input) {
  const s = String(input)
  let out = ''
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i)
    const b = s.charCodeAt(i + 1)
    const c = s.charCodeAt(i + 2)
    if (a > 255 || b > 255 || c > 255)
      throw new DOMException('Invalid character', 'InvalidCharacterError')
    const n = (a << 16) | ((b || 0) << 8) | (c || 0)
    out +=
      b64[n >> 18] +
      b64[(n >> 12) & 63] +
      (i + 1 < s.length ? b64[(n >> 6) & 63] : '=') +
      (i + 2 < s.length ? b64[n & 63] : '=')
  }
  return out
}
function atob(input) {
  const s = String(input)
    .replace(/[\t\n\f\r ]/g, '')
    .replace(/=+$/, '')
  let out = ''
  let bits = 0
  let acc = 0
  for (let i = 0; i < s.length; i++) {
    const v = b64.indexOf(s[i])
    if (v < 0) throw new DOMException('Invalid character', 'InvalidCharacterError')
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((acc >> bits) & 255)
    }
  }
  return out
}
g.btoa = btoa
g.atob = atob

g.crypto = {
  getRandomValues(array) {
    for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 256)
    return array
  },
  randomUUID() {
    const b = g.crypto.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 15) | 64
    b[8] = (b[8] & 63) | 128
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  },
}

function clone(value, seen) {
  if (typeof value !== 'object' || value === null) return value
  if (seen.has(value)) return seen.get(value)
  let out
  if (value instanceof Date) out = new Date(value.getTime())
  else if (value instanceof RegExp) out = new RegExp(value.source, value.flags)
  else if (ArrayBuffer.isView(value)) out = value.slice()
  else if (value instanceof ArrayBuffer) out = value.slice(0)
  else if (value instanceof Map) {
    out = new Map()
    seen.set(value, out)
    for (const [k, v] of value) out.set(clone(k, seen), clone(v, seen))
    return out
  } else if (value instanceof Set) {
    out = new Set()
    seen.set(value, out)
    for (const v of value) out.add(clone(v, seen))
    return out
  } else if (Array.isArray(value)) {
    out = []
    seen.set(value, out)
    for (const item of value) out.push(clone(item, seen))
    return out
  } else {
    out = {}
    seen.set(value, out)
    for (const k of Object.keys(value)) out[k] = clone(value[k], seen)
    return out
  }
  seen.set(value, out)
  return out
}
g.structuredClone = (value) => clone(value, new Map())

// Headers, Request, and Response: enough of Fetch for the renderer
class Headers {
  #map = new Map()
  constructor(init) {
    if (init == null) return
    if (init instanceof Headers) for (const [k, v] of init) this.append(k, v)
    else if (Array.isArray(init) || typeof init[Symbol.iterator] === 'function')
      for (const [k, v] of init) this.append(k, v)
    else for (const k of Object.keys(init)) this.append(k, init[k])
  }
  append(name, value) {
    const k = String(name).toLowerCase()
    const v = String(value).trim()
    const old = this.#map.get(k)
    if (old === undefined) this.#map.set(k, [v])
    else old.push(v)
  }
  set(name, value) {
    this.#map.set(String(name).toLowerCase(), [String(value).trim()])
  }
  get(name) {
    const v = this.#map.get(String(name).toLowerCase())
    return v === undefined ? null : v.join(', ')
  }
  getSetCookie() {
    return [...(this.#map.get('set-cookie') ?? [])]
  }
  has(name) {
    return this.#map.has(String(name).toLowerCase())
  }
  delete(name) {
    this.#map.delete(String(name).toLowerCase())
  }
  forEach(fn, thisArg) {
    for (const [k, v] of this) fn.call(thisArg, v, k, this)
  }
  *entries() {
    const keys = [...this.#map.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    for (const k of keys) {
      const v = this.#map.get(k)
      if (k === 'set-cookie') for (const c of v) yield [k, c]
      else yield [k, v.join(', ')]
    }
  }
  *keys() {
    for (const [k] of this) yield k
  }
  *values() {
    for (const [, v] of this) yield v
  }
  [Symbol.iterator]() {
    return this.entries()
  }
}
g.Headers = Headers

const encoder = new TextEncoder()
const decoder = new TextDecoder()
function toBytes(body) {
  if (body == null) return null
  if (typeof body === 'string') return encoder.encode(body)
  if (body instanceof Uint8Array) return body
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (body instanceof URLSearchParams) return encoder.encode(body.toString())
  return encoder.encode(String(body))
}
async function readAll(stream) {
  const reader = stream.getReader()
  const parts = []
  let length = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const bytes = typeof value === 'string' ? encoder.encode(value) : value
    parts.push(bytes)
    length += bytes.byteLength
  }
  const out = new Uint8Array(length)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.byteLength
  }
  return out
}
const initBody = Symbol('initBody')
class Body {
  #bytes
  #stream
  bodyUsed = false
  get body() {
    if (this.#stream) return this.#stream
    if (this.#bytes == null) return null
    const bytes = this.#bytes
    this.#stream = new ReadableStream({
      start(c) {
        c.enqueue(bytes)
        c.close()
      },
    })
    return this.#stream
  }
  [initBody](body) {
    if (body instanceof ReadableStream) this.#stream = body
    else this.#bytes = toBytes(body)
  }
  async bytes() {
    if (this.bodyUsed) throw new TypeError('Body already used')
    this.bodyUsed = true
    if (this.#bytes !== undefined && !this.#stream) return this.#bytes ?? new Uint8Array(0)
    if (!this.#stream) return new Uint8Array(0)
    return readAll(this.#stream)
  }
  async arrayBuffer() {
    const b = await this.bytes()
    return b.buffer.byteLength === b.byteLength && b.byteOffset === 0
      ? b.buffer
      : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  }
  async text() {
    return decoder.decode(await this.bytes())
  }
  async json() {
    return JSON.parse(await this.text())
  }
}
class Request extends Body {
  constructor(input, init = {}) {
    super()
    const from = input instanceof Request ? input : undefined
    this.url = from ? from.url : new URL(String(input)).href
    this.method = (init.method ?? from?.method ?? 'GET').toUpperCase()
    this.headers = new Headers(init.headers ?? from?.headers)
    this.signal = init.signal ?? from?.signal ?? new AbortController().signal
    this.redirect = init.redirect ?? 'follow'
    this.credentials = init.credentials ?? 'same-origin'
    this.mode = init.mode ?? 'cors'
    this.cache = init.cache ?? 'default'
    this[initBody](init.body ?? null)
  }
  clone() {
    return new Request(this)
  }
}
class Response extends Body {
  constructor(body = null, init = {}) {
    super()
    this.status = init.status ?? 200
    this.statusText = init.statusText ?? ''
    this.headers = new Headers(init.headers)
    this.type = 'default'
    this.url = ''
    this.redirected = false
    if (typeof body === 'string' && !this.headers.has('content-type'))
      this.headers.set('content-type', 'text/plain;charset=UTF-8')
    this[initBody](body)
  }
  get ok() {
    return this.status >= 200 && this.status < 300
  }
  static json(data, init = {}) {
    const headers = new Headers(init.headers)
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    return new Response(JSON.stringify(data), { ...init, headers })
  }
  static redirect(url, status = 302) {
    return new Response(null, { status, headers: { location: String(url) } })
  }
  static error() {
    const r = new Response(null, { status: 0 })
    r.type = 'error'
    return r
  }
}
g.Request = Request
g.Response = Response
// As in the render crate's bootstrap.js
g.fetch = () => {
  throw new Error('Render code must use setSend, not fetch')
}
