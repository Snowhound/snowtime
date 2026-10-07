const renderProtoKeysSymbol = Symbol('server props keys')
const renderProtoReadSymbol = Symbol('server props read')
const renderProtoLayouts = new Map()

function renderProtoOwnKeys(value) {
  if (!value?.[renderProtoKeysSymbol]) return Reflect.ownKeys(value)
  const declared = value[renderProtoKeysSymbol]
  const extra = Reflect.ownKeys(value).filter(
    (key) => key !== renderProtoKeysSymbol && !declared.includes(key),
  )
  return extra.length ? [...declared, ...extra] : declared
}
function renderProtoSourceDescriptor(value, key) {
  return (
    Object.getOwnPropertyDescriptor(value, key) ||
    (value?.[renderProtoKeysSymbol]?.includes(key)
      ? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value), key)
      : undefined)
  )
}
function renderProtoDescriptor(value, key) {
  const own = Object.getOwnPropertyDescriptor(value, key)
  if (own || !value?.[renderProtoKeysSymbol]?.includes(key)) return own
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value), key)
  return (
    descriptor && {
      ...descriptor,
      get() {
        return value[key]
      },
    }
  )
}
export function renderProtoDescriptors(value) {
  if (!value?.[renderProtoKeysSymbol]) return Object.getOwnPropertyDescriptors(value)
  return Object.fromEntries(
    renderProtoOwnKeys(value).map((key) => [key, renderProtoDescriptor(value, key)]),
  )
}
function renderProtoKeys(value) {
  if (!value?.[renderProtoKeysSymbol]) return Object.keys(value)
  return renderProtoOwnKeys(value).filter(
    (key) => typeof key === 'string' && renderProtoSourceDescriptor(value, key)?.enumerable,
  )
}
export function renderProtoNames(value) {
  if (!value?.[renderProtoKeysSymbol]) return Object.getOwnPropertyNames(value)
  return renderProtoOwnKeys(value).filter((key) => typeof key === 'string')
}
export function renderProtoEntries(value) {
  if (!value?.[renderProtoKeysSymbol]) return Object.entries(value)
  return renderProtoKeys(value).map((key) => [key, value[key]])
}
export function renderProtoValues(value) {
  if (!value?.[renderProtoKeysSymbol]) return Object.values(value)
  return renderProtoKeys(value).map((key) => value[key])
}
export function renderProtoSpread(value) {
  if (!value?.[renderProtoKeysSymbol]) return value
  const out = {}
  for (const key of renderProtoOwnKeys(value)) {
    if (renderProtoSourceDescriptor(value, key)?.enumerable)
      Object.defineProperty(out, key, {
        value: value[key],
        writable: true,
        enumerable: true,
        configurable: true,
      })
  }
  return out
}
export function renderProtoRestSource(value) {
  if (!value?.[renderProtoKeysSymbol]) return value
  // Native destructuring chooses the named getter order before enumerating rest.
  return Object.defineProperties({}, renderProtoDescriptors(value))
}
function renderProtoView(keys, state, mode, flags) {
  // Cache only shapes and shared accessors. Never retain a render's source objects.
  const shape = JSON.stringify([mode, keys, flags])
  let View = renderProtoLayouts.get(shape)
  if (!View) {
    View = class {
      #state
      constructor(input) {
        this.#state = input
      }
      [renderProtoReadSymbol](key) {
        if (mode === 'split') return this.#state[key]
        for (let i = this.#state.length - 1; i >= 0; i--) {
          let source = this.#state[i]
          if (typeof source === 'function') source = source()
          const value = (source || {})[key]
          if (value !== undefined) return value
        }
        return undefined
      }
    }
    Object.defineProperty(View.prototype, renderProtoKeysSymbol, { value: keys })
    keys.forEach((key, index) =>
      Object.defineProperty(View.prototype, key, {
        enumerable: flags ? flags[index][0] : true,
        configurable: flags ? flags[index][1] : false,
        get() {
          return this[renderProtoReadSymbol](key)
        },
      }),
    )
    // Arbitrary prop names must not grow a process-wide cache without a bound.
    if (renderProtoLayouts.size === 512)
      renderProtoLayouts.delete(renderProtoLayouts.keys().next().value)
    renderProtoLayouts.set(shape, View)
  }
  return new View(state)
}
export function renderProtoMerge(...sources) {
  const keys = []
  const seen = new Set()
  for (let source of sources) {
    if (typeof source === 'function') source = source()
    if (!source) continue
    if (source[renderProtoKeysSymbol]) {
      for (const key of renderProtoOwnKeys(source)) add(key)
    } else {
      const descriptors = Object.getOwnPropertyDescriptors(source)
      for (const key in descriptors) add(key)
    }
  }
  function add(key) {
    if (typeof key !== 'string' || key === '__proto__' || key === 'constructor' || seen.has(key))
      return
    seen.add(key)
    keys.push(key)
  }
  return renderProtoView(keys, sources, 'merge')
}
export function renderProtoSplit(props, ...groups) {
  const branded = !!props?.[renderProtoKeysSymbol]
  // Enumerate a Proxy once, preserving its descriptor traps without reading getters.
  const descriptors = branded ? undefined : Object.getOwnPropertyDescriptors(props)
  const available = new Set(branded ? renderProtoOwnKeys(props) : Reflect.ownKeys(descriptors))
  function descriptor(key) {
    return branded ? renderProtoSourceDescriptor(props, key) : descriptors[key]
  }
  function split(keys) {
    const lazy = [],
      data = [],
      selected = [],
      flags = []
    for (const key of keys) {
      if (!available.has(key)) continue
      const d = descriptor(key)
      if (!d) continue
      available.delete(key)
      selected.push(key)
      if ('value' in d || d.set || typeof key === 'symbol') data.push([key, d])
      else {
        lazy.push(key)
        flags.push([d.enumerable, d.configurable])
      }
    }
    const out = renderProtoView(lazy, props, 'split', flags)
    for (const [key, d] of data) Object.defineProperty(out, key, d)
    Object.defineProperty(out, renderProtoKeysSymbol, { value: selected })
    return out
  }
  return groups.map(split).concat(split([...available].filter((key) => typeof key === 'string')))
}
