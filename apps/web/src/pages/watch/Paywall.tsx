import { Link } from "react-router-dom"
import { Loader2, Lock, RotateCcw } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import { loginPath } from "../../lib/api"
import { rupees } from "../../lib/format"
import type { LockTier, VideoDetail, VideoLock } from "../../lib/types"
import { previewLabel } from "./lockBits"
import { Btn } from "../../components/bits"
import { TierBadge, usePay } from "../../components/Support"
import { useT } from "../../i18n"

export function useUnlock(video: VideoDetail | undefined, onUnlocked: () => unknown) {
  const t = useT("watchx")
  const pay = usePay()
  const channel = video?.channel?.name ?? t("this channel")

  function join(tier: LockTier) {
    pay.start({
      body: { purpose: "membership", tier_id: tier.id },
      label: t("{tier} membership · {channel}", { tier: tier.name, channel }),
      done: t("Welcome to {tier}! Enjoy the full video.", { tier: tier.name }),
      onPaid: onUnlocked,
    }, `tier-${tier.id}`)
  }

  function buy() {
    if (!video) return
    pay.start({
      body: { purpose: "video", video_id: video.id },
      label: video.title,
      done: t("It's yours. Enjoy the full video."),
      onPaid: onUnlocked,
    }, "video")
  }

  function buySeries(s: { id: number; title: string }) {
    pay.start({
      body: { purpose: "series", playlist_id: s.id },
      label: t("Series: {title}", { title: s.title }),
      done: t("The whole series \"{title}\" is yours.", { title: s.title }),
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
  const t = useT("watchx")
  const cheapest = lock.tiers?.[0]
  return (
    <div className={cn("absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/85 p-4 text-center sm:gap-3", className)}>
      <Lock size={22} className="text-brand-soft" aria-hidden="true" />
      <p className="text-sm font-bold text-white sm:text-lg">{lock.preview_seconds ? t("The preview has ended") : lock.access === "members" ? t("Members-only video") : t("Paid video")}</p>
      <p className="hidden max-w-sm text-sm text-white/80 sm:block">
        {lock.access === "members" ? t("Join {channel} to watch the whole video.", { channel: video.channel?.name ?? t("the channel") }) : t("Buy it once to watch the whole video, anytime.")}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {!lock.signed_in ? (
          <Link to={loginPath()} className="inline-flex h-9 items-center rounded-full bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover">
            {lock.access === "members" ? t("Sign in to join") : t("Sign in to buy")}
          </Link>
        ) : lock.access === "members" ? (
          cheapest && (
            <Btn tone="brand" onClick={() => unlock.join(cheapest)} disabled={unlock.busy !== null}>
              <Spin on={unlock.busy === `tier-${cheapest.id}`} /> {t("Join {tier} · {price}/mo", { tier: cheapest.name, price: rupees(cheapest.price_minor) })}
            </Btn>
          )
        ) : lock.price_minor ? (
          <Btn tone="brand" onClick={unlock.buy} disabled={unlock.busy !== null}>
            <Spin on={unlock.busy === "video"} /> {t("Buy for {price}", { price: rupees(lock.price_minor, lock.currency) })}
          </Btn>
        ) : null}
        {onReplay && lock.preview_seconds > 0 && (
          <Btn tone="soft" onClick={onReplay}><RotateCcw size={15} aria-hidden="true" /> {t("Replay preview")}</Btn>
        )}
      </div>
    </div>
  )
}

export function PaywallPanel({ video, lock, unlock, fee }: { video: VideoDetail; lock: VideoLock; unlock: Unlock; fee?: string }) {
  const t = useT("watchx")
  const members = lock.access === "members"
  const channel = video.channel?.name ?? t("this channel")
  return (
    <section aria-label={members ? t("Members-only video") : t("Paid video")} className="rounded-2xl border border-brand/50 bg-gradient-to-b from-brand/15 to-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Lock size={17} className="text-brand-soft" aria-hidden="true" />
        <h2 className="text-base font-bold">{members ? t("Members-only video") : t("Paid video")}</h2>
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-xs font-semibold text-ink">{previewLabel(lock)}</span>
      </div>
      <p className="mt-2 text-sm text-muted">
        {members
          ? t((lock.members_rank ?? 1) > 1 ? "You are watching a preview. Join {channel} at one of these tiers to watch the whole video, its transcript and Ask." : "You are watching a preview. Join {channel} to watch the whole video, its transcript and Ask.", { channel })
          : t("You are watching a preview. Buy it once to watch the whole video, read its transcript and ask it questions.")}
      </p>

      {members ? (
        <ul className="mt-4 space-y-2">
          {(lock.tiers ?? []).map((tier) => (
            <li key={tier.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-panel-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{tier.name} <TierBadge>{tier.badge || t("Member")}</TierBadge></p>
                <p className="text-xs text-muted">{t("{price} / month", { price: rupees(tier.price_minor) })}</p>
              </div>
              {lock.signed_in ? (
                <Btn tone="brand" size="sm" onClick={() => unlock.join(tier)} disabled={unlock.busy !== null}>
                  <Spin on={unlock.busy === `tier-${tier.id}`} /> {t("Join")}
                </Btn>
              ) : (
                <Link to={loginPath()} className="inline-flex h-8 items-center rounded-full bg-snow px-3 text-xs font-semibold text-black hover:bg-snow/85">{t("Sign in to join")}</Link>
              )}
            </li>
          ))}
          {(lock.tiers ?? []).length === 0 && <li className="text-sm text-muted">{t("{channel} has no open memberships right now.", { channel })}</li>}
        </ul>
      ) : (
        <div className="mt-4 space-y-2">
          {lock.price_minor ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-panel-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t("This video")}</p>
                <p className="text-xs text-muted">{t("{price} · yours to keep", { price: rupees(lock.price_minor, lock.currency) })}</p>
              </div>
              {lock.signed_in ? (
                <Btn tone="brand" size="sm" onClick={unlock.buy} disabled={unlock.busy !== null}>
                  <Spin on={unlock.busy === "video"} /> {t("Buy {price}", { price: rupees(lock.price_minor, lock.currency) })}
                </Btn>
              ) : (
                <Link to={loginPath()} className="inline-flex h-8 items-center rounded-full bg-snow px-3 text-xs font-semibold text-black hover:bg-snow/85">{t("Sign in to buy")}</Link>
              )}
            </div>
          ) : null}
          {(lock.series ?? []).length > 0 && <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("Or get the whole series")}</p>}
          {(lock.series ?? []).map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-panel-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <Link to={`/playlist/${s.id}`} className="block truncate text-sm font-semibold hover:underline">{s.title}</Link>
                <p className="text-xs text-muted">{t("{price} · every video in the series", { price: rupees(s.price_minor) })}</p>
              </div>
              {lock.signed_in ? (
                <Btn tone="soft" size="sm" onClick={() => unlock.buySeries(s)} disabled={unlock.busy !== null}>
                  <Spin on={unlock.busy === `series-${s.id}`} /> {t("Buy series {price}", { price: rupees(s.price_minor) })}
                </Btn>
              ) : (
                <Link to={loginPath()} className="inline-flex h-8 items-center rounded-full bg-snow px-3 text-xs font-semibold text-black hover:bg-snow/85">{t("Sign in to buy")}</Link>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-faint">{t("Payments in India only, in rupees. The creator gets your payment minus {fee} and taxes.", { fee: fee ?? t("a platform fee") })}</p>
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
