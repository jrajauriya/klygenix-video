import { Link } from "react-router-dom"
import { Loader2, Lock, RotateCcw } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import { loginPath } from "../../lib/api"
import { rupees } from "../../lib/format"
import type { LockTier, VideoDetail, VideoLock } from "../../lib/types"
import { previewLabel } from "./lockBits"
import { Btn } from "../../components/bits"
import { TierBadge, usePay } from "../../components/Support"

export function useUnlock(video: VideoDetail | undefined, onUnlocked: () => unknown) {
  const pay = usePay()
  const channel = video?.channel?.name ?? "this channel"

  function join(t: LockTier) {
    pay.start({
      body: { purpose: "membership", tier_id: t.id },
      label: `${t.name} membership · ${channel}`,
      done: `Welcome to ${t.name}! Enjoy the full video.`,
      onPaid: onUnlocked,
    }, `tier-${t.id}`)
  }

  function buy() {
    if (!video) return
    pay.start({
      body: { purpose: "video", video_id: video.id },
      label: video.title,
      done: "It's yours. Enjoy the full video.",
      onPaid: onUnlocked,
    }, "video")
  }

  function buySeries(s: { id: number; title: string }) {
    pay.start({
      body: { purpose: "series", playlist_id: s.id },
      label: `Series: ${s.title}`,
      done: `The whole series "${s.title}" is yours.`,
      onPaid: onUnlocked,
    }, `series-${s.id}`)
  }

  return { join, buy, buySeries, busy: pay.busy, sheet: pay.sheet }
}

type Unlock = ReturnType<typeof useUnlock>

function Spin({ on }: { on: boolean }) {
  return on ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null
}

export function PaywallOverlay({ video, lock, unlock, onReplay, className }: { video: VideoDetail; lock: VideoLock; unlock: Unlock; onReplay?: () => void; className?: string }) {
  const cheapest = lock.tiers?.[0]
  return (
    <div className={cn("absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/85 p-4 text-center sm:gap-3", className)}>
      <Lock size={22} className="text-brand-soft" aria-hidden="true" />
      <p className="text-sm font-bold text-white sm:text-lg">{lock.preview_seconds ? "The preview has ended" : lock.access === "members" ? "Members-only video" : "Paid video"}</p>
      <p className="hidden max-w-sm text-sm text-white/80 sm:block">
        {lock.access === "members" ? `Join ${video.channel?.name ?? "the channel"} to watch the whole video.` : "Buy it once to watch the whole video, anytime."}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {!lock.signed_in ? (
          <Link to={loginPath()} className="inline-flex h-9 items-center rounded-full bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover">
            {lock.access === "members" ? "Sign in to join" : "Sign in to buy"}
          </Link>
        ) : lock.access === "members" ? (
          cheapest && (
            <Btn tone="brand" onClick={() => unlock.join(cheapest)} disabled={unlock.busy !== null}>
              <Spin on={unlock.busy === `tier-${cheapest.id}`} /> Join {cheapest.name} · {rupees(cheapest.price_minor)}/mo
            </Btn>
          )
        ) : lock.price_minor ? (
          <Btn tone="brand" onClick={unlock.buy} disabled={unlock.busy !== null}>
            <Spin on={unlock.busy === "video"} /> Buy for {rupees(lock.price_minor, lock.currency)}
          </Btn>
        ) : null}
        {onReplay && lock.preview_seconds > 0 && (
          <Btn tone="soft" onClick={onReplay}><RotateCcw size={15} aria-hidden="true" /> Replay preview</Btn>
        )}
      </div>
    </div>
  )
}

