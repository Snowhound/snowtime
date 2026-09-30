// Diagnostic byte counts are exclusive; gzip of individual parts doesn't add up to the document.
import { parse } from 'acorn'

export function htmlParts(html: string) {
  let scripts = 0
  let query = 0
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (script) => {
    scripts += Buffer.byteLength(script)
    if (script.includes('$_TSR.router=')) {
      const source = script.slice(script.indexOf('>') + 1, script.lastIndexOf('</script>'))
      const ast = parse(source, { ecmaVersion: 'latest' })
      function visit(value: unknown) {
        if (!value || typeof value !== 'object') return
        const node = value as Record<string, unknown>
        const key = node.key as { name?: string } | undefined
        if (node.type === 'Property' && key?.name === 'dehydratedData') {
          const data = node.value as { start: number; end: number }
          query += Buffer.byteLength(source.slice(data.start, data.end))
          return
        }
        for (const child of Object.values(node)) {
          if (Array.isArray(child)) child.forEach(visit)
          else visit(child)
        }
      }
      visit(ast)
    }
    return ''
  })
  let markers = 0
  const plain = markup.replace(/ data-hk="[^"]*"|<!--[^]*?-->/g, (marker) => {
    markers += Buffer.byteLength(marker)
    return ''
  })
  return {
    markup: Buffer.byteLength(plain),
    query,
    markers,
    scripts: scripts - query,
    svg: [...plain.matchAll(/<svg\b[^]*?<\/svg>/g)].reduce(
      (sum, match) => sum + Buffer.byteLength(match[0]),
      0,
    ),
    classes: [...plain.matchAll(/ class="[^"]*"/g)].reduce(
      (sum, match) => sum + Buffer.byteLength(match[0]),
      0,
    ),
  }
}

// Runs in Chrome after hydration, including offscreen mounted elements.
export function surfaceCounts() {
  const elements = [...document.querySelectorAll<HTMLElement>('*')].filter(
    (element) =>
      element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible',
  )
  const glass = elements.filter((element) => getComputedStyle(element).backdropFilter !== 'none')
  return {
    glass: glass.length,
    glassClasses: glass.map((element) => element.getAttribute('class')),
    nestedGlass: glass.filter((element) =>
      glass.some((parent) => parent !== element && parent.contains(element)),
    ).length,
    shadowValues: [
      ...new Set(elements.map((element) => getComputedStyle(element).boxShadow)),
    ].filter((shadow) => shadow !== 'none'),
    shadow: elements.filter((element) => getComputedStyle(element).boxShadow !== 'none').length,
    rowShadow: elements.filter(
      (element) =>
        element.matches('li, tr, td, th') && getComputedStyle(element).boxShadow !== 'none',
    ).length,
    willChange: elements.filter((element) => getComputedStyle(element).willChange !== 'auto')
      .length,
  }
}
