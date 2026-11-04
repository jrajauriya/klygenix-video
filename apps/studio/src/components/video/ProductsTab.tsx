import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink, Plus, ShoppingBag, Trash2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, Spinner, useConfirm } from "@klygenixvideo/ui"
import { useHasPermission } from "../../lib/team"
import { ViewOnly } from "../team/ViewOnly"
import { STUDIO } from "../../lib/hooks"
import { compact, detail } from "../../lib/format"
import type { ProductLink, StudioVideoDetail } from "../../lib/types"
import { useT } from "../../i18n"

const MAX = 5

export function ProductsTab({ video }: { video: StudioVideoDetail }) {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canEdit = useHasPermission("video.uploads", "full")
  const key = ["studio-video-products", video.id]
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<ProductLink[]>(`${STUDIO}/videos/${video.id}/products`)).data,
  })
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")
  const [price, setPrice] = useState("")
  const [busy, setBusy] = useState(false)
  const rows = data ?? []
  const urlError = url && (!/^https:\/\/\S+\.\S+/.test(url.trim()) ? t("Use a full https:// link.") : undefined)
  const full = rows.length >= MAX

  async function add() {
    setBusy(true)
    try {
      await api.post(`${STUDIO}/videos/${video.id}/products`, { title: title.trim(), url: url.trim(), price_text: price.trim(), position: rows.length })
      toast.success(t("Product link added"))
      setTitle("")
      setUrl("")
      setPrice("")
      qc.invalidateQueries({ queryKey: key })
    } catch (err) {
      toast.error(detail(err, t("Could not add the link")))
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: ProductLink) {
    const ok = await confirm({ title: t("Remove “{title}”?", { title: p.title }), message: t("Viewers stop seeing this link under the video."), confirmLabel: t("Remove"), variant: "destructive" })
    if (!ok) return
    try {
      await api.delete(`${STUDIO}/videos/${video.id}/products/${p.id}`)
      toast.success(t("Link removed"))
      qc.invalidateQueries({ queryKey: key })
    } catch (err) {
      toast.error(detail(err, t("Could not remove the link")))
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
      <Card className="p-0 lg:col-span-3">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-bold text-navy">{t("Product links")}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {t("Up to {n} links shown under the video. Viewers see them marked “Product link added by the creator”, and Klygenix Play does not sell or vouch for them.", { n: MAX })}
          </p>
        </div>
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">{t("No product links yet.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand" aria-hidden="true"><ShoppingBag size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{p.title}{p.price_text ? <span className="font-normal text-slate-600"> · {p.price_text}</span> : null}</p>
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-xs text-brand hover:underline">
                    {p.host} <ExternalLink size={11} aria-hidden="true" />
                  </a>
                </div>
                <span className="shrink-0 text-right text-xs text-slate-500"><b className="font-num text-sm text-navy">{compact(p.clicks)}</b> {p.clicks === 1 ? t("click") : t("clicks")}</span>
                {canEdit && (
                  <Button size="icon" variant="ghost" aria-label={t("Remove {title}", { title: p.title })} onClick={() => remove(p)}>
                    <Trash2 size={15} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!canEdit && <div className="lg:col-span-2"><ViewOnly /></div>}
      {canEdit && (
        <Card className="space-y-4 p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-navy">{t("Add a link")}</h2>
          {full ? (
            <p className="text-sm text-slate-500">{t("You have {n} links on this video, the most allowed. Remove one to add another.", { n: MAX })}</p>
          ) : (
            <>
              <Field label={t("Product name")} required>
                <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label={t("Link")} required error={urlError || undefined} hint={t("Must start with https://")}>
                <Input type="url" value={url} maxLength={500} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <Field label={t("Price")} hint={t("Optional, as you want viewers to see it, like ₹499")}>
                <Input value={price} maxLength={40} onChange={(e) => setPrice(e.target.value)} />
              </Field>
              <div className="flex justify-end">
                <Button onClick={add} disabled={busy || !title.trim() || !url.trim() || Boolean(urlError)}>
                  <Plus size={14} /> {busy ? t("Adding…") : t("Add link")}
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  )
}