export function PaywallPanel({ video, lock, unlock, fee = "a platform fee" }: { video: VideoDetail; lock: VideoLock; unlock: Unlock; fee?: string }) {
  const members = lock.access === "members"
  const channel = video.channel?.name ?? "this channel"
  return (
    <section aria-label={members ? "Members-only video" : "Paid video"} className="rounded-2xl border border-brand/50 bg-gradient-to-b from-brand/15 to-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Lock size={17} className="text-brand-soft" aria-hidden="true" />
        <h2 className="text-base font-bold">{members ? "Members-only video" : "Paid video"}</h2>
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-xs font-semibold text-ink">{previewLabel(lock)}</span>
      </div>
      <p className="mt-2 text-sm text-muted">
        {members
          ? `You are watching a preview. Join ${channel}${(lock.members_rank ?? 1) > 1 ? " at one of these tiers" : ""} to watch the whole video, its transcript and Ask.`
          : `You are watching a preview. Buy it once to watch the whole video, read its transcript and ask it questions.`}
      </p>

      {members ? (
        <ul className="mt-4 space-y-2">
          {(lock.tiers ?? []).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-panel-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{t.name} <TierBadge>{t.badge || "Member"}</TierBadge></p>
                <p className="text-xs text-muted">{rupees(t.price_minor)} / month</p>
              </div>
              {lock.signed_in ? (
                <Btn tone="brand" size="sm" onClick={() => unlock.join(t)} disabled={unlock.busy !== null}>
                  <Spin on={unlock.busy === `tier-${t.id}`} /> Join
                </Btn>
              ) : (
                <Link to={loginPath()} className="inline-flex h-8 items-center rounded-full bg-snow px-3 text-xs font-semibold text-black hover:bg-snow/85">Sign in to join</Link>
              )}
            </li>
          ))}
          {(lock.tiers ?? []).length === 0 && <li className="text-sm text-muted">{channel} has no open memberships right now.</li>}
        </ul>
      ) : (
        <div className="mt-4 space-y-2">
          {lock.price_minor ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-panel-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">This video</p>
                <p className="text-xs text-muted">{rupees(lock.price_minor, lock.currency)} · yours to keep</p>
              </div>
              {lock.signed_in ? (
                <Btn tone="brand" size="sm" onClick={unlock.buy} disabled={unlock.busy !== null}>
                  <Spin on={unlock.busy === "video"} /> Buy {rupees(lock.price_minor, lock.currency)}
                </Btn>
              ) : (
                <Link to={loginPath()} className="inline-flex h-8 items-center rounded-full bg-snow px-3 text-xs font-semibold text-black hover:bg-snow/85">Sign in to buy</Link>
              )}
            </div>
          ) : null}
          {(lock.series ?? []).length > 0 && <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Or get the whole series</p>}
          {(lock.series ?? []).map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-panel-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <Link to={`/playlist/${s.id}`} className="block truncate text-sm font-semibold hover:underline">{s.title}</Link>
                <p className="text-xs text-muted">{rupees(s.price_minor)} · every video in the series</p>
              </div>
              {lock.signed_in ? (
                <Btn tone="soft" size="sm" onClick={() => unlock.buySeries(s)} disabled={unlock.busy !== null}>
                  <Spin on={unlock.busy === `series-${s.id}`} /> Buy series {rupees(s.price_minor)}
                </Btn>
              ) : (
                <Link to={loginPath()} className="inline-flex h-8 items-center rounded-full bg-snow px-3 text-xs font-semibold text-black hover:bg-snow/85">Sign in to buy</Link>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-faint">Payments in India only, in rupees. The creator gets your payment minus {fee} and taxes.</p>
    </section>
  )
}

export function LockedOverlay({ video, lock, onUnlocked, onReplay, className }: { video: VideoDetail; lock: VideoLock; onUnlocked: () => unknown; onReplay?: () => void; className?: string }) {
  const unlock = useUnlock(video, onUnlocked)
  return (
    <>
      <PaywallOverlay video={video} lock={lock} unlock={unlock} onReplay={onReplay} className={className} />
      {unlock.sheet}
    </>
  )
}

export function LockedPanel({ video, lock, onUnlocked, fee }: { video: VideoDetail; lock: VideoLock; onUnlocked: () => unknown; fee?: string }) {
  const unlock = useUnlock(video, onUnlocked)
  return (
    <>
      <PaywallPanel video={video} lock={lock} unlock={unlock} fee={fee} />
      {unlock.sheet}
    </>
  )
}
