import { Suspense, lazy, useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Bell, Clapperboard, CreditCard, Download, Home, Languages, LogOut, MessageSquareText, Rss, Search, Upload, User, UserCircle2, X } from "lucide-react"
import { api, useAuthStore, useSession } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { STUDIO_URL, useMe, useSignedIn } from "../lib/api"
import { hue, initials } from "../lib/format"
import { useNavTrail } from "../lib/traffic"
import { queryClient } from "../lib/queryClient"
import { useInboxCount, useSubscriptionsCount } from "../lib/inbox"
import { useInstallPrompt } from "../pwa"
import { LANGS, setLang, useLang, useT, type Lang } from "../i18n"

const FeedbackDialog = lazy(() => import("./Feedback"))
const InboxPanel = lazy(() => import("./InboxPanel"))

export async function chooseLang(next: Lang) {
  setLang(next)
  const { token, user, setAuth } = useAuthStore.getState()
  if (!token || !user || user.settings?.language === next) return
  setAuth(token, { ...user, settings: { ...(user.settings ?? {}), language: next } })
  const res = await api.patch("/api/video/me", { language: next }).catch(() => null)
  if (res) queryClient.setQueryData(["me"], res.data)
}

export function LangSwitch({ className }: { className?: string }) {
  const t = useT()
  const lang = useLang()
  return (
    <div role="group" aria-label={t("Language")} className={cn("inline-flex h-8 items-center rounded-full bg-white/[0.08] p-0.5 text-xs font-semibold", className)}>
      <Languages size={14} aria-hidden="true" className="mx-1.5 hidden text-muted lg:block" />
      {LANGS.map((l) => (
        <button
          key={l.value}
          type="button"
          lang={l.value}
          aria-pressed={lang === l.value}
          onClick={() => void chooseLang(l.value)}
          className={cn("h-7 rounded-full px-2.5", lang === l.value ? "bg-snow text-black" : "text-ink hover:bg-white/10")}
        >
          {l.short}
        </button>
      ))}
    </div>
  )
}

function useOutside(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close()
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, close])
  return box
}

function NotificationBell() {
  const t = useT()
  const { data } = useInboxCount()
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const box = useOutside(open, close)
  const location = useLocation()
  const unread = data?.unread ?? 0
  useEffect(() => setOpen(false), [location.pathname])
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => {
          setUsed(true)
          setOpen(!open)
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread ? t("Notifications, {n} unread", { n: unread }) : t("Notifications")}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-white/10"
      >
        <Bell size={20} aria-hidden="true" />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-[#dc2626] px-1 text-center text-[10px] font-bold leading-[18px] text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {used && open && (
        <Suspense fallback={null}>
          <InboxPanel onClose={close} />
        </Suspense>
      )}
    </div>
  )
}

function InstallButton() {
  const t = useT()
  const { available, install } = useInstallPrompt()
  if (!available) return null
  return (
    <button
      type="button"
      onClick={() => void install()}
      aria-label={t("Install app")}
      title={t("Install app")}
      className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold text-ink hover:bg-white/10"
    >
      <Download size={17} aria-hidden="true" />
      <span className="hidden xl:inline">{t("Install app")}</span>
    </button>
  )
}

function NewCount({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null
  return <span aria-hidden="true" className={cn("min-w-[18px] rounded-full bg-brand px-1 text-center text-[10px] font-bold leading-[18px] text-white", className)}>{n > 99 ? "99+" : n}</span>
}

export function Logo({ compact = false }: { compact?: boolean }) {
  const t = useT()
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2" aria-label={t("Klygenix Play home")}>
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#C026D3] to-[#6B21A8] shadow-[0_0_18px_rgba(192,38,211,.35)]">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="#fff" /></svg>
      </span>
      {!compact && (
        <span className="text-[17px] font-bold tracking-tight text-white">
          Klygenix <span className="text-brand-soft">Play</span>
        </span>
      )}
    </Link>
  )
}

