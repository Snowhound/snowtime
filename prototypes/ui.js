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

  const alert = {
    base: 'relative w-full rounded-lg border p-4 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7',
    variant: {
      default: 'bg-background text-foreground',
      destructive: 'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive',
    },
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
    // DialogContent on a native modal <dialog>; `m-0` resets the UA margin and `backdrop:` carries
    // DialogOverlay's `bg-background/80`. Kobalte's enter/exit animations are left out.
    dialog:
      'fixed left-1/2 top-1/2 z-50 grid max-h-screen w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto border bg-background p-6 shadow-lg duration-200 sm:rounded-lg m-0 text-foreground backdrop:bg-background/80',
    'dialog-header': 'flex flex-col space-y-1.5 text-center sm:text-left',
    'dialog-footer': 'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
    'dialog-title': 'text-lg font-semibold leading-none tracking-tight',
    'dialog-description': 'text-sm text-muted-foreground',
    'dialog-close':
      'absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[expanded]:bg-accent data-[expanded]:text-muted-foreground',
    // PopoverContent on a native [popover]; ui.js positions it below its trigger, aligned to the end.
    popover:
      'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none m-0',
    // Switch control on a <button role="switch">; the focus ring moves from the hidden input to the button.
    switch:
      'inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-[color,background-color,box-shadow] data-[disabled]:cursor-not-allowed data-[checked]:bg-primary data-[disabled]:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'switch-thumb':
      'pointer-events-none block size-5 translate-x-0 rounded-full bg-background shadow-lg ring-0 transition-transform data-[checked]:translate-x-5',
    'error-message': 'text-xs text-destructive',
    'alert-title': 'mb-1 font-medium leading-none tracking-tight',
    'alert-description': 'text-sm [&_p]:leading-relaxed',
    // Horizontal Separator.
    separator: 'shrink-0 bg-border h-px w-full',
    avatar: 'relative flex size-10 shrink-0 overflow-hidden rounded-full',
    'avatar-fallback': 'flex size-full items-center justify-center bg-muted',
  }

  const variants = { button, badge, toggle, alert }

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

  // Mirrors Kobalte's `data-checked` on the switch and its thumb; fires `change` on user toggles.
  function setSwitch(el, checked) {
    el.setAttribute('aria-checked', String(checked))
    for (const n of [el, ...el.querySelectorAll('[data-ui="switch-thumb"]')]) n.toggleAttribute('data-checked', checked)
  }
  document.addEventListener('click', (event) => {
    const sw = event.target.closest('[data-ui="switch"]')
    if (!sw || sw.disabled) return
    setSwitch(sw, sw.getAttribute('aria-checked') !== 'true')
    sw.dispatchEvent(new Event('change', { bubbles: true }))
  })

  // Place an opening popover under its trigger, end-aligned and kept inside the viewport.
  document.addEventListener(
    'beforetoggle',
    (event) => {
      const pop = event.target
      if (event.newState !== 'open' || pop.dataset?.ui !== 'popover') return
      const trigger = document.querySelector(`[popovertarget="${pop.id}"]`)
      if (!trigger) return
      // A closed popover still reports its specified width (e.g. `w-72`) through computed style.
      const r = trigger.getBoundingClientRect()
      const w = Math.min(parseFloat(getComputedStyle(pop).width) || 288, innerWidth - 16)
      pop.style.inset = 'auto'
      pop.style.top = `${r.bottom + 4}px`
      pop.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`
      pop.style.maxWidth = 'calc(100vw - 16px)'
    },
    true
  )

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
    document.querySelectorAll('[data-ui="switch"]').forEach((el) => setSwitch(el, el.getAttribute('aria-checked') === 'true'))
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

  window.ui = { apply: applyAll, ready, setSwitch }
})()
