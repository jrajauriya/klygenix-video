import { useEffect, useRef, type ComponentProps } from "react"
import { Toaster as Sonner } from "sonner"

export function Toaster(props: ComponentProps<typeof Sonner>) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    // Sonner's toasts are Tab stops that hand focus back to where it came from on blur, which traps Tab; the live region still announces them.
    const quiet = () => root.querySelectorAll('li[data-sonner-toast][tabindex="0"]').forEach((li) => li.setAttribute("tabindex", "-1"))
    const watch = new MutationObserver(quiet)
    watch.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["tabindex"] })
    quiet()
    return () => watch.disconnect()
  }, [])
  return <Sonner ref={ref} {...props} />
}
