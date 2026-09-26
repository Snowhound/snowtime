// The notice a browser too old for the app sees at the top of every page. The server renders
// it hidden, in the page's language; the check in <head> (src/lib/browser-check.ts) shows it
// and wires its button. Its styles are inline: the browsers that see it may drop the
// stylesheet's cascade layers, and with them every Tailwind class. It stacks above the frames,
// whose fixed scene would cover it, and above the intro (z-index 60).
import { BROWSER_NOTICE_ID } from '~/lib/browser-check'
import { m } from '~/paraglide/messages.js'

export function BrowserNotice() {
  return (
    // The layout sits on an inner element, since an inline display would override hidden.
    <div id={BROWSER_NOTICE_ID} role="alert" hidden>
      <div
        style={{
          position: 'relative',
          'z-index': '70',
          display: 'flex',
          'align-items': 'flex-start',
          gap: '12px',
          padding: '12px 16px',
          background: '#fef3c7',
          color: '#78350f',
          'border-bottom': '1px solid #f59e0b',
          'font-family': 'system-ui, sans-serif',
          'font-size': '14px',
          'line-height': '1.4',
        }}
      >
        <p style={{ margin: '0', flex: '1' }}>
          <strong>{m.browser_notice_title()}</strong> {m.browser_notice_body()}
        </p>
        <button
          type="button"
          style={{
            padding: '2px 10px',
            border: '1px solid #b45309',
            'border-radius': '4px',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          {m.browser_notice_dismiss()}
        </button>
      </div>
    </div>
  )
}
