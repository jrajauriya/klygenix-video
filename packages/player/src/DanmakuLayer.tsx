import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { DanmakuItem } from "./types"
import { cx, hashUnit, isBlocked } from "./format"

export interface DanmakuLayerProps {
  items: DanmakuItem[]
  currentMs: number
  playing: boolean
  enabled?: boolean
  density?: number
  opacity?: number
  blocked?: string[]
  scrollMs?: number
  fixedMs?: number
  className?: string
}

interface Flying {
  key: string
  item: DanmakuItem
  mode: "scroll" | "top" | "bottom"
  lane: number
  width: number
  left: number
}

interface LaneState {
  key: string
  width: number
}

const GAP = 24

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)")
    if (!mq) return
    const on = () => setReduced(mq.matches)
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return reduced
}

let measureCtx: CanvasRenderingContext2D | null = null

function measure(text: string, fontSize: number): number {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d")
  if (!measureCtx) return text.length * fontSize * 0.6
  measureCtx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`
  return Math.ceil(measureCtx.measureText(text).width) + 8
}

export function DanmakuLayer({
  items, currentMs, playing, enabled = true, density = 1, opacity = 1, blocked, scrollMs = 8000, fixedMs = 4000, className,
}: DanmakuLayerProps) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [flying, setFlying] = useState<Flying[]>([])
  const anims = useRef(new Map<string, Animation>())
  const scrollLanes = useRef<(LaneState | null)[]>([])
  const topLanes = useRef<(string | null)[]>([])
  const bottomLanes = useRef<(string | null)[]>([])
  const lastMs = useRef<number | null>(null)
  const launched = useRef(new Set<string>())
  const reduced = useReducedMotion()
  const playingRef = useRef(playing)
  playingRef.current = playing

  const fontSize = size.w < 520 ? 15 : size.w < 900 ? 18 : 22
  const laneHeight = Math.round(fontSize * 1.45)
  const laneCount = Math.max(1, Math.floor((size.h * 0.82) / laneHeight))
  const fixedCount = Math.max(1, Math.floor((size.h * 0.4) / laneHeight))

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function clear() {
    anims.current.forEach((a) => a.cancel())
    anims.current.clear()
    scrollLanes.current = []
    topLanes.current = []
    bottomLanes.current = []
    launched.current.clear()
    setFlying([])
  }

  useEffect(() => {
    if (!enabled) clear()
  }, [enabled])

  useEffect(() => {
    anims.current.forEach((a) => {
      if (playing) a.play()
      else a.pause()
    })
  }, [playing])

  function freeScrollLane(width: number): number {
    const W = size.w
    const speedNew = (W + width) / scrollMs
    for (let i = 0; i < laneCount; i++) {
      const prev = scrollLanes.current[i]
      if (!prev) return i
      const anim = anims.current.get(prev.key)
      if (!anim) return i
      const elapsed = Number(anim.currentTime ?? scrollMs)
      const speedPrev = (W + prev.width) / scrollMs
      const travelled = speedPrev * elapsed
      if (travelled < prev.width + GAP) continue
      const remaining = scrollMs - elapsed
      if (speedNew > speedPrev && speedNew * remaining > W) continue
      return i
    }
    return -1
  }

  function freeFixedLane(lanes: (string | null)[], count: number): number {
    for (let i = 0; i < count; i++) {
      const key = lanes[i]
      if (!key || !anims.current.has(key)) return i
    }
    return -1
  }

  useEffect(() => {
    if (!enabled || size.w === 0) {
      lastMs.current = currentMs
      return
    }
    const prev = lastMs.current
    lastMs.current = currentMs
    if (prev === null) return
    if (currentMs < prev - 250 || currentMs - prev > 2500) {
      clear()
      return
    }
    const from = Math.min(prev, currentMs) - 1500
    const due = items.filter((d) => d.t_ms > from && d.t_ms <= currentMs)
    if (!due.length) return
    const next: Flying[] = []
    for (const item of due) {
      const key = `${item.id}`
      if (launched.current.has(key)) continue
      if (!item.mine && density < 1 && hashUnit(item.id) >= density) continue
      if (isBlocked(item.text, blocked)) continue
      const mode = item.mode === "top" || item.mode === "bottom" ? item.mode : "scroll"
      const width = measure(item.text, fontSize)
      let lane = -1
      let left = 0
      if (mode === "scroll") {
        lane = freeScrollLane(width)
        if (lane >= 0) scrollLanes.current[lane] = { key, width }
        left = Math.round(hashUnit(`${item.id}x`) * Math.max(0, size.w - width))
      } else {
        const lanes = mode === "top" ? topLanes.current : bottomLanes.current
        lane = freeFixedLane(lanes, fixedCount)
        if (lane >= 0) lanes[lane] = key
      }
      if (lane < 0) continue
      launched.current.add(key)
      next.push({ key, item, mode, lane, width, left })
    }
    if (next.length) setFlying((list) => [...list, ...next])
  }, [currentMs, enabled, items, size.w])

  const register = useCallback((key: string, anim: Animation) => {
    anims.current.set(key, anim)
    if (!playingRef.current) anim.pause()
    anim.onfinish = () => {
      anims.current.delete(key)
      setFlying((list) => list.filter((f) => f.key !== key))
    }
  }, [])

  return (
    <div
      ref={box}
      aria-hidden="true"
      className={cx("pointer-events-none absolute inset-0 overflow-hidden", className)}
      style={{ opacity: Math.max(0.1, Math.min(1, opacity)) }}
    >
      {enabled && flying.map((f) => (
        <Bullet
          key={f.key}
          flying={f}
          width={size.w}
          height={size.h}
          laneHeight={laneHeight}
          fontSize={fontSize}
          reduced={reduced}
          scrollMs={scrollMs}
          fixedMs={fixedMs}
          register={register}
        />
      ))}
    </div>
  )
}

const Bullet = memo(function Bullet({
  flying, width, height, laneHeight, fontSize, reduced, scrollMs, fixedMs, register,
}: {
  flying: Flying
  width: number
  height: number
  laneHeight: number
  fontSize: number
  reduced: boolean
  scrollMs: number
  fixedMs: number
  register: (key: string, anim: Animation) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { item, mode, lane, key } = flying

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let anim: Animation
    if (mode === "scroll" && !reduced) {
      anim = el.animate(
        [{ transform: `translateX(${width}px)` }, { transform: `translateX(${-flying.width - 4}px)` }],
        { duration: scrollMs, easing: "linear", fill: "forwards" },
      )
    } else {
      anim = el.animate(
        [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }],
        { duration: mode === "scroll" ? scrollMs / 2 : fixedMs, easing: "linear", fill: "forwards" },
      )
    }
    register(key, anim)
    return () => anim.cancel()
  }, [])

  const style: React.CSSProperties = {
    color: item.color || "#FFFFFF",
    fontSize,
    lineHeight: `${laneHeight}px`,
    height: laneHeight,
    textShadow: "0 0 2px #000, 0 0 2px #000, 1px 1px 2px rgba(0,0,0,.9)",
  }
  if (mode === "scroll") {
    style.top = lane * laneHeight
    if (reduced) style.left = flying.left
    else style.left = 0
  } else if (mode === "top") {
    style.top = lane * laneHeight
    style.left = "50%"
    style.translate = "-50% 0"
  } else {
    style.top = height - (lane + 1) * laneHeight - Math.round(height * 0.12)
    style.left = "50%"
    style.translate = "-50% 0"
  }

  return (
    <div
      ref={ref}
      style={style}
      className={cx(
        "absolute whitespace-nowrap px-1 font-semibold will-change-transform",
        item.mine && "rounded border border-[#E879F9]/90",
      )}
    >
      {item.text}
    </div>
  )
})
