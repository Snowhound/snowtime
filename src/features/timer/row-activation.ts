// An entry row mounts its editor's popovers and menus only once it is used: until the pointer
// is over it, or focus or a tap is in it, their triggers are plain buttons that look the same.
// Most rows are only read, and mounting every row's editor made opening the timer slow.
//
// Both renderings have the same inputs and buttons in the same order, so a control that is
// swapped finds its counterpart: focus moves to it, and a tap on it is replayed there. Inputs
// aren't swapped, so a field being typed in keeps its focus and caret.
import { createSignal } from 'solid-js'

export function createRowActivation() {
  const [active, setActive] = createSignal(false)
  let row: HTMLElement | undefined
  let hovered = false
  // A touch is down. Its focus waits for the tap's click, which acts on the swapped control, so
  // the tap isn't lost to an element removed under it.
  let touching = false

  function controls() {
    return [...row!.querySelectorAll<HTMLElement>('input, button')]
  }

  // Mounts the editor and returns the control that took `target`'s place, if one did.
  function activate(target: EventTarget | null) {
    if (active()) return null
    const before = controls()
    const index = target instanceof Node ? before.findIndex((c) => c.contains(target)) : -1
    setActive(true)
    if (index < 0 || before[index].isConnected) return null
    return controls()[index] ?? null
  }

  // Unmounts the editor once the row is left, unless a popover or menu of it is open.
  function settle() {
    if (!row || hovered || row.contains(document.activeElement)) return
    if (row.querySelector('[data-expanded]')) return
    setActive(false)
  }

  function listen(el: HTMLElement) {
    row = el
    el.addEventListener('pointerover', (event) => {
      if (event.pointerType === 'touch') return
      hovered = true
      activate(null)
    })
    el.addEventListener('pointerout', (event) => {
      if (event.pointerType === 'touch') return
      if (event.relatedTarget instanceof Node && el.contains(event.relatedTarget)) return
      hovered = false
      settle()
    })
    el.addEventListener('pointerdown', (event) => {
      touching = event.pointerType === 'touch'
    })
    el.addEventListener('pointercancel', () => {
      touching = false
    })
    el.addEventListener('focusin', (event) => {
      if (!touching) activate(event.target)?.focus()
    })
    // Focus has moved on by the next task, into a popover of the row or out of it.
    el.addEventListener('focusout', () => setTimeout(settle))
    el.addEventListener('click', (event) => {
      touching = false
      const control = activate(event.target)
      if (control) replayTap(control)
    })
  }

  return { active, ref: listen }
}

// Kobalte's triggers open a menu on a touch's click, and a popover on any click.
function replayTap(control: HTMLElement) {
  control.focus()
  control.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }),
  )
  control.click()
}
