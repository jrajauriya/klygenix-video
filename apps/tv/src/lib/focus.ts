import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"

type Dir = "up" | "down" | "left" | "right"

const SELECTOR = "button:not([disabled]), a[href], [data-focusable]"
const ARROWS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }
const BACK_KEYS = new Set(["Escape", "Backspace", "GoBack", "BrowserBack", "XF86Back"])
const BACK_CODES = new Set([461, 10009])
export const BACK_EVENT = "tv:back"

const memory = new WeakMap<Element, HTMLElement>()
const saved = new Map<string, string>()

function shown(el: HTMLElement): boolean {
  if (el.closest("[inert], [aria-hidden='true']")) return false
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return false
  return getComputedStyle(el).visibility !== "hidden"
}

function layer(): ParentNode {
  const scopes = document.querySelectorAll<HTMLElement>("[data-focus-scope]")
  return scopes.length ? scopes[scopes.length - 1] : document
}

export function focusables(root: ParentNode = layer()): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(SELECTOR)].filter(shown)
}

export function focusEl(el: HTMLElement | null | undefined): boolean {
  if (!el) return false
  el.focus({ preventScroll: true })
  el.scrollIntoView({ block: "nearest", inline: "nearest" })
  return document.activeElement === el
}

function gap(a1: number, a2: number, b1: number, b2: number): number {
  if (b2 < a1) return a1 - b2
  if (b1 > a2) return b1 - a2
  return 0
}

function pick(current: HTMLElement, list: HTMLElement[], dir: Dir): HTMLElement | null {
  const from = current.getBoundingClientRect()
  const tol = 2
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const el of list) {
    if (el === current || el.contains(current) || current.contains(el)) continue
    const r = el.getBoundingClientRect()
    let main: number
    let cross: number
    let centre: number
    if (dir === "right") {
      if (r.left < from.right - tol) continue
      main = r.left - from.right
      cross = gap(from.top, from.bottom, r.top, r.bottom)
      centre = Math.abs((r.top + r.bottom) / 2 - (from.top + from.bottom) / 2)
    } else if (dir === "left") {
      if (r.right > from.left + tol) continue
      main = from.left - r.right
      cross = gap(from.top, from.bottom, r.top, r.bottom)
      centre = Math.abs((r.top + r.bottom) / 2 - (from.top + from.bottom) / 2)
    } else if (dir === "down") {
      if (r.top < from.bottom - tol) continue
      main = r.top - from.bottom
      cross = gap(from.left, from.right, r.left, r.right)
      centre = Math.abs((r.left + r.right) / 2 - (from.left + from.right) / 2)
    } else {
      if (r.bottom > from.top + tol) continue
      main = from.top - r.bottom
      cross = gap(from.left, from.right, r.left, r.right)
      centre = Math.abs((r.left + r.right) / 2 - (from.left + from.right) / 2)
    }
    const score = Math.max(0, main) + cross * 3 + centre * 0.05
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  if (!best) return null
  const group = best.closest("[data-focus-group]")
  if (group && group !== current.closest("[data-focus-group]") && (dir === "up" || dir === "down")) {
    const back = memory.get(group)
    if (back && back.isConnected && list.includes(back)) return back
  }
  return best
}

export function focusFirst(root: ParentNode = layer()): boolean {
  const list = focusables(root)
  const auto = list.find((el) => el.hasAttribute("data-autofocus"))
  return focusEl(auto ?? list[0])
}

function lost(): boolean {
  const a = document.activeElement as HTMLElement | null
  return !a || a === document.body || !focusables().includes(a)
}

export function useSpatialNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const touched = useRef(false)
  const key = location.key

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement
      const group = el.closest?.("[data-focus-group]")
      if (group) memory.set(group, el)
      const id = el.getAttribute?.("data-focus-id")
      if (id) saved.set(key, id)
    }
    document.addEventListener("focusin", onFocus)
    return () => document.removeEventListener("focusin", onFocus)
  }, [key])

  useEffect(() => {
    touched.current = false
    const started = Date.now()
    const want = saved.get(key)
    let timer = 0
    const tick = () => {
      if (touched.current) return
      const age = Date.now() - started
      if (want) {
        const el = document.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(want)}"]`)
        if (el && focusEl(el)) return
      }
      const auto = document.querySelector<HTMLElement>("[data-autofocus]")
      if (auto && (!want || age > 1500) && focusEl(auto)) return
      if (age > 3000) {
        if (lost()) focusFirst()
        return
      }
      timer = window.setTimeout(tick, 80)
    }
    timer = window.setTimeout(tick, 0)
    return () => window.clearTimeout(timer)
  }, [key])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      const dir = ARROWS[e.key]
      if (dir) {
        touched.current = true
        e.preventDefault()
        if (lost()) {
          focusFirst()
          return
        }
        const next = pick(document.activeElement as HTMLElement, focusables(), dir)
        if (next) focusEl(next)
        return
      }
      if (e.key === "Enter") {
        const el = document.activeElement as HTMLElement | null
        if (el?.hasAttribute("data-focusable") && el.tagName !== "BUTTON" && el.tagName !== "A") {
          e.preventDefault()
          el.click()
        }
        return
      }
      if (BACK_KEYS.has(e.key) || BACK_CODES.has(e.keyCode)) {
        e.preventDefault()
        touched.current = true
        const ev = new CustomEvent(BACK_EVENT, { cancelable: true })
        window.dispatchEvent(ev)
        if (ev.defaultPrevented) return
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
        if (idx > 0) navigate(-1)
        else if (window.location.pathname !== "/") navigate("/", { replace: true })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navigate])
}

export function useBack(handler: (() => boolean) | null) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const on = (e: Event) => {
      if (ref.current?.()) e.preventDefault()
    }
    window.addEventListener(BACK_EVENT, on)
    return () => window.removeEventListener(BACK_EVENT, on)
  }, [])
}
