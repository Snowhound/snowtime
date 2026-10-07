globalThis.renderApiCalls = {}
function record(name, args) {
  const sizes = args.map((value) =>
    typeof value === 'string'
      ? 'string:' + value.length
      : ArrayBuffer.isView(value)
        ? 'bytes:' + value.byteLength
        : value instanceof ArrayBuffer
          ? 'bytes:' + value.byteLength
          : Array.isArray(value)
            ? 'array:' + value.length
            : typeof value,
  )
  const key = name + '(' + sizes.join(',') + ')'
  renderApiCalls[key] = (renderApiCalls[key] ?? 0) + 1
}
for (const name of [
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'Headers',
  'Request',
  'Response',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'AbortController',
  'Blob',
  'File',
]) {
  const constructor = globalThis[name]
  if (!constructor) continue
  for (const method of Object.getOwnPropertyNames(constructor.prototype)) {
    if (method === 'constructor') continue
    const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, method)
    if (typeof descriptor?.value !== 'function') continue
    const original = descriptor.value
    Object.defineProperty(constructor.prototype, method, {
      ...descriptor,
      value: function (...args) {
        record(name + '.' + method, args)
        return Reflect.apply(original, this, args)
      },
    })
  }
  globalThis[name] = new Proxy(constructor, {
    construct(target, args, newTarget) {
      record(name, args)
      return Reflect.construct(target, args, newTarget)
    },
  })
}
const clone = globalThis.structuredClone
globalThis.structuredClone = function (...args) {
  record('structuredClone', args)
  return Reflect.apply(clone, this, args)
}

const intlCalls = []
renderApiCalls.intlCalls = intlCalls
const formatterIds = new WeakMap()
let nextFormatterId = 1
const formatParts = Intl.DateTimeFormat.prototype.formatToParts
Intl.DateTimeFormat.prototype.formatToParts = function (...args) {
  let id = formatterIds.get(this)
  if (!id) {
    id = nextFormatterId++
    formatterIds.set(this, id)
  }
  intlCalls.push({ formatter: id, options: this.resolvedOptions(), value: args[0] })
  return Reflect.apply(formatParts, this, args)
}
