// Every shared getter reads its receiver, so splitProps re-homes a copy of one.
const renderSharedGetters = new WeakSet()
const renderSharedMergeSlot = Symbol('merged sources')
const renderSharedSplitSlot = Symbol('split source')
// A merge result's own reference and key count. splitProps copies its getters directly
// unless keys were added to it; a spread copy or an object inheriting it fails the check.
const renderSharedMergedSlot = Symbol('merge target')
const renderSharedMergedCountSlot = Symbol('merged keys')
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
  let count = 0
  let inherited
  for (const key in Object.prototype) (inherited ??= []).push(key)
  for (let i = 0; i < sources.length; i++) {
    let source = sources[i]
    if (typeof source === 'function') source = source()
    if (source) {
      // Keep descriptor traps while avoiding descriptor objects that mergeProps never reads.
      // Symbols are never merged, so only names are listed.
      const names = Object.getOwnPropertyNames(Object(source))
      for (let j = 0; j < names.length; j++)
        if (Object.hasOwn(source, names[j])) count += renderSharedMergeKey(target, names[j])
      if (inherited)
        for (const key of inherited)
          if (!names.includes(key) || !Object.hasOwn(source, key))
            count += renderSharedMergeKey(target, key)
    }
  }
  target[renderSharedMergedSlot] = target
  target[renderSharedMergedCountSlot] = count
  return target
}
function renderSharedMergeKey(target, key) {
  if (key === '__proto__' || key === 'constructor' || Object.hasOwn(target, key)) return 0
  Object.defineProperty(target, key, renderSharedMergeDescriptor(key))
  return 1
}
// Merge getters are non-configurable, so a merge result whose name count is unchanged has
// only them. Each part gets the same sources and getters, in splitProps' key order.
function renderSharedSplitMerged(props, keys) {
  const names = Object.getOwnPropertyNames(props)
  if (names.length !== props[renderSharedMergedCountSlot]) return undefined
  const sources = props[renderSharedMergeSlot]
  function split(k, all) {
    const clone = {}
    let count = 0
    for (let i = 0; i < k.length; i++) {
      const key = k[i]
      const at = all ? i : names.indexOf(key)
      if (at < 0 || names[at] === undefined) continue
      if (!count) clone[renderSharedMergeSlot] = sources
      Object.defineProperty(clone, key, renderSharedMergeDescriptor(key))
      names[at] = undefined
      count++
    }
    if (count) {
      clone[renderSharedMergedSlot] = clone
      clone[renderSharedMergedCountSlot] = count
    }
    return clone
  }
  const parts = keys.map((k) => split(k, false))
  parts.push(split(names, true))
  return parts
}
export function renderSharedSplit(props, ...keys) {
  if (props[renderSharedMergedSlot] === props) {
    const parts = renderSharedSplitMerged(props, keys)
    if (parts) return parts
  }
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
      } else if (
        descriptor.writable &&
        descriptor.enumerable &&
        descriptor.configurable &&
        typeof key === 'string' &&
        key !== '__proto__'
      )
        // The same own data property, without a runtime call.
        clone[key] = descriptor.value
      else Object.defineProperty(clone, key, descriptor)
      // Deleting would turn the descriptor map into a dictionary.
      descriptors[key] = undefined
    }
    return clone
  }
  const parts = keys.map(split)
  parts.push(split(Object.keys(descriptors).filter((key) => descriptors[key] !== undefined)))
  return parts
}
