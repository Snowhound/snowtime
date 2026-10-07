// Props layouts compared on one engine (task 081.20): getter literals, task 081.19's
// prototype getters, and Solid 2.0's shared own accessors.
//   node --allow-natives-syntax --expose-gc accessor-shapes.js
//   deno run --v8-flags=--allow-natives-syntax,--expose-gc accessor-shapes.js
//   bun accessor-shapes.js
// Each object has two lazy getters and one data prop, made the way compiled props are:
// fresh closures over render-local state.

const COUNT = 1_000_000
const DROPPED = 2_000
const engine = typeof Bun !== 'undefined' ? 'bun' : typeof Deno !== 'undefined' ? 'deno' : 'node'

function literal(signal, label) {
  return {
    get active() {
      return signal()
    },
    id: 1,
    get label() {
      return label
    },
  }
}

class Prototype {
  #active
  #label
  constructor(active, id, label) {
    this.#active = active
    this.id = id
    this.#label = label
  }
  get active() {
    return this.#active()
  }
  get label() {
    return this.#label()
  }
}
Object.defineProperty(Prototype.prototype, 'active', { enumerable: true })
Object.defineProperty(Prototype.prototype, 'label', { enumerable: true })
function prototype(signal, label) {
  return new Prototype(
    () => signal(),
    1,
    () => label,
  )
}

const activeSlot = Symbol()
const labelSlot = Symbol()
const activeDescriptor = {
  get() {
    return this[activeSlot]()
  },
  enumerable: true,
  configurable: true,
}
const labelDescriptor = {
  get() {
    return this[labelSlot]()
  },
  enumerable: true,
  configurable: true,
}
function Shared(active, id, label) {
  this[activeSlot] = active
  Object.defineProperty(this, 'active', activeDescriptor)
  this.id = id
  this[labelSlot] = label
  Object.defineProperty(this, 'label', labelDescriptor)
}
function shared(signal, label) {
  return new Shared(
    () => signal(),
    1,
    () => label,
  )
}

// Solid 2.0's full hoisting: getter bodies live in the shared descriptors, and slots hold
// the captured bindings instead of a closure per getter.
const signalSlot = Symbol()
const textSlot = Symbol()
const hoistedActive = {
  get() {
    const signal = this[signalSlot]
    return signal()
  },
  enumerable: true,
  configurable: true,
}
const hoistedLabel = {
  get() {
    return this[textSlot]
  },
  enumerable: true,
  configurable: true,
}
function Hoisted(signal, id, label) {
  this[signalSlot] = signal
  Object.defineProperty(this, 'active', hoistedActive)
  this.id = id
  this[textSlot] = label
  Object.defineProperty(this, 'label', hoistedLabel)
}
function hoisted(signal, label) {
  return new Hoisted(signal, 1, label)
}

const layouts = { literal, prototype, shared, hoisted }

function native(body) {
  return new Function('a', 'b', 'return ' + body)
}
let sameMap, fastProperties
try {
  sameMap = native('%HaveSameMap(a, b)')
  fastProperties = native('%HasFastProperties(a)')
} catch {}
let jsc
if (engine === 'bun') jsc = await import('bun:jsc')
let v8
if (engine !== 'bun') v8 = await import('node:v8')

function oldSpace() {
  return v8.getHeapSpaceStatistics().find((space) => space.space_name === 'old_space')
    .space_used_size
}
function structure(object) {
  return /StructureID: (\d+)/.exec(jsc.describe(object))?.[1]
}

function make(layout, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const value = i
    out.push(layout(() => value, 'item ' + i))
  }
  return out
}

function create(layout) {
  let sink = 0
  const start = performance.now()
  for (let i = 0; i < COUNT; i++) {
    const value = i
    const object = layout(() => value, 'x')
    sink += object.id
  }
  const ms = performance.now() - start
  if (sink !== COUNT) throw new Error('sink')
  return ms
}

function promoted(layout) {
  // Old-space growth when 2,000 dead objects meet a minor GC: what survives through
  // old-to-new roots, plus what the engine allocated directly in old space.
  globalThis.gc()
  globalThis.gc()
  const before = oldSpace()
  let objects = make(layout, DROPPED)
  const allocated = oldSpace() - before
  objects = undefined
  globalThis.gc({ type: 'minor' })
  const afterMinor = oldSpace() - before
  globalThis.gc({ type: 'minor' })
  return { allocated, afterMinor, afterTwoMinors: oldSpace() - before, objects }
}

function check(name) {
  const [a, b] = make(layouts[name], 2)
  const keys = Object.keys(a).join(',')
  const values = [a.active, a.label, b.active, b.label].join(',')
  const row = { keys, values }
  if (sameMap) {
    row.sameMap = sameMap(a, b)
    row.fast = fastProperties(a) && fastProperties(b)
  }
  if (jsc) row.sameStructure = structure(a) !== undefined && structure(a) === structure(b)
  return row
}

const version =
  engine === 'bun' ? Bun.version : engine === 'deno' ? Deno.version.v8 : process.versions.v8
const rows = []
for (const name of Object.keys(layouts)) {
  // Warm every layout before timing any of them.
  create(layouts[name])
}
for (const name of Object.keys(layouts)) {
  const times = [create(layouts[name]), create(layouts[name]), create(layouts[name])]
  const row = { engine, version, layout: name, ...check(name), create_ms: Math.min(...times) }
  if (v8 && globalThis.gc) {
    const samples = [promoted(layouts[name]), promoted(layouts[name]), promoted(layouts[name])]
    for (const key of ['allocated', 'afterMinor', 'afterTwoMinors'])
      row[key + '_kb'] = Math.round(Math.min(...samples.map((s) => s[key])) / 1024)
  }
  if (jsc) {
    jsc.fullGC()
    const before = jsc.heapSize()
    let objects = make(layouts[name], DROPPED)
    objects = undefined
    jsc.edenGC()
    row.afterEden_kb = Math.round((jsc.heapSize() - before) / 1024)
    row.objects = objects
  }
  delete row.objects
  rows.push(row)
}
for (const row of rows) console.log(JSON.stringify(row))
