import { useEffect, useState } from "react"
import { Check } from "lucide-react"
import { Drawer } from "./ui"
import { THEMES, applyTheme, readStoredTheme, type ThemeKey } from "../theme"
import { useUiText } from "../text"

const GROUPS = [
  { key: "full", title: "theme.full", note: "theme.fullNote" },
  { key: "chrome", title: "theme.chrome", note: "theme.chromeNote" },
] as const

export function ThemeSheet({
  open,
  onClose,
  app,
  accent,
  value,
  onSelect,
  saving,
}: {
  open: boolean
  onClose: () => void
  app: string
  accent: string
  value?: ThemeKey
  onSelect: (theme: ThemeKey) => void
  saving?: boolean
}) {
  const ui = useUiText()
  const [picked, setPicked] = useState<ThemeKey>(value ?? readStoredTheme(app))

  useEffect(() => {
    if (open) setPicked(value ?? readStoredTheme(app))
  }, [open, value, app])

  function choose(theme: ThemeKey) {
    setPicked(theme)
    applyTheme(theme)
    onSelect(theme)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={ui.t("theme")}
      subtitle={ui.t("theme.subtitle", { app: app.toUpperCase() })}
      width="sm"
    >
      <div className="space-y-5">
        {GROUPS.map((g) => (
          <div key={g.key}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{ui.t(g.title)}</p>
            <p className="mb-2 text-xs text-slate-400">{ui.t(g.note)}</p>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.filter((t) => t.group === g.key).map((t) => {
                const s = t.swatch
                const active = picked === t.key
                const dot = s.accent || accent
                return (
                  <button
                    key={t.key}
                    type="button"
                    disabled={saving}
                    title={t.hint}
                    onClick={() => choose(t.key)}
                    className={`rounded-xl border p-2 text-left transition ${
                      active
                        ? "border-brand ring-2 ring-brand/40"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <span
                      className="flex h-11 w-full overflow-hidden rounded-lg border"
                      style={{ borderColor: s.rule, background: "#f8fafc" }}
                    >
                      <span
                        className="h-full w-1/3"
                        style={{ background: s.side, borderRight: `1px solid ${s.rule}` }}
                      />
                      <span className="flex flex-1 flex-col">
                        <span
                          className="h-3 w-full"
                          style={{ background: s.hdr, borderBottom: `1px solid ${s.rule}` }}
                        />
                        <span className="flex flex-1 items-end gap-1 p-1">
                          <span className="h-2 flex-1 rounded-sm bg-slate-300" />
                          <span className="h-2 w-4 rounded-sm" style={{ background: dot }} />
                        </span>
                      </span>
                    </span>
                    <span className="mt-1.5 flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-navy">
                        {t.label}
                      </span>
                      {active && <Check size={14} className="shrink-0 text-brand" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs text-slate-500">
        {ui.t("theme.saved")}
      </p>
    </Drawer>
  )
}
