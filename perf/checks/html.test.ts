import { expect, test } from 'bun:test'
import { htmlParts } from './html'

test('partitions UTF-8 documents without counting script markers twice', () => {
  const query = '$R[1]={query:{initial:[{state:{data:"õ"}}]}}'
  const html =
    '<p data-hk="001" class="text-sm">õ<!--$--></p>' +
    `<script data-hk="002">$_TSR.router=($R=>({dehydratedData:${query},other:"õ"}))([])</script>` +
    '<script>window._$HY={}</script>'
  const parts = htmlParts(html)
  expect(parts.query).toBe(Buffer.byteLength(query))
  expect(parts.markers).toBe(Buffer.byteLength(' data-hk="001"<!--$-->'))
  expect(parts.markup + parts.query + parts.markers + parts.scripts).toBe(Buffer.byteLength(html))
  expect(parts.classes).toBe(Buffer.byteLength(' class="text-sm"'))
})

test('counts SVG as a subset of markup and leaves unrelated query-like text alone', () => {
  const html =
    '<svg class="size-4"><path d="M0 0" /></svg><script>const text="dehydratedData"</script>'
  const parts = htmlParts(html)
  expect(parts.query).toBe(0)
  expect(parts.svg).toBe(parts.markup)
  expect(parts.markup + parts.scripts).toBe(Buffer.byteLength(html))
})
