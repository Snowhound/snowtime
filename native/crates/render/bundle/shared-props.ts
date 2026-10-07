import { parse, type Node } from 'acorn'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

// Solid 2.0's hoisted props (solid#3550): each site's getters stay own accessors, defined
// from one shared descriptor per key that reads the site's closure from a symbol slot.
const runtime = readFileSync(new URL('./shared-runtime.js', import.meta.url), 'utf8').replace(
  /^export /gm,
  '',
)

type Ast = Node & {
  [key: string]: unknown
  name: string
  value: unknown
  computed: boolean
  method: boolean
  kind: string
  key: Ast
  body: Ast & { body: Ast[] }
  callee: Ast & { object: Ast; property: Ast }
  arguments: Ast[]
  properties: Ast[]
  params: Ast[]
  left: Ast
  id: Ast
  init: Ast
  argument: Ast
}
type Edit = { start: number; end: number; text: string }

function walk(node: Ast, visit: (node: Ast) => void) {
  visit(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value)
        if (child && typeof child === 'object' && 'type' in child) walk(child as Ast, visit)
    } else if (value && typeof value === 'object' && 'type' in value) walk(value as Ast, visit)
  }
}
function unsafeGetter(node: Ast) {
  let unsafe = false
  walk(node, (child) => {
    if (
      child.type === 'ThisExpression' ||
      child.type === 'Super' ||
      child.type === 'MetaProperty' ||
      (child.type === 'Identifier' && child.name === 'arguments')
    )
      unsafe = true
  })
  return unsafe
}
function propertyKey(property: Ast): string | undefined {
  if (!property.key) return undefined
  if (!property.computed && property.key.type === 'Identifier') return property.key.name
  if (property.key.type === 'Literal' && ['string', 'number'].includes(typeof property.key.value))
    return String(property.key.value)
  return undefined
}

// Getter literals passed as props, with the reason a site keeps its literal.
function propsSites(node: Ast) {
  if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') return []
  const name = node.callee.name
  const candidates =
    name === 'mergeProps'
      ? node.arguments
      : ['createComponent', 'ssrElement'].includes(name)
        ? [node.arguments[1]]
        : []
  return candidates
    .filter(
      (object) =>
        object?.type === 'ObjectExpression' && object.properties.some((p: Ast) => p.kind === 'get'),
    )
    .map((object) => {
      const properties: Ast[] = object.properties
      const keys = properties.map(propertyKey)
      const reason = properties.some((p) => p.type === 'SpreadElement')
        ? 'spread'
        : properties.some((p) => p.kind === 'set')
          ? 'setter'
          : properties.some((p) => p.method)
            ? 'method'
            : keys.some((key) => key === undefined || key === '__proto__' || key === 'constructor')
              ? 'key'
              : new Set(keys).size !== keys.length
                ? 'duplicate'
                : properties.some((p) => p.kind === 'get' && unsafeGetter(p.value))
                  ? 'receiver'
                  : undefined
      return { object, properties, keys, reason }
    })
}

export function rewriteSharedProps(code: string) {
  if (code.includes('renderShared') || /SharedProps\$\d/.test(code))
    throw new Error('Shared props generated-name collision')
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'script' }) as Ast
  const edits: Edit[] = []
  const declarations: string[] = []
  const descriptors = new Map<string, string>()
  const skipped: Record<string, number> = {}
  let rewritten = 0
  function edit(start: number, end: number, text: string) {
    edits.push({ start, end, text })
  }
  function descriptor(key: string) {
    let name = descriptors.get(key)
    if (!name) {
      name = 'renderShared$' + descriptors.size
      descriptors.set(key, name)
      declarations.push(
        'const ' +
          name +
          'Slot=Symbol(' +
          JSON.stringify(key) +
          '),' +
          name +
          '=renderSharedSite(' +
          name +
          'Slot);',
      )
    }
    return name
  }
  walk(ast, (node) => {
    for (const { object, properties, keys, reason } of propsSites(node)) {
      if (reason) {
        skipped[reason] = (skipped[reason] ?? 0) + 1
        continue
      }
      const id = 'SharedProps$' + rewritten++
      const body = properties.map((property, index) => {
        const key = JSON.stringify(keys[index])
        if (property.kind !== 'get') {
          edit(property.start, property.value.start, '')
          return 'this[' + key + ']=v' + index + ';'
        }
        edit(property.start, property.value.body.start, '() => ')
        const shared = descriptor(keys[index]!)
        return (
          'this[' +
          shared +
          'Slot]=v' +
          index +
          ';Object.defineProperty(this,' +
          key +
          ',' +
          shared +
          ');'
        )
      })
      edit(object.start, object.start + 1, 'new ' + id + '(')
      edit(object.end - 1, object.end, ')')
      declarations.push(
        'function ' +
          id +
          '(' +
          properties.map((_, index) => 'v' + index).join(',') +
          '){' +
          body.join('') +
          '}' +
          id +
          '.prototype=Object.prototype;',
      )
    }
  })
  // Find helpers by AST rather than assuming the bundler's IIFE style.
  walk(ast, (node) => {
    if (
      node.type === 'FunctionDeclaration' &&
      ['mergeProps', 'splitProps'].includes(node.id.name)
    ) {
      edits.splice(
        0,
        edits.length,
        ...edits.filter((e) => e.start < node.body.start || e.start >= node.body.end),
      )
      edit(
        node.body.start + 1,
        node.body.end - 1,
        node.id.name === 'mergeProps'
          ? 'return renderSharedMerge(...sources);'
          : 'return renderSharedSplit(props,...keys);',
      )
    }
  })
  const chunks: string[] = []
  let cursor = code.length
  edits.sort((a, b) => b.start - a.start || b.end - a.end)
  for (const change of edits) {
    if (change.end > cursor) throw new Error('Overlapping shared props edits')
    chunks.push(code.slice(change.end, cursor), change.text)
    cursor = change.start
  }
  chunks.push(code.slice(0, cursor))
  let output = chunks.toReversed().join('')
  const iife = output.indexOf('(function')
  if (iife < 0) throw new Error('Expected an IIFE server bundle')
  const anchor = output.indexOf('{', iife) + 1
  output =
    output.slice(0, anchor) +
    '\n' +
    runtime +
    '\n' +
    declarations.join('\n') +
    '\n' +
    output.slice(anchor)
  output = output.replace(/\/\/# sourceMappingURL=.*$/m, '')
  parse(output, { ecmaVersion: 'latest', sourceType: 'script' })
  return { code: output, rewritten, skipped, descriptors: descriptors.size }
}

export function sharedProps(): Plugin {
  return {
    name: 'render-shared-props',
    generateBundle(_options, bundle) {
      const plain = bundle['render.js']
      if (!plain || plain.type !== 'chunk') throw new Error('Missing plain render bundle')
      const result = rewriteSharedProps(plain.code)
      this.emitFile({ type: 'asset', fileName: 'render.shared.js', source: result.code })
      console.log(
        'shared-props:',
        result.rewritten,
        'rewritten;',
        JSON.stringify(result.skipped),
        'skipped;',
        result.descriptors,
        'shared descriptors',
      )
    },
  }
}
