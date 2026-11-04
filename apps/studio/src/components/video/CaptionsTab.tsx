import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Download, Upload } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, Field, FileDropzone, Select, downloadFile } from "@klygenixvideo/ui"
import { MULTIPART, STUDIO } from "../../lib/hooks"
import { LANGUAGES, detail, languageName } from "../../lib/format"
import type { StudioVideoDetail } from "../../lib/types"
import { useT } from "../../i18n"

const SOURCES: Record<string, { label: string; color: "brand" | "green" | "blue" | "purple" | "slate" }> = {
  creator: { label: "Uploaded by you", color: "green" },
  ai: { label: "Speech-to-text", color: "purple" },
  translation: { label: "Machine translation", color: "blue" },
  youtube: { label: "From YouTube", color: "slate" },
}

export function CaptionsTab({ video }: { video: StudioVideoDetail }) {
  const t = useT()
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [language, setLanguage] = useState(video.language || "en")
  const [busy, setBusy] = useState(false)

  const available = video.captions?.available ?? []
  const translatable = video.captions?.translatable ?? []
  const sourceOf = (lang: string) => video.captions?.sources.find((s) => s.language === lang)?.source
  const isLive = video.status === "published" && video.visibility !== "private"

  async function upload() {
    if (!file) return
    const body = new FormData()
    body.append("file", file)
    body.append("language", language)
    setBusy(true)
    try {
      const { data } = await api.post<{ cues: number; language: string }>(`${STUDIO}/videos/${video.id}/captions`, body, MULTIPART)
      toast.success(t("{n} caption lines received. The transcript and AI drafts update in a minute or two.", { n: data.cues }))
      setFile(null)
      qc.invalidateQueries({ queryKey: ["studio-video", String(video.id)] })
      qc.invalidateQueries({ queryKey: ["studio-transcript", video.id] })
    } catch (err) {
      toast.error(detail(err, t("That caption file could not be read")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-bold text-navy">{t("Upload captions")}</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {t("WebVTT (.vtt) or SubRip (.srt). Your captions replace the automatic transcript in that language and feed the summary, chapters, search and clip ideas.")}
          </p>
        </div>
        {video.source === "embed" && (
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-slate-700">
            {t("This video plays from {platform}. We never download it, so AI features work only from captions you upload here.", { platform: video.embed_platform === "bilibili" ? "Bilibili" : "YouTube" })}
          </p>
        )}
        <FileDropzone
          accept=".vtt,.srt,text/vtt,application/x-subrip"
          maxSizeMB={5}
          file={file}
          onFileSelect={setFile}
          onRemove={() => setFile(null)}
          title={t("Drop a .vtt or .srt file, or click to choose")}
          hint={t("Up to 5 MB")}
        />
        <Field label={t("Language of these captions")}>
          <Select value={language} onChange={setLanguage} options={LANGUAGES} />
        </Field>
        <div className="flex justify-end">
          <Button onClick={upload} disabled={!file || busy}>
            <Upload size={14} /> {busy ? t("Uploading…") : t("Upload captions")}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="mb-3 text-sm font-bold text-navy">{t("Caption languages")}</h3>
        {!isLive && available.length > 0 && (
          <p className="mb-2 text-xs text-slate-500">{t("Viewers see these once the video is published.")}</p>
        )}
        {available.length === 0 ? (
          <p className="text-sm text-slate-500">{t("No captions yet.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {available.map((lang) => (
              <li key={lang} className="flex items-center justify-between gap-2 py-2">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{languageName(lang)}</span>
                  {sourceOf(lang) && (
                    <Badge color={SOURCES[sourceOf(lang)!]?.color ?? "slate"}>{SOURCES[sourceOf(lang)!] ? t(SOURCES[sourceOf(lang)!].label) : sourceOf(lang)}</Badge>
                  )}
                </span>
                <Button size="sm" variant="ghost"
                  onClick={() => downloadFile(`/api/video/videos/${video.public_id}/captions/${lang}.vtt`, `${video.public_id}-${lang}.vtt`)}>
                  <Download size={13} /> .vtt
                </Button>
              </li>
            ))}
          </ul>
        )}
        {translatable.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold text-slate-500">{t("Viewers can also turn on machine translation into")}</p>
            <div className="flex flex-wrap gap-1.5">
              {translatable.map((l) => <Badge key={l} color="slate">{languageName(l)}</Badge>)}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
