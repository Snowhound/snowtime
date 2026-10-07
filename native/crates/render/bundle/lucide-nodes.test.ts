import { expect, test } from 'bun:test'
import { transformLucideNodes } from './lucide-nodes'

const icon =
  'return _$ssrElement("svg", attrs, () => _$createComponent(Dynamic, _$mergeProps({ component: elementName }, attrs)));'

test('renders string elements without Dynamic and keeps Dynamic for the rest', () => {
  const code = transformLucideNodes(icon)
  expect(code).toContain(
    'typeof elementName === "string" ? _$createComponent(() => _$ssrElement(elementName, attrs, void 0, true))',
  )
  expect(code).toContain(
    ': _$createComponent(Dynamic, _$mergeProps({ component: elementName }, attrs))',
  )
  expect(code.split('\n')).toHaveLength(icon.split('\n').length)
})

test('fails on a changed Icon', () => {
  expect(() => transformLucideNodes(icon.replace('elementName', 'name'))).toThrow(
    'Unsupported lucide-solid Icon implementation',
  )
})
