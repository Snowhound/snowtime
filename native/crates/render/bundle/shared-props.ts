import { parse } from 'acorn'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { propsSites, walk, type Ast, type Edit } from './prototype-props'

// Solid 2.0's hoisted props (solid#3550): each site's getters stay own accessors, defined
// from one shared descriptor per key that reads the site's closure from a symbol slot.
const runtime = readFileSync(new URL('./shared-runtime.js', import.meta.url), 'utf8').replace(
  /^export /gm,
  '',
)

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
