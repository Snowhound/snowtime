import type { Plugin } from 'vite'

// Lucide's Icon renders each path of an icon through Dynamic, which costs a mergeProps and
// a splitProps per path. A string element name renders as Dynamic would render it: one
// ssrElement with a hydration key, inside the same createComponent call.
const original = '_$createComponent(Dynamic, _$mergeProps({ component: elementName }, attrs))'
const replacement =
  '(typeof elementName === "string" ? _$createComponent(() => _$ssrElement(elementName, attrs, void 0, true)) : ' +
  original +
  ')'

export function transformLucideNodes(code: string) {
  if (code.split(original).length !== 2 || !code.includes('_$ssrElement'))
    throw new Error('Unsupported lucide-solid Icon implementation')
  return code.replace(original, replacement)
}

export function lucideNodes(): Plugin {
  return {
    name: 'render-lucide-nodes',
    enforce: 'post',
    transform(code, id) {
      if (!id.endsWith('/lucide-solid/dist/source/Icon.jsx')) return null
      // The replacement keeps lines, so the module's own source map still applies.
      return { code: transformLucideNodes(code), map: null }
    },
  }
}
