import { useState } from "react"
import { toast } from "sonner"
import { ExternalLink, ShoppingBag } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { errText } from "../../lib/api"
import type { ProductLink } from "../../lib/types"
import { useT } from "../../i18n"

function openOut(url: string, pending: Window | null) {
  if (pending && !pending.closed) {
    pending.opener = null
    pending.location.replace(url)
    return
  }
  const a = document.createElement("a")
  a.href = url
  a.target = "_blank"
  a.rel = "noopener sponsored"
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function ProductStrip({ products }: { products: { disclosure: string; items: ProductLink[] } }) {
  const t = useT("watchx", products.items.length > 0)
  const [busy, setBusy] = useState<number | null>(null)
  const items = [...products.items].sort((a, b) => a.position - b.position || a.id - b.id)
  if (!items.length) return null

  async function open(p: ProductLink) {
    const pending = window.open("", "_blank")
    setBusy(p.id)
    try {
      const { data } = await api.post<{ url: string }>(`/api/video/products/${p.id}/click`)
      openOut(data.url, pending)
    } catch (err) {
      pending?.close()
      toast.error(errText(err, t("That link could not be opened.")))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label={t("Products")} className="rounded-2xl bg-panel p-3 sm:p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold"><ShoppingBag size={15} className="text-brand-soft" aria-hidden="true" /> {t("Products")}</h2>
      <p className="mt-1 text-xs text-muted">{products.disclosure}</p>
      <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {items.map((p) => (
          <li key={p.id} className="shrink-0">
            <button
              type="button"
              onClick={() => open(p)}
              disabled={busy === p.id}
              className="flex w-56 items-start gap-2 rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-left hover:border-brand/60 disabled:opacity-60"
            >
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-sm font-semibold leading-snug">{p.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted">{p.price_text ? `${p.price_text} · ` : ""}{p.host}</span>
              </span>
              <ExternalLink size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