function SearchBox({ className, autoFocus, onDone }: { className?: string; autoFocus?: boolean; onDone?: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [q, setQ] = useState(location.pathname === "/search" ? params.get("q") ?? "" : "")

  useEffect(() => {
    if (location.pathname === "/search") setQ(params.get("q") ?? "")
  }, [location.pathname, params])

  function submit(e: FormEvent) {
    e.preventDefault()
    const term = q.trim()
    if (!term) return
    navigate(`/search?q=${encodeURIComponent(term)}`)
    onDone?.()
  }

  return (
    <form role="search" onSubmit={submit} className={cn("flex min-w-0 items-center", className)}>
      <div className="relative min-w-0 flex-1">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Search videos and moments inside them")}
          aria-label={t("Search")}
          enterKeyHint="search"
          autoComplete="off"
          autoFocus={autoFocus}
          className="h-10 w-full rounded-l-full border border-line bg-panel px-4 text-sm text-ink placeholder:text-faint outline-none focus:border-brand"
        />
      </div>
      <button type="submit" aria-label={t("Search")} className="flex h-10 w-14 shrink-0 items-center justify-center rounded-r-full border border-l-0 border-line bg-panel-2 text-ink hover:bg-panel-3">
        <Search size={18} />
      </button>
    </form>
  )
}

function AccountMenu({ onFeedback }: { onFeedback: () => void }) {
  const t = useT()
  const subs = useSubscriptionsCount()
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const { data: me } = useMe()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const box = useOutside(open, close)
  const navigate = useNavigate()
  const name = me?.profile?.display_name ?? user?.name ?? ""
  const h = hue(user?.email ?? name)

  function signOut() {
    clearAuth()
    setOpen(false)
    navigate("/")
  }

  const item = "flex w-full items-center gap-3 px-4 py-2.5 text-sm text-ink hover:bg-white/[0.06]"

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white ring-2 ring-transparent transition hover:ring-brand/60"
        style={{ background: `linear-gradient(135deg, hsl(${h} 65% 45%), hsl(${(h + 50) % 360} 70% 35%))` }}
      >
        <span aria-hidden="true" data-initials={initials(name)} className="before:content-[attr(data-initials)]" />
        <span className="sr-only">{t("Account menu")}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-2xl border border-line bg-panel py-1.5 shadow-2xl">
          <div className="border-b border-line px-4 pb-3 pt-2">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
            {me && !me.plans.viewer.free && <p className="mt-1 text-xs font-semibold text-brand-soft">{me.plans.viewer.name}</p>}
          </div>
          {me?.channel && (
            <Link to={`/@${me.channel.handle}`} className={item} onClick={() => setOpen(false)} role="menuitem">
              <UserCircle2 size={17} className="text-muted" /> {t("Your channel")}
            </Link>
          )}
          <Link to="/subscriptions" className={item} onClick={() => setOpen(false)} role="menuitem">
            <Rss size={17} className="text-muted" /> <span className="flex-1">{t("Subscriptions")}</span>
            <NewCount n={subs.data?.new_count ?? 0} />
          </Link>
          <Link to="/notifications" className={item} onClick={() => setOpen(false)} role="menuitem">
            <Bell size={17} className="text-muted" /> {t("Notifications")}
          </Link>
          <a href={STUDIO_URL} className={item} role="menuitem">
            <Clapperboard size={17} className="text-muted" /> Klygenix Studio
          </a>
          <Link to="/account" className={item} onClick={() => setOpen(false)} role="menuitem">
            <User size={17} className="text-muted" /> {t("Account")}
          </Link>
          <Link to="/plans" className={item} onClick={() => setOpen(false)} role="menuitem">
            <CreditCard size={17} className="text-muted" /> {t("Plans")}
          </Link>
          <button type="button" className={item} onClick={() => { setOpen(false); onFeedback() }} role="menuitem">
            <MessageSquareText size={17} className="text-muted" /> {t("Send feedback")}
          </button>
          <button type="button" className={cn(item, "border-t border-line")} onClick={signOut} role="menuitem">
            <LogOut size={17} className="text-muted" /> {t("Sign out")}
          </button>
          <div className="flex items-center gap-3 border-t border-line px-4 py-2.5 sm:hidden">
            <span className="flex-1 text-sm text-muted">{t("Language")}</span>
            <LangSwitch />
          </div>
        </div>
      )}
    </div>
  )
}

