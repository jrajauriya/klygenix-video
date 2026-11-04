import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Copy, Download, ExternalLink, FileText, Sparkles } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, EmptyState, Select, Spinner } from "@klygenixvideo/ui"
import { useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import { clock, detail, watchUrl, when } from "../../lib/format"
import { download } from "../../lib/download"
import type { RepurposePack, StudioVideoDetail } from "../../lib/types"
import { useT } from "../../i18n"

const BLOCKS: { key: keyof Pick<RepurposePack, "blog_post" | "x_post" | "linkedin_post" | "instagram_caption" | "newsletter">; label: string; tall?: boolean }[] = [
  { key: "blog_post", label: "Blog post", tall: true },
  { key: "x_post", label: "X post" },
  { key: "linkedin_post", label: "LinkedIn post" },
  { key: "instagram_caption", label: "Instagram caption" },
  { key: "newsletter", label: "Newsletter", tall: true },
]

export function RepurposeTab({ video }: { video: StudioVideoDetail }) {
  const t = useT()
  const qc = useQueryClient()
  const canEdit = useHasPermission("video.uploads", "full")
  const [language, setLanguage] = useState<"en" | "hi">(video.language === "hi" ? "hi" : "en")
  const [making, setMaking] = useState(false)
  const [saving, setSaving] = useState(false)
  const key = ["studio-repurpose", video.id]
  const { data: pack, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ pack: RepurposePack | null }>(`${STUDIO}/videos/${video.id}/repurpose`)).data.pack,
  })
  const ready = video.status === "published" || video.status === "in_review"

  async function make() {
    setMaking(true)
    try {
      const { data } = await api.post<RepurposePack>(`${STUDIO}/videos/${video.id}/repurpose`, { language })
      qc.setQueryData(key, data)
      toast.success(t("Your blog post and captions are ready"))
    } catch (err) {
      toast.error(detail(err, t("The pack could not be made")))
    } finally {
      setMaking(false)
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t("{what} copied", { what: t(label) }))
    } catch {
      toast.error(t("Could not copy. Select the text and copy it yourself."))
    }
  }

  async function saveMd() {
    if (!pack) return
    setSaving(true)
    try {
      await download(`${STUDIO}/repurpose/${pack.id}.md`, `repurpose-${pack.id}.md`)
    } catch (err) {
      toast.error(detail(err, t("The file could not be downloaded")))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return <Spinner />

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-navy">
            <Sparkles size={15} className="text-brand" aria-hidden="true" /> {t("Repurpose this video")}
          </h2>
          <p className="text-sm text-slate-500">
            {t("AI turns the transcript into a blog post, social captions and a newsletter. Every point links back to the moment in the video it came from.")}
          </p>
          {!ready && <p className="mt-1 text-xs text-amber-800">{t("Available once the video has been processed.")}</p>}
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-wrap items-end gap-2">
            <label className="block">
              <span className="label">{t("Write in")}</span>
              <Select
                value={language}
                onChange={(v) => setLanguage(v === "hi" ? "hi" : "en")}
                options={[{ value: "en", label: "English" }, { value: "hi", label: "हिन्दी" }]}
                className="w-32"
                aria-label={t("Write in")}
              />
            </label>
            <Button onClick={make} disabled={making || !ready}>
              <FileText size={14} /> {making ? t("Writing…") : pack ? t("Make a new pack") : t("Create blog post & social captions")}
            </Button>
          </div>
        )}
      </Card>

      {!pack ? (
        <EmptyState title={t("No pack yet")} hint={t("Create one to get a blog post and ready-to-post captions from this video.")} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {t("Made {date}", { date: when(pack.created_at, true) })} · {pack.language === "hi" ? "हिन्दी" : "English"} · {pack.model}
            </span>
            <Button size="sm" variant="outline" onClick={saveMd} disabled={saving}>
              <Download size={14} /> {saving ? t("Downloading…") : t("Download .md")}
            </Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <div className="space-y-4 lg:col-span-2">
              {BLOCKS.map((b) => {
                const text = pack[b.key] ?? ""
                if (!text) return null
                return (
                  <Card key={b.key} className="p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-navy">{t(b.label)}</h3>
                      <Button size="sm" variant="outline" onClick={() => copy(text, b.label)} aria-label={t("Copy the {what}", { what: t(b.label) })}>
                        <Copy size={13} /> {t("Copy")}
                      </Button>
                    </div>
                    <pre
                      lang={pack.language}
                      className={`whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-700 ${b.tall ? "max-h-96 overflow-y-auto" : ""}`}
                    >
                      {text}
                    </pre>
                  </Card>
                )
              })}
            </div>
            <Card className="h-fit p-4">
              <h3 className="mb-2 text-sm font-bold text-navy">{t("Sources in the video")}</h3>
              {pack.citations.length === 0 ? (
                <p className="text-sm text-slate-500">{t("No timestamps were cited.")}</p>
              ) : (
                <ul className="space-y-2.5">
                  {pack.citations.map((c, i) => (
                    <li key={`${c.start_ms}-${i}`} className="text-sm">
                      <a
                        href={watchUrl(video.public_id, c.start_ms)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"
                      >
                        <span className="font-num">{clock(c.start_ms)}</span> {c.label && <span>· {c.label}</span>}
                        <ExternalLink size={11} aria-hidden="true" />
                      </a>
                      {c.text && <p className="text-xs leading-relaxed text-slate-600">{c.text}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
