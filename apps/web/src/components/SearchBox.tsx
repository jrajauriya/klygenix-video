import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { BadgeCheck, Clock, Search, X } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { hue, initials } from "../lib/format"
import { useT } from "../i18n"

const RECENT_KEY = "kv-recent-searches"

type Suggestions = {
  query: string
  channels: { id: number; handle: string; name: string; avatar: string | null; verified: boolean }[]
  videos: { id: string; title: string; kind: string; thumbnail: string | null; channel: string }[]
}

type Option =
  | { kind: "recent"; key: string; text: string }
  | { kind: "channel"; key: string; to: string; channel: Suggestions["channels"][number] }
  | { kind: "video"; key: string; to: string; video: Suggestions["videos"][number] }
  | { kind: "search"; key: string; text: string }

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : []
  } catch {
    return []
  }
}

function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)))
  } catch {
    return
  }
}

function Highlight({ text, term }: { text: string; term: string }) {
  const at = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <strong className="font-semibold text-ink">{text.slice(at, at + term.length)}</strong>
      {text.slice(at + term.length)}
    </>
  )
}

export function SearchBox({ className, autoFocus, onDone }: { className?: string; autoFocus?: boolean; onDone?: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [q, setQ] = useState(location.pathname === "/search" ? params.get("q") ?? "" : "")
  const [term, setTerm] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [recent, setRecent] = useState<string[]>(readRecent)
  const box = useRef<HTMLFormElement>(null)
  const listId = useId()

  useEffect(() => {
    if (location.pathname === "/search") setQ(params.get("q") ?? "")
  }, [location.pathname, params])

  useEffect(() => {
    setOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    const id = setTimeout(() => setTerm(q.trim()), 150)
    return () => clearTimeout(id)
  }, [q])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [open])

  const { data } = useQuery({
    queryKey: ["search-suggest", term],
    queryFn: async () => (await api.get<Suggestions>("/api/video/search/suggest", { params: { q: term } })).data,
    enabled: open && term.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })

  const typed = q.trim()
  const options = useMemo<Option[]>(() => {
    const lower = typed.toLowerCase()
    const past = recent
      .filter((r) => (lower ? r.toLowerCase().startsWith(lower) && r.toLowerCase() !== lower : true))
      .slice(0, typed ? 3 : 8)
      .map<Option>((text) => ({ kind: "recent", key: `r:${text}`, text }))
    if (!typed) return past
    const channels = (data?.channels ?? []).map<Option>((c) => ({ kind: "channel", key: `c:${c.handle}`, to: `/@${c.handle}`, channel: c }))
    const videos = (data?.videos ?? []).map<Option>((v) => ({
      kind: "video", key: `v:${v.id}`, to: v.kind === "reel" ? `/reels/${v.id}` : `/watch/${v.id}`, video: v,
    }))
    return [...past, ...channels, ...videos, { kind: "search", key: "s", text: typed }]
  }, [typed, recent, data])

  useEffect(() => {
    setActive(-1)
  }, [typed])

  function remember(text: string) {
    const next = [text, ...recent.filter((r) => r.toLowerCase() !== text.toLowerCase())].slice(0, 8)
    setRecent(next)
    writeRecent(next)
  }

  function forget(text: string) {
    const next = recent.filter((r) => r !== text)
    setRecent(next)
    writeRecent(next)
  }

  function search(text: string) {
    const value = text.trim()
    if (!value) return
    remember(value)
    setQ(value)
    setOpen(false)
    navigate(`/search?q=${encodeURIComponent(value)}`)
    onDone?.()
  }

  function choose(o: Option) {
    if (o.kind === "recent" || o.kind === "search") return search(o.text)
    if (typed) remember(typed)
    setOpen(false)
    navigate(o.to)
    onDone?.()
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (open && active >= 0 && options[active]) return choose(options[active])
    search(q)
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (!open) return setOpen(true)
      if (!options.length) return
      const step = e.key === "ArrowDown" ? 1 : -1
      setActive((i) => ((i + 1 + step + options.length + 1) % (options.length + 1)) - 1)
    } else if (e.key === "Escape" && open) {
      e.preventDefault()
      setOpen(false)
    }
  }

  useEffect(() => {
    if (active >= options.length) setActive(-1)
  }, [active, options.length])

  const showList = open && options.length > 0
  const optionId = (i: number) => `${listId}-o${i}`

  const row = (o: Option, i: number, body: ReactNode, trailing?: ReactNode) => (
    <li
      key={o.key}
      id={optionId(i)}
      role="option"
      aria-selected={active === i}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => choose(o)}
      onPointerMove={() => setActive(i)}
      className={cn("flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-muted", active === i && "bg-panel-3 text-ink")}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      {trailing}
    </li>
  )

  return (
    <form ref={box} role="search" onSubmit={submit} className={cn("relative flex min-w-0 items-center", className)}>
      <div className="relative min-w-0 flex-1">
        <input
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={t("Search videos and moments inside them")}
          aria-label={t("Search")}
          enterKeyHint="search"
          autoComplete="off"
          autoFocus={autoFocus}
          className={cn(
            "h-10 w-full border border-line bg-panel px-4 text-sm text-ink placeholder:text-faint outline-none focus:border-brand",
            showList ? "rounded-tl-[20px] rounded-bl-none" : "rounded-l-full",
          )}
        />
      </div>
      <button type="submit" aria-label={t("Search")} className="flex h-10 w-14 shrink-0 items-center justify-center rounded-r-full border border-l-0 border-line bg-panel-2 text-ink hover:bg-panel-3">
        <Search size={18} />
      </button>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("Search suggestions")}
          className="absolute left-0 right-14 top-full z-50 max-h-[70vh] overflow-y-auto rounded-b-2xl border border-t-0 border-line bg-panel py-2 shadow-2xl"
        >
          {options.map((o, i) => {
            if (o.kind === "recent") {
              return row(
                o, i,
                <>
                  <Clock size={16} className="shrink-0 text-faint" aria-hidden />
                  <span className="truncate"><Highlight text={o.text} term={typed} /></span>
                </>,
                <button
                  type="button"
                  aria-label={t("Remove {q} from recent searches", { q: o.text })}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation()
                    forget(o.text)
                  }}
                  className="rounded-full p-1 text-faint hover:bg-panel-2 hover:text-ink"
                >
                  <X size={14} />
                </button>,
              )
            }
            if (o.kind === "channel") {
              const c = o.channel
              return row(
                o, i,
                <>
                  {c.avatar ? (
                    <img src={c.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span
                      aria-hidden
                      data-initials={initials(c.name)}
                      style={{ backgroundColor: `hsl(${hue(c.handle)} 55% 45%)` }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white before:content-[attr(data-initials)]"
                    />
                  )}
                  <span className="min-w-0 truncate">
                    <Highlight text={c.name} term={typed} />
                    <span className="ml-2 text-xs text-faint">@{c.handle}</span>
                  </span>
                  {c.verified && <BadgeCheck size={14} className="shrink-0 text-brand-soft" aria-label={t("Verified")} />}
                </>,
              )
            }
            if (o.kind === "video") {
              const v = o.video
              return row(
                o, i,
                <>
                  <span className={cn("shrink-0 overflow-hidden rounded bg-panel-2", v.kind === "reel" ? "h-10 w-7" : "h-9 w-16")}>
                    {v.thumbnail && <img src={v.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate"><Highlight text={v.title} term={typed} /></span>
                    <span className="block truncate text-xs text-faint">{v.channel}{v.kind === "reel" ? ` · ${t("Reel")}` : ""}</span>
                  </span>
                </>,
              )
            }
            return row(
              o, i,
              <>
                <Search size={16} className="shrink-0 text-faint" aria-hidden />
                <span className="truncate">{t("Search for “{q}”", { q: o.text })}</span>
              </>,
            )
          })}
        </ul>
      )}
    </form>
  )
}
