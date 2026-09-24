// Solid-UI class strings for static prototypes.
// Copied verbatim from stefan-karger/solid-ui @ 21ba4fa (apps/docs/src/registry/ui/*.tsx).
// Usage mirrors the Solid components: <button data-ui="button" data-variant="outline" data-size="sm">
// is <Button variant="outline" size="sm">. The element's own class is appended, like `class` on the
// component, and classes are merged with tailwind-merge like the app's `cn()`.
;(() => {
  const button = {
    base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90',
      destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      outline: 'border border-input hover:bg-accent hover:text-accent-foreground',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      ghost: 'hover:bg-accent hover:text-accent-foreground',
      link: 'text-primary underline-offset-4 hover:underline',
    },
    size: { default: 'h-10 px-4 py-2', sm: 'h-9 px-3 text-xs', lg: 'h-11 px-8', icon: 'size-10' },
  }

  const badge = {
    base: 'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'text-foreground',
    },
  }

  // Toggle / ToggleGroupItem. Kobalte marks the pressed state with `data-pressed`.
  const toggle = {
    base: 'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-muted hover:text-muted-foreground data-[pressed]:bg-accent data-[pressed]:text-accent-foreground',
    variant: { default: 'bg-transparent', outline: 'border border-input bg-transparent shadow-sm' },
    size: { default: 'h-9 px-3', sm: 'h-8 px-2', lg: 'h-10 px-3' },
  }

  const fixed = {
    'toggle-group': 'flex items-center justify-center gap-1',
    label: 'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
    // TextFieldInput
    input:
      'flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[invalid]:border-error-foreground data-[invalid]:text-error-foreground',
    // SelectTrigger classes on a native <select>; the popup is the browser's, not Kobalte's.
    select:
      'flex h-10 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-8',
    card: 'rounded-lg border bg-card text-card-foreground shadow-sm',
    'card-header': 'flex flex-col space-y-1.5 p-6',
    'card-title': 'text-lg font-semibold leading-none tracking-tight',
    'card-description': 'text-sm text-muted-foreground',
    'card-content': 'p-6 pt-0',
    'card-footer': 'flex items-center p-6 pt-0',
    // Table renders its own `relative w-full overflow-auto` wrapper; add that div yourself.
    table: 'w-full caption-bottom text-sm',
    'table-header': '[&_tr]:border-b',
    'table-body': '[&_tr:last-child]:border-0',
    'table-row': 'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
    'table-head': 'h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
    'table-cell': 'p-2 align-middle [&:has([role=checkbox])]:pr-0',
    'table-caption': 'mt-4 text-sm text-muted-foreground',
  }

  const variants = { button, badge, toggle }

  function classesFor(el) {
    const name = el.dataset.ui
    const v = variants[name]
    if (v) return [v.base, v.variant?.[el.dataset.variant || 'default'], v.size?.[el.dataset.size || 'default']]
    return [fixed[name]]
  }

  // Select chevrons, matching SelectTrigger's icon.
  const chevrons =
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-50"><path d="M8 9l4 -4l4 4" /><path d="M16 15l-4 4l-4 -4" /></svg>'

  function apply(el) {
    const key = [el.dataset.ui, el.dataset.variant, el.dataset.size].join('|')
    if (el.dataset.uiApplied === key) return
    const own = el.dataset.uiApplied === undefined ? el.getAttribute('class') || '' : el.dataset.uiClass
    el.dataset.uiClass = own
    el.dataset.uiApplied = key
    el.setAttribute('class', twMerge(...classesFor(el).filter(Boolean), own))
    if (el.dataset.ui === 'select' && !el.parentElement.hasAttribute('data-ui-select-wrap')) {
      const wrap = document.createElement('div')
      wrap.setAttribute('data-ui-select-wrap', '')
      wrap.className = 'relative min-w-0'
      el.replaceWith(wrap)
      wrap.append(el)
      wrap.insertAdjacentHTML('beforeend', chevrons)
    }
  }

  function applyAll(root = document) {
    if (root.matches?.('[data-ui]')) apply(root)
    root.querySelectorAll?.('[data-ui]').forEach(apply)
  }

  let twMerge
  // Resolves once classes are applied; start page scripts from `ui.ready`.
  const ready = Promise.all([
    import('https://cdn.jsdelivr.net/npm/tailwind-merge@3.7.0/+esm').then((m) => (twMerge = m.twMerge)),
    new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve)),
  ]).then(() => {
    applyAll()
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') apply(r.target)
        else r.addedNodes.forEach((n) => n.nodeType === 1 && applyAll(n))
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-ui', 'data-variant', 'data-size'],
    })
  })

  window.ui = { apply: applyAll, ready }
})()
