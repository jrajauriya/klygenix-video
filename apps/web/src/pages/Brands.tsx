import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, BadgeCheck, Clapperboard, Globe2, Handshake, MonitorPlay, ShieldCheck, Target, Wallet } from "lucide-react"
import { PageShell } from "../components/Layout"
import { Skel } from "../components/bits"
import { STUDIO_URL, getJson } from "../lib/api"
import { compactNumber } from "../lib/format"
import { useTitle } from "../lib/title"
import { useT } from "../i18n"
import { rich } from "../i18n/rich"

interface BrandsInfo {
  open_briefs: number
  brands: number
  how: string[]
}

const ADS = [
  { icon: MonitorPlay, text: "Short video ads before and during long videos, skippable after a few seconds." },
  { icon: Target, text: "Target by country, language and device, with daily spending caps." },
  { icon: Wallet, text: "Pay per thousand ad starts from a prepaid budget, with a GST invoice." },
]

const DEALS = [
  { icon: Handshake, text: "Post a brief and work directly with creators whose audience fits." },
  { icon: ShieldCheck, text: "Your money is held until you approve the finished video." },
  { icon: BadgeCheck, text: "Every sponsored video shows a clear “Paid partnership” label." },
]

function Stat({ value, label, loading }: { value: number | undefined; label: string; loading: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/80 px-5 py-4">
      {loading ? <Skel className="h-8 w-16" /> : <p className="text-3xl font-bold tabular-nums">{compactNumber(value ?? 0)}</p>}
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  )
}

export default function BrandsPage() {
  const t = useT("plans")
  useTitle(t("For brands"))
  const q = useQuery({ queryKey: ["brands-info"], queryFn: () => getJson<BrandsInfo>("/api/video/brands"), staleTime: 60_000 })
  const studio = `${STUDIO_URL.replace(/\/$/, "")}/brand`

  return (
    <PageShell className="max-w-6xl">
      <section className="relative overflow-hidden rounded-3xl border border-line bg-[radial-gradient(circle_at_20%_10%,#4a044e,#0b0b12_65%)] px-6 py-12 sm:px-12 sm:py-16">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand/30 blur-[100px]" />
        <p className="relative inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-soft">
          <Clapperboard size={14} aria-hidden="true" /> {t("Klygenix Play for brands")}
        </p>
        <h1 className="relative mt-4 max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">{t("Reach people who are actually watching")}</h1>
        <p className="relative mt-4 max-w-2xl text-base text-ink/85 sm:text-lg">
          {t("Run video ads on long videos from creators who opted in, or sponsor creators directly. Everything is set up, funded and reported in Klygenix Studio.")}
        </p>
        <div className="relative mt-8 flex flex-wrap gap-3">
          <a href={studio} className="inline-flex h-11 items-center gap-2 rounded-full bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-hover">
            {t("Open your brand profile")} <ArrowRight size={16} aria-hidden="true" />
          </a>
          <a href="#how" className="inline-flex h-11 items-center rounded-full bg-white/10 px-6 text-sm font-semibold text-ink hover:bg-white/15">{t("How it works")}</a>
        </div>
        <div className="relative mt-10 grid max-w-md grid-cols-2 gap-3">
          <Stat value={q.data?.open_briefs} label={t("Open briefs right now")} loading={q.isLoading} />
          <Stat value={q.data?.brands} label={t("Brands on Klygenix Play")} loading={q.isLoading} />
        </div>
      </section>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <section aria-labelledby="ads-title" className="rounded-3xl border border-line bg-panel p-6 sm:p-8">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#FACC15] text-black"><MonitorPlay size={22} aria-hidden="true" /></span>
          <h2 id="ads-title" className="mt-4 text-xl font-bold">{t("Video ads")}</h2>
          <ul className="mt-4 space-y-3">
            {ADS.map((a) => (
              <li key={a.text} className="flex gap-3 text-sm text-ink/90">
                <a.icon size={18} className="mt-0.5 shrink-0 text-brand-soft" aria-hidden="true" /> {t(a.text)}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-muted">{t("Ads never run on members-only or paid videos, on videos embedded from other platforms, or for Premium viewers.")}</p>
        </section>
        <section aria-labelledby="deals-title" className="rounded-3xl border border-line bg-panel p-6 sm:p-8">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand text-white"><Handshake size={22} aria-hidden="true" /></span>
          <h2 id="deals-title" className="mt-4 text-xl font-bold">{t("Creator sponsorships")}</h2>
          <ul className="mt-4 space-y-3">
            {DEALS.map((a) => (
              <li key={a.text} className="flex gap-3 text-sm text-ink/90">
                <a.icon size={18} className="mt-0.5 shrink-0 text-brand-soft" aria-hidden="true" /> {t(a.text)}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-muted">{t("Creators decide which briefs to take. Sponsored content follows the same community guidelines as everything else.")}</p>
        </section>
      </div>

      <section id="how" aria-labelledby="how-title" className="mt-8 scroll-mt-20 rounded-3xl border border-line bg-panel p-6 sm:p-8">
        <h2 id="how-title" className="text-xl font-bold">{t("How it works")}</h2>
        {q.isLoading ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skel key={i} className="h-24" />)}</div>
        ) : (
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(q.data?.how ?? []).map((step, i) => (
              <li key={step} className="rounded-2xl bg-panel-2 p-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/25 text-sm font-bold text-brand-soft" aria-hidden="true">{i + 1}</span>
                <p className="mt-3 text-sm text-ink/90">{step}</p>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-6">
          <Globe2 size={18} className="text-muted" aria-hidden="true" />
          <p className="flex-1 text-sm text-muted">{rich(t("Brand payments are in Indian rupees for now. Brands abroad can {link}."), { link: <Link to="/waitlist?role=brand" className="font-semibold text-brand-soft hover:underline">{t("join the waitlist")}</Link> })}</p>
          <a href={studio} className="inline-flex h-10 items-center gap-2 rounded-full bg-snow px-5 text-sm font-semibold text-black hover:bg-snow/85">
            {t("Get started in Studio")} <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
      </section>
    </PageShell>
  )
}
