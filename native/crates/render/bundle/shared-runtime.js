// Every shared getter reads its receiver, so splitProps re-homes a copy of one.
const renderSharedGetters = new WeakSet()
const renderSharedMergeSlot = Symbol('merged sources')
const renderSharedSplitSlot = Symbol('split source')
const renderSharedMerges = new Map()
const renderSharedSplits = new Map()

export function renderSharedSite(slot) {
  const descriptor = {
    get() {
      return this[slot]()
    },
    enumerable: true,
    configurable: true,
  }
  // oxlint-disable-next-line typescript/unbound-method -- Registered by identity, never called unbound.
  renderSharedGetters.add(descriptor.get)
  return descriptor
}
function renderSharedCache(cache, key, make) {
  let descriptor = cache.get(key)
  if (!descriptor) {
    descriptor = make()
    renderSharedGetters.add(descriptor.get)
    // Arbitrary prop names must not grow a process-wide cache without a bound.
    if (cache.size === 4096) cache.delete(cache.keys().next().value)
    cache.set(key, descriptor)
  }
  return descriptor
}
function renderSharedMergeDescriptor(key) {
  return renderSharedCache(renderSharedMerges, key, () => ({
    enumerable: true,
    get() {
      const sources = this[renderSharedMergeSlot]
      for (let i = sources.length - 1; i >= 0; i--) {
        let v,
          s = sources[i]
        if (typeof s === 'function') s = s()
        v = (s || {})[key]
        if (v !== undefined) return v
      }
      return undefined
    },
  }))
}
function renderSharedSplitDescriptor(key, enumerable, configurable) {
  return renderSharedCache(
    renderSharedSplits,
    (enumerable ? 'e' : '-') + (configurable ? 'c' : '-') + key,
    () => ({
      enumerable,
      configurable,
      get() {
        return this[renderSharedSplitSlot][key]
      },
    }),
  )
}
export function renderSharedMerge(...sources) {
  const target = {}
  target[renderSharedMergeSlot] = sources
  for (let i = 0; i < sources.length; i++) {
    let source = sources[i]
    if (typeof source === 'function') source = source()
    if (source) {
      // Keep descriptor traps while avoiding descriptor objects that mergeProps never reads.
      const keys = Reflect.ownKeys(Object(source)).filter((key) => Object.hasOwn(source, key))
      for (const key in Object.prototype) if (!keys.includes(key)) keys.push(key)
      for (const key of keys) {
        if (
          typeof key === 'symbol' ||
          key === '__proto__' ||
          key === 'constructor' ||
          Object.hasOwn(target, key)
        )
          continue
        Object.defineProperty(target, key, renderSharedMergeDescriptor(key))
      }
    }
  }
  return target
}
export function renderSharedSplit(props, ...keys) {
  const descriptors = Object.getOwnPropertyDescriptors(props)
  function split(k) {
    const clone = {}
    let homed = false
    for (let i = 0; i < k.length; i++) {
      const key = k[i]
      const descriptor = descriptors[key]
      if (!descriptor) continue
      if (descriptor.get && renderSharedGetters.has(descriptor.get)) {
        if (!homed) {
          clone[renderSharedSplitSlot] = props
          homed = true
        }
        Object.defineProperty(
          clone,
          key,
          renderSharedSplitDescriptor(key, descriptor.enumerable, descriptor.configurable),
        )
      } else Object.defineProperty(clone, key, descriptor)
      delete descriptors[key]
    }
    return clone
  }
  return keys.map(split).concat(split(Object.keys(descriptors)))
}
