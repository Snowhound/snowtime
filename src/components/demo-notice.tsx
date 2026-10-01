import { Show, createSignal, onMount } from 'solid-js'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { demoModeQuery } from '~/lib/queries/demo-mode'
import { useQuery } from '~/lib/queries/use-query'
import { m } from '~/paraglide/messages.js'

export function DemoNotice() {
  const demo = useQuery(() => demoModeQuery)
  const [open, setOpen] = createSignal(false)
  onMount(() => {
    if (!demo.data) return
    try {
      setOpen(sessionStorage.getItem('snowtime.demoNoticeSeen') !== 'true')
    } catch {
      setOpen(true)
    }
  })
  function changeOpen(value: boolean) {
    setOpen(value)
    if (value) return
    try {
      sessionStorage.setItem('snowtime.demoNoticeSeen', 'true')
    } catch {
      // Storage can be unavailable in a private browser session.
    }
  }
  return (
    <Show when={demo.data}>
      <Button
        variant="outline"
        size="sm"
        class="fixed bottom-3 left-3 z-50 border-amber-300 bg-amber-100 text-amber-950 shadow-sm hover:bg-amber-200 hover:text-amber-950"
        onClick={() => setOpen(true)}
      >
        {m.demo_title()}
      </Button>
      <Dialog open={open()} onOpenChange={changeOpen}>
        <DialogContent>
          <DialogTitle>{m.demo_title()}</DialogTitle>
          <DialogDescription>{m.demo_notice()}</DialogDescription>
          <Button onClick={() => changeOpen(false)}>{m.demo_continue()}</Button>
        </DialogContent>
      </Dialog>
    </Show>
  )
}
