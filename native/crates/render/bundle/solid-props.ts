import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'

// Keep descriptor traps while avoiding descriptor objects that mergeProps never reads.
const original =
  'const descriptors = Object.getOwnPropertyDescriptors(source);\n      for (const key in descriptors) {'
const replacement =
  'const keys = Reflect.ownKeys(Object(source)).filter((key) => Object.prototype.hasOwnProperty.call(source, key)); for (const key in Object.prototype) if (!keys.includes(key)) keys.push(key);\n      for (const key of keys) {'

export function transformServerProps(code: string) {
  const start = code.indexOf('function mergeProps(')
  const end = code.indexOf('function splitProps(', start)
  if (
    start < 0 ||
    end < 0 ||
    createHash('sha256').update(code.slice(start, end)).digest('hex') !==
      '710f8b96c778dadbf7b9cbbc11f481caca5eaaa47fc9c8d660653c9df19cd5c3'
  )
    throw new Error('Unsupported Solid server mergeProps implementation')
  return code
    .replace(original, replacement)
    .replace(
      'if (key === "__proto__" || key === "constructor" ||',
      'if (typeof key === "symbol" || key === "__proto__" || key === "constructor" ||',
    )
}

export function serverProps(): Plugin {
  return {
    name: 'render-server-props',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/solid-js/dist/server.js')) return null
      return {
        code: transformServerProps(code),
        // The replacement preserves lines; retain line attribution to the upstream source.
        map: {
          version: 3,
          names: [],
          sources: [id],
          sourcesContent: [code],
          mappings: code
            .split('\n')
            .map((_, index) => (index ? 'AACA' : 'AAAA'))
            .join(';'),
        },
      }
    },
  }
}
