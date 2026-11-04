import { useRef, useState, type PointerEvent } from "react"
import { Loader2, Plus, RotateCcw, ScanFace, Trash2 } from "lucide-react"
import { Button, cn } from "@klygenixvideo/ui"
import { clock, seconds } from "../../lib/format"
import { MAX_KEYFRAMES, cxAt } from "../../lib/clips"
import type { Keyframe, Reframe as ReframeInfo } from "../../lib/types"
import { useT } from "../../i18n"

const H = 72

export function Reframe({
  info, keyframes, onKeyframes, startMs, endMs, playheadMs, centerX, onCenterX, disabled, wide, tracking, onTrack, onSeek,
}: {
  info: ReframeInfo | null
  keyframes: Keyframe[]
  onKeyframes: (k: Keyframe[]) => void
  startMs: number
  endMs: number
  playheadMs: number
  centerX: number
  onCenterX: (v: number) => void
  disabled?: boolean
  wide: boolean
  tracking: boolean
  onTrack: () => void
  onSeek: (ms: number) => void
}) {
  const t = useT()
  const lane = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const span = Math.max(1, endMs - startMs)
  const fx = (ms: number) => Math.min(1, Math.max(0, (ms - startMs) / span))
  const sel = selected !== null && selected < keyframes.length ? selected : null
  const off = disabled || wide || tracking

  const sorted = (list: Keyframe[]) => [...list].sort((a, b) => a.t_ms - b.t_ms)

  const at = (clientX: number, clientY: number) => {
    const r = lane.current!.getBoundingClientRect()
    const tm = Math.round((startMs + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span) / 100) * 100
    const cx = Math.round(Math.min(1, Math.max(0, (clientY - r.top) / r.height)) * 1000) / 1000
    return { t: tm, cx }
  }

  function update(i: number, patch: Partial<Keyframe>) {
    const next = keyframes.map((k, j) => (j === i ? { ...k, ...patch } : k))
    const moved = next[i]
    const ordered = sorted(next)
    setSelected(ordered.indexOf(moved))
    onKeyframes(ordered)
  }

  function add() {
    const tm = Math.min(endMs, Math.max(startMs, Math.round(playheadMs / 100) * 100))
    const cx = Math.round(cxAt(keyframes, tm, centerX) * 1000) / 1000
    const kept = keyframes.filter((k) => k.t_ms !== tm)
    const next = sorted([...kept, { t_ms: tm, cx }])
    onKeyframes(next)
    setSelected(next.findIndex((k) => k.t_ms === tm))
  }

  function remove(i: number) {
    onKeyframes(keyframes.filter((_, j) => j !== i))
    setSelected(null)
  }

  const down = (i: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (off) return
    e.stopPropagation()
    drag.current = i
    setSelected(i)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (drag.current === null) return
    const p = at(e.clientX, e.clientY)
    const i = drag.current
    const next = keyframes.map((k, j) => (j === i ? { t_ms: p.t, cx: p.cx } : k))
    onKeyframes(next)
  }
  const up = () => {
    if (drag.current === null) return
    const moved = keyframes[drag.current]
    const ordered = sorted(keyframes)
    drag.current = null
    setSelected(ordered.indexOf(moved))
    onKeyframes(ordered)
  }

  const line = keyframes.length
    ? [`0,${(cxAt(keyframes, startMs) * 100).toFixed(2)}`, ...keyframes.map((k) => `${(fx(k.t_ms) * 100).toFixed(2)},${(k.cx * 100).toFixed(2)}`), `100,${(cxAt(keyframes, endMs) * 100).toFixed(2)}`].join(" ")
    : `0,${centerX * 100} 100,${centerX * 100}`

  const status = info?.status
  const found = info?.found

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {wide
            ? t("Widescreen keeps the whole picture, so there is nothing to reframe.")
            : keyframes.length
              ? info?.mode === "track"
                ? keyframes.length === 1
                  ? t("Following faces: 1 keyframe. Drag a dot, or pick one and use its slider.")
                  : t("Following faces: {n} keyframes. Drag a dot, or pick one and use its slider.", { n: keyframes.length })
                : keyframes.length === 1
                  ? t("Moving frame: 1 keyframe. Drag a dot, or pick one and use its slider.")
                  : t("Moving frame: {n} keyframes. Drag a dot, or pick one and use its slider.", { n: keyframes.length })
              : t("The frame stays in one place. Add keyframes to move it, or let AI follow faces.")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={onTrack} disabled={off}>
            {tracking ? <Loader2 size={13} className="animate-spin" /> : <ScanFace size={13} />} {tracking ? t("Tracking…") : t("Track faces")}
          </Button>
          {keyframes.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => { onKeyframes([]); onCenterX(0.5); setSelected(null) }} disabled={off}>
              <RotateCcw size={13} /> {t("Centre")}
            </Button>
          )}
        </div>
      </div>

      {status === "ready" && found === 0 && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("No face found — centred.")}</p>
      )}
      {status === "ready" && Boolean(found) && keyframes.length > 0 && info?.mode === "track" && (
        <p className="text-xs text-slate-500">{t("Found a face in {found} of {samples} sampled frames. Adjust any keyframe the tracker got wrong.", { found: found ?? "", samples: info?.samples ?? "" })}</p>
      )}
      {status === "failed" && (
        <p role="status" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{info?.error ? t("Face tracking failed: {error}. The frame is centred.", { error: info.error }) : t("Face tracking failed. The frame is centred.")}</p>
      )}

      {!wide && (
        <>
          <div className="flex gap-2">
            <div className="flex w-10 shrink-0 flex-col justify-between py-0.5 text-right text-[11px] text-slate-500" aria-hidden="true">
              <span>{t("Left|side")}</span><span>{t("Right")}</span>
            </div>
            <div ref={lane} className={cn("relative flex-1 rounded-md bg-slate-100", off && "opacity-70")} style={{ height: H }}
              onClick={(e) => {
                if (off || e.target !== e.currentTarget) return
                const r = e.currentTarget.getBoundingClientRect()
                onSeek(startMs + ((e.clientX - r.left) / r.width) * span)
              }}>
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polyline points={line} fill="none" stroke="var(--color-brand)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-navy" style={{ left: `${fx(playheadMs) * 100}%` }} />
              {keyframes.map((k, i) => (
                <button key={`${i}-${k.t_ms}`} type="button" disabled={off}
                  aria-label={t("Keyframe at {time}, {pct}% across", { time: clock(k.t_ms), pct: Math.round(k.cx * 100) })}
                  aria-pressed={sel === i}
                  onPointerDown={down(i)} onPointerMove={move} onPointerUp={up}
                  onClick={() => { setSelected(i); onSeek(k.t_ms) }}
                  className={cn("absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow touch-none",
                    sel === i ? "bg-navy ring-2 ring-brand" : "bg-brand")}
                  style={{ left: `${fx(k.t_ms) * 100}%`, top: `${k.cx * 100}%` }} />
              ))}
            </div>
          </div>
          <div className="flex justify-between pl-12 font-num text-[11px] text-slate-500">
            <span>{clock(startMs)}</span><span>{clock(endMs)}</span>
          </div>

          {keyframes.length === 0 ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">{t("Left|side")}</span>
              <input type="range" min={0} max={1} step={0.01} value={centerX} disabled={off}
                onChange={(e) => onCenterX(Number(e.target.value))} className="flex-1 accent-[#A21CAF]" aria-label={t("Frame centre")} />
              <span className="text-xs text-slate-500">{t("Right")}</span>
            </div>
          ) : sel !== null ? (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-navy">{t("Keyframe at")} <span className="font-num">{t("{n} s", { n: seconds(keyframes[sel].t_ms) })}</span></span>
                <Button size="sm" variant="ghost" className="text-red-600" disabled={off} onClick={() => remove(sel)}>
                  <Trash2 size={13} /> {t("Remove")}
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">{t("Left|side")}</span>
                <input type="range" min={0} max={1} step={0.01} value={keyframes[sel].cx} disabled={off}
                  onChange={(e) => update(sel, { cx: Number(e.target.value) })} className="flex-1 accent-[#A21CAF]" aria-label={t("Keyframe frame centre")} />
                <span className="text-xs text-slate-500">{t("Right")}</span>
              </div>
            </div>
          ) : null}

          <Button size="sm" variant="outline" onClick={add} disabled={off || keyframes.length >= MAX_KEYFRAMES}>
            <Plus size={13} /> {t("Keyframe at {time}", { time: clock(Math.min(endMs, Math.max(startMs, playheadMs))) })}
          </Button>
        </>
      )}
    </div>
  )
}