function TopBar({ onFeedback }: { onFeedback: () => void }) {
  const t = useT()
  const signedIn = useSignedIn()
  const subs = useSubscriptionsCount()
  const fresh = signedIn ? subs.data?.new_count ?? 0 : 0
  const location = useLocation()
  const [searching, setSearching] = useState(false)

  useEffect(() => setSearching(false), [location.pathname])

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.04] bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-3 px-3 sm:px-5">
        {searching ? (
          <>
            <button type="button" onClick={() => setSearching(false)} aria-label={t("Close search")} className="rounded-full p-2 text-muted hover:bg-white/10">
              <X size={20} />
            </button>
            <SearchBox className="flex-1" autoFocus onDone={() => setSearching(false)} />
          </>
        ) : (
          <>
            <Logo />
            {signedIn && (
              <NavLink
                to="/subscriptions"
                className={({ isActive }) => cn("ml-2 hidden h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold md:inline-flex", isActive ? "bg-white/10 text-white" : "text-ink hover:bg-white/10")}
              >
                <Rss size={16} aria-hidden="true" />
                <span className="hidden lg:inline">{t("Subscriptions")}</span>
                <span className="sr-only lg:hidden">{t("Subscriptions")}</span>
                {fresh > 0 && <span className="sr-only">{t("{n} new", { n: fresh })}</span>}
                <NewCount n={fresh} />
              </NavLink>
            )}
            <div className="hidden flex-1 justify-center px-4 md:flex">
              <SearchBox className="w-full max-w-xl" />
            </div>
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <LangSwitch className="hidden sm:inline-flex" />
              <InstallButton />
              <button type="button" onClick={() => setSearching(true)} aria-label={t("Search")} className="rounded-full p-2 text-ink hover:bg-white/10 md:hidden">
                <Search size={20} />
              </button>
              <a
                href={STUDIO_URL}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.08] px-3 text-sm font-semibold text-ink hover:bg-white/15 sm:px-4"
                aria-label={t("Upload in Klygenix Studio")}
              >
                <Upload size={16} aria-hidden="true" />
                <span className="hidden sm:inline">{t("Upload")}</span>
              </a>
              {signedIn && <NotificationBell />}
              {signedIn ? (
                <AccountMenu onFeedback={onFeedback} />
              ) : (
                <Link to="/login" className="inline-flex h-9 items-center gap-2 rounded-full border border-brand/60 px-3.5 text-sm font-semibold text-brand-soft hover:bg-brand/15">
                  <UserCircle2 size={17} aria-hidden="true" />
                  {t("Sign in")}
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  )
}

function BottomNav() {
  const t = useT()
  const signedIn = useSignedIn()
  const subs = useSubscriptionsCount()
  const fresh = signedIn ? subs.data?.new_count ?? 0 : 0
  const tabs = [
    { to: "/", label: "Home", icon: Home, end: true, badge: 0 },
    { to: "/reels", label: "Reels", icon: Clapperboard, end: false, badge: 0 },
    ...(signedIn ? [{ to: "/subscriptions", label: "Subscriptions", icon: Rss, end: false, badge: fresh }] : []),
    { to: "/search", label: "Search", icon: Search, end: false, badge: 0 },
    { to: signedIn ? "/account" : "/login", label: signedIn ? "Account" : "Sign in", icon: User, end: false, badge: 0 },
  ]
  return (
    <nav aria-label={t("Main")} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
      <ul className={cn("grid h-14", tabs.length === 5 ? "grid-cols-5" : "grid-cols-4")}>
        {tabs.map((tab) => (
          <li key={tab.label}>
            <NavLink
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => cn("flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium", isActive ? "text-white" : "text-muted")}
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <tab.icon size={21} strokeWidth={isActive ? 2.4 : 1.8} className={isActive ? "text-brand-soft" : undefined} aria-hidden="true" />
                    <NewCount n={tab.badge} className="absolute -right-3 -top-1.5" />
                  </span>
                  <span className="max-w-full truncate px-0.5">{t(tab.label)}</span>
                  {tab.badge > 0 && <span className="sr-only">{t("{n} new", { n: tab.badge })}</span>}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function Footer({ onFeedback }: { onFeedback?: () => void }) {
  const t = useT()
  const links = [
    { to: "/legal/terms", label: "Terms" },
    { to: "/legal/privacy", label: "Privacy" },
    { to: "/legal/guidelines", label: "Community guidelines" },
    { to: "/legal/copyright", label: "Copyright" },
    { to: "/legal/grievance", label: "Grievance officer" },
    { to: "/legal/monetisation", label: "Creator monetisation" },
    { to: "/legal/live", label: "Live rules" },
    { to: "/plans", label: "Plans" },
    { to: "/brands", label: "For brands" },
  ]
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Logo compact />
          <p className="text-xs text-muted">© {new Date().getFullYear()} Klygenix Technologies Private Limited</p>
          <LangSwitch className="ml-1" />
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
          {links.map((l) => (
            <li key={l.to}><Link to={l.to} className="hover:text-ink">{t(l.label)}</Link></li>
          ))}
          {onFeedback && <li><button type="button" onClick={onFeedback} className="hover:text-ink">{t("Send feedback")}</button></li>}
        </ul>
      </div>
    </footer>
  )
}

export function Layout() {
  const t = useT()
  useSession()
  useNavTrail()
  const location = useLocation()
  const immersive = location.pathname.startsWith("/reels")
  const [feedback, setFeedback] = useState(false)
  const [feedbackUsed, setFeedbackUsed] = useState(false)
  const openFeedback = () => {
    setFeedbackUsed(true)
    setFeedback(true)
  }

  useEffect(() => {
    if (!immersive) window.scrollTo(0, 0)
  }, [location.pathname, immersive])

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-white">{t("Skip to content")}</a>
      <TopBar onFeedback={openFeedback} />
      <main id="main">
        <Outlet />
      </main>
      {!immersive && <Footer onFeedback={openFeedback} />}
      {!immersive && <div className="h-14 md:hidden" />}
      <BottomNav />
      {feedbackUsed && (
        <Suspense fallback={null}>
          <FeedbackDialog open={feedback} onClose={() => setFeedback(false)} />
        </Suspense>
      )}
    </div>
  )
}

export function PageShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1800px] px-3 py-4 sm:px-6 sm:py-6", className)}>{children}</div>
}
