import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { transformServerProps } from './solid-props'

type Merge = (...sources: unknown[]) => Record<PropertyKey, unknown>
const source = readFileSync('node_modules/solid-js/dist/server.js', 'utf8')
function helper(code: string): Merge {
  const start = code.indexOf('function mergeProps(')
  const end = code.indexOf('function splitProps(', start)
  // oxlint-disable-next-line typescript/no-implied-eval -- Compare the installed server helper with its transformed source.
  return new Function(code.slice(start, end) + ';return mergeProps')() as Merge
}
const original = helper(source)
const candidate = helper(transformServerProps(source))

function exercise(merge: Merge) {
  const traps: string[] = []
  const symbol = Symbol('hidden')
  const base = Object.create(null)
  Object.defineProperties(base, {
    hidden: { value: 3 },
    value: {
      enumerable: true,
      configurable: true,
      get() {
        traps.push('get value')
        return 4
      },
    },
    absent: { value: undefined, enumerable: true },
    constructor: { value: 'skip' },
    __proto__: { value: 'skip' },
  })
  Object.defineProperty(base, '__proto__', { value: 'skip' })
  base[symbol] = 9
  const proxy = new Proxy(base, {
    ownKeys(target) {
      traps.push('keys')
      return Reflect.ownKeys(target)
    },
    getOwnPropertyDescriptor(target, key) {
      traps.push('descriptor ' + String(key))
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  let latest: number | undefined = 5
  const result = merge(
    { absent: 2, value: 1 },
    () => {
      traps.push('source')
      return proxy
    },
    {
      get value() {
        return latest
      },
    },
    'ab',
    42,
  )
  const construction = [...traps]
  const values = Object.keys(result).map((key) => [key, result[key]])
  latest = undefined
  const fallback = result.value
  latest = 7
  const changed = result.value
  const descriptors = Reflect.ownKeys(result).map((key) => {
    const d = Object.getOwnPropertyDescriptor(result, key)!
    return [String(key), d.enumerable, d.configurable, 'get' in d, 'set' in d]
  })
  return {
    construction,
    traps,
    values,
    fallback,
    changed,
    descriptors,
    prototype: Object.getPrototypeOf(result) === Object.prototype,
  }
}
test('preserves lazy props, descriptors, primitives, and proxy trap order', () => {
  expect(exercise(candidate)).toEqual(exercise(original))
})
test('preserves absent proxy keys and throwing descriptor traps', () => {
  for (const merge of [original, candidate]) {
    const absent = new Proxy(
      {},
      {
        ownKeys: () => ['missing'],
        getOwnPropertyDescriptor: () => undefined,
      },
    )
    expect(Object.keys(merge(absent))).toEqual([])
    expect(() =>
      merge(
        new Proxy(
          {},
          {
            ownKeys: () => ['fail'],
            getOwnPropertyDescriptor() {
              throw new Error('descriptor failed')
            },
          },
        ),
      ),
    ).toThrow('descriptor failed')
    expect(merge(null, undefined, false, 0).anything).toBeUndefined()
  }
})
test('fails closed when the upstream implementation changes', () => {
  expect(() => transformServerProps('different mergeProps')).toThrow('Unsupported')
  expect(() => transformServerProps(source.replace('v !== undefined', 'v !== null'))).toThrow(
    'Unsupported',
  )
})

test('fails closed when upstream splitProps changes', () => {
  expect(() =>
    transformServerProps(source.replace('keys.map(split).concat', 'keys.map(other).concat')),
  ).toThrow('Unsupported')
})

test('preserves inherited enumerable descriptor-map keys', () => {
  const key = 'renderPropsInheritedTest'
  try {
    // oxlint-disable-next-line no-extend-native -- Verify inherited descriptor-map keys, then remove the fixture in finally.
    Object.defineProperty(Object.prototype, key, {
      value: 11,
      enumerable: true,
      configurable: true,
    })
    for (const merge of [original, candidate]) {
      const result = merge({ value: 1 })
      expect(Object.keys(result)).toEqual(['value', key])
      expect(result[key]).toBe(11)
    }
  } finally {
    Reflect.deleteProperty(Object.prototype, key)
  }
})
