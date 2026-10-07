import { parse, type Node } from 'acorn'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

export type Ast = Node & {
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
export type Edit = { start: number; end: number; text: string }

const runtime = readFileSync(new URL('./prototype-runtime.js', import.meta.url), 'utf8').replace(
  /^export /gm,
  '',
)
const reads: Record<string, string> = {
  'Object.keys': 'renderProtoKeys',
  'Object.entries': 'renderProtoEntries',
  'Object.values': 'renderProtoValues',
  'Object.getOwnPropertyNames': 'renderProtoNames',
  'Object.getOwnPropertyDescriptors': 'renderProtoDescriptors',
  'Object.getOwnPropertyDescriptor': 'renderProtoDescriptor',
  'Reflect.ownKeys': 'renderProtoOwnKeys',
}

export function walk(node: Ast, visit: (node: Ast) => void) {
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
export function propertyKey(property: Ast): string | undefined {
  if (!property.key) return undefined
  if (!property.computed && property.key.type === 'Identifier') return property.key.name
  if (property.key.type === 'Literal' && ['string', 'number'].includes(typeof property.key.value))
    return String(property.key.value)
  return undefined
}

// Getter literals passed as props, with the reason a site keeps its literal.
export function propsSites(node: Ast) {
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
            : keys.some(
                  (key) =>
                    key === undefined ||
                    key === '__proto__' ||
                    key === 'constructor' ||
                    key === 'read',
                )
              ? 'key'
              : new Set(keys).size !== keys.length
                ? 'duplicate'
                : properties.some((p) => p.kind === 'get' && unsafeGetter(p.value))
                  ? 'receiver'
                  : undefined
      return { object, properties, keys, reason }
    })
}

export function rewritePrototypeProps(code: string) {
  if (code.includes('renderProto') || /Props\$\d/.test(code))
    throw new Error('Prototype props generated-name collision')
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true }) as Ast
  const edits: Edit[] = []
  let restId = 0
  const declarations: string[] = []
  const audit: { line: number; kind: string; expression: string; handling: string }[] = []
  let rewritten = 0
  const skipped: Record<string, number> = {}
  function edit(start: number, end: number, text: string) {
    edits.push({ start, end, text })
  }
  function wrap(node: Ast, helper: string) {
    edit(node.start, node.start, helper + '(')
    edit(node.end, node.end, ')')
  }
  function record(node: Ast, kind: string) {
    audit.push({
      line: node.loc!.start.line,
      kind,
      expression: code.slice(node.start, node.end),
      handling: 'Brand-guarded adapter; ordinary objects use the native operation',
    })
  }
  walk(ast, (node) => {
    if (
      ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    ) {
      const bindings: string[] = []
      for (const parameter of node.params) {
        const pattern = parameter.type === 'AssignmentPattern' ? parameter.left : parameter
        if (
          pattern.type !== 'ObjectPattern' ||
          !pattern.properties.some((p: Ast) => p.type === 'RestElement')
        )
          continue
        const name = 'renderProtoArg$' + restId++
        edit(pattern.start, pattern.end, name)
        bindings.push(
          'const ' +
            code.slice(pattern.start, pattern.end) +
            '=renderProtoRestSource(' +
            name +
            ');',
        )
        record(pattern, 'parameter object rest')
      }
      if (bindings.length) {
        if (node.body.type === 'BlockStatement')
          edit(node.body.start + 1, node.body.start + 1, bindings.join(''))
        else {
          edit(node.body.start, node.body.start, '{' + bindings.join('') + 'return ')
          edit(node.body.end, node.body.end, ';}')
        }
      }
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
      for (const { object, properties, keys, reason } of propsSites(node)) {
        if (reason) {
          skipped[reason] = (skipped[reason] ?? 0) + 1
          continue
        }
        const id = 'Props$' + rewritten++
        const fields: string[] = []
        const data: string[] = []
        const getters: string[] = []
        properties.forEach((property, index) => {
          const key = JSON.stringify(keys[index])
          if (property.kind === 'get') {
            edit(property.start, property.value.body.start, '() => ')
            fields.push('#v' + index + ';')
            data.push('this.#v' + index + '=v' + index + ';')
            getters.push('get [' + key + '](){return this.#v' + index + '()}')
          } else {
            edit(property.start, property.value.start, '')
            data.push('this[' + key + ']=v' + index + ';')
          }
        })
        edit(object.start, object.start + 1, 'new ' + id + '(')
        edit(object.end - 1, object.end, ')')
        declarations.push(
          'class ' +
            id +
            '{' +
            fields.join('') +
            'constructor(' +
            properties.map((_, index) => 'v' + index).join(',') +
            '){' +
            data.join('') +
            '}' +
            getters.join('') +
            '}\n' +
            'Object.defineProperty(' +
            id +
            '.prototype,renderProtoKeysSymbol,{value:' +
            JSON.stringify(keys) +
            '});\n' +
            properties
              .filter((p) => p.kind === 'get')
              .map(
                (p) =>
                  'Object.defineProperty(' +
                  id +
                  '.prototype,' +
                  JSON.stringify(propertyKey(p)) +
                  ',{enumerable:true});',
              )
              .join('\n'),
        )
      }
    }
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      !node.callee.computed
    ) {
      const name = node.callee.object.name + '.' + node.callee.property.name
      if (reads[name]) {
        edit(node.callee.start, node.callee.end, reads[name])
        record(node, name)
      }
      if (name === 'Object.assign') {
        for (const arg of node.arguments.slice(1))
          if (arg.type !== 'SpreadElement') wrap(arg, 'renderProtoSpread')
        record(node, name)
      }
    }
    if (node.type === 'ObjectExpression') {
      for (const property of node.properties) {
        if (property.type === 'SpreadElement') {
          wrap(property.argument, 'renderProtoSpread')
          record(property, 'object spread')
        }
      }
    }
    if (node.type === 'ForInStatement') {
      record(node, 'for in')
      audit[audit.length - 1].handling =
        'Native enumeration includes enumerable prototype keys; ordinary objects retain native behavior'
    }
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'ObjectPattern' &&
      node.id.properties.some((p: Ast) => p.type === 'RestElement') &&
      node.init
    ) {
      wrap(node.init, 'renderProtoRestSource')
      record(node, 'object rest')
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
          ? 'return renderProtoMerge(...sources);'
          : 'return renderProtoSplit(props,...keys);',
      )
    }
  })
  const chunks: string[] = []
  let cursor = code.length
  edits.sort((a, b) => b.start - a.start || b.end - a.end)
  for (const change of edits) {
    if (change.end > cursor) throw new Error('Overlapping prototype props edits')
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
  return { code: output, rewritten, skipped, audit }
}

export function prototypeProps(): Plugin {
  return {
    name: 'render-prototype-props',
    generateBundle(_options, bundle) {
      const plain = bundle['render.js']
      if (!plain || plain.type !== 'chunk') throw new Error('Missing plain render bundle')
      const result = rewritePrototypeProps(plain.code)
      this.emitFile({ type: 'asset', fileName: 'render.prototype.js', source: result.code })
      this.emitFile({
        type: 'asset',
        fileName: 'prototype-audit.json',
        source: JSON.stringify(
          { rewritten: result.rewritten, skipped: result.skipped, reads: result.audit },
          null,
          2,
        ),
      })
      console.log(
        'prototype-props:',
        result.rewritten,
        'rewritten;',
        JSON.stringify(result.skipped),
        'skipped',
      )
    },
  }
}
