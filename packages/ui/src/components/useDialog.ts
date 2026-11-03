import { useEffect, useRef } from "react"

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
const stack: symbol[] = []

export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void, dismissible = true) {
  const ref = useRef<T>(null)
  const close = useRef(onClose)
  close.current = onClose
  const canClose = useRef(dismissible)
  canClose.current = dismissible

  useEffect(() => {
    if (!open) return
    const me = Symbol("dialog")
    stack.push(me)
    const opener = document.activeElement as HTMLElement | null
    const box = ref.current
    if (box && !box.contains(document.activeElement)) box.focus({ preventScroll: true })
    const items = () => Array.from(box?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.getClientRects().length > 0)
    const onKey = (e: KeyboardEvent) => {
      if (!box || stack[stack.length - 1] !== me) return
      if (e.key === "Escape") {
        if (canClose.current && !e.defaultPrevented && !document.querySelector("[data-popover]")) close.current()
        return
      }
      if (e.key !== "Tab") return
      const active = document.activeElement as HTMLElement | null
      if (active && active !== document.body && active !== box && !box.contains(active)) return
      const list = items()
      if (!list.length) { e.preventDefault(); return }
      const at = active ? list.indexOf(active) : -1
      if (e.shiftKey && at <= 0) { e.preventDefault(); list[list.length - 1].focus() }
      else if (!e.shiftKey && (at === -1 || at === list.length - 1)) { e.preventDefault(); list[0].focus() }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      stack.splice(stack.indexOf(me), 1)
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [open])

  return ref
}
