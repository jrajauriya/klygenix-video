import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Clapperboard, CreditCard, Home, LogOut, Search, Upload, User, UserCircle2, X } from "lucide-react"
import { useAuthStore, useSession } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { STUDIO_URL, useMe, useSignedIn } from "../lib/api"
import { hue, initials } from "../lib/format"

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Klygenix Play home">
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
          placeholder="Search videos and moments inside them"
          aria-label="Search"
          autoFocus={autoFocus}
          className="h-10 w-full rounded-l-full border border-line bg-panel px-4 text-sm text-ink placeholder:text-faint outline-none focus:border-brand"
        />
      </div>
      <button type="submit" aria-label="Search" className="flex h-10 w-14 shrink-0 items-center justify-center rounded-r-full border border-l-0 border-line bg-panel-2 text-ink hover:bg-panel-3">
        <Search size={18} />
      </button>
    </form>
  )
}

function AccountMenu() {
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const { data: me } = useMe()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const name = me?.profile?.display_name ?? user?.name ?? ""
  const h = hue(user?.email ?? name)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

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
        <span className="sr-only">Account menu</span>
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
              <UserCircle2 size={17} className="text-muted" /> Your channel
            </Link>
          )}
          <a href={STUDIO_URL} className={item} role="menuitem">
            <Clapperboard size={17} className="text-muted" /> Klygenix Studio
          </a>
          <Link to="/account" className={item} onClick={() => setOpen(false)} role="menuitem">
            <User size={17} className="text-muted" /> Account
          </Link>
          <Link to="/plans" className={item} onClick={() => setOpen(false)} role="menuitem">
            <CreditCard size={17} className="text-muted" /> Plans
          </Link>
          <button type="button" className={cn(item, "border-t border-line")} onClick={signOut} role="menuitem">
            <LogOut size={17} className="text-muted" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function TopBar() {
  const signedIn = useSignedIn()
  const location = useLocation()
  const [searching, setSearching] = useState(false)

  useEffect(() => setSearching(false), [location.pathname])

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.04] bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-3 px-3 sm:px-5">
        {searching ? (
          <>
            <button type="button" onClick={() => setSearching(false)} aria-label="Close search" className="rounded-full p-2 text-muted hover:bg-white/10">
              <X size={20} />
            </button>
            <SearchBox className="flex-1" autoFocus onDone={() => setSearching(false)} />
          </>
        ) : (
          <>
            <Logo />
            <div className="hidden flex-1 justify-center px-4 md:flex">
              <SearchBox className="w-full max-w-xl" />
            </div>
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <button type="button" onClick={() => setSearching(true)} aria-label="Search" className="rounded-full p-2 text-ink hover:bg-white/10 md:hidden">
                <Search size={20} />
              </button>
              <a
                href={STUDIO_URL}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.08] px-3 text-sm font-semibold text-ink hover:bg-white/15 sm:px-4"
                aria-label="Upload in Klygenix Studio"
              >
                <Upload size={16} aria-hidden="true" />
                <span className="hidden sm:inline">Upload</span>
              </a>
              {signedIn ? (
                <AccountMenu />
              ) : (
                <Link to="/login" className="inline-flex h-9 items-center gap-2 rounded-full border border-brand/60 px-3.5 text-sm font-semibold text-brand-soft hover:bg-brand/15">
                  <UserCircle2 size={17} aria-hidden="true" />
                  Sign in
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
  const signedIn = useSignedIn()
  const tabs = [
    { to: "/", label: "Home", icon: Home, end: true },
    { to: "/reels", label: "Reels", icon: Clapperboard, end: false },
    { to: "/search", label: "Search", icon: Search, end: false },
    { to: signedIn ? "/account" : "/login", label: signedIn ? "Account" : "Sign in", icon: User, end: false },
  ]
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
      <ul className="grid h-14 grid-cols-4">
        {tabs.map((t) => (
          <li key={t.label}>
            <NavLink
              to={t.to}
              end={t.end}
              className={({ isActive }) => cn("flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium", isActive ? "text-white" : "text-muted")}
            >
              {({ isActive }) => (
                <>
                  <t.icon size={21} strokeWidth={isActive ? 2.4 : 1.8} className={isActive ? "text-brand-soft" : undefined} aria-hidden="true" />
                  {t.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function Footer() {
  const links = [
    { to: "/legal/terms", label: "Terms" },
    { to: "/legal/privacy", label: "Privacy" },
    { to: "/legal/guidelines", label: "Community guidelines" },
    { to: "/legal/copyright", label: "Copyright" },
    { to: "/legal/grievance", label: "Grievance officer" },
    { to: "/plans", label: "Plans" },
  ]
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Logo compact />
          <p className="text-xs text-muted">© {new Date().getFullYear()} Klygenix Technologies Private Limited</p>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
          {links.map((l) => (
            <li key={l.to}><Link to={l.to} className="hover:text-ink">{l.label}</Link></li>
          ))}
        </ul>
      </div>
    </footer>
  )
}

export function Layout() {
  useSession()
  const location = useLocation()
  const immersive = location.pathname.startsWith("/reels")

  useEffect(() => {
    if (!immersive) window.scrollTo(0, 0)
  }, [location.pathname, immersive])

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-white">Skip to content</a>
      <TopBar />
      <main id="main">
        <Outlet />
      </main>
      {!immersive && <Footer />}
      {!immersive && <div className="h-14 md:hidden" />}
      <BottomNav />
    </div>
  )
}

export function PageShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1800px] px-3 py-4 sm:px-6 sm:py-6", className)}>{children}</div>
}
