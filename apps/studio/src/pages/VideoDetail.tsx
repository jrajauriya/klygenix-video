import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ExternalLink } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { formatMoney, useHasFeature } from "@klygenixvideo/client"
import { useHasPermission } from "../lib/team"
import { Badge, EmptyState, ListPage, PageHeader, Spinner, Tabs } from "@klygenixvideo/ui"
import { STUDIO } from "../lib/hooks"
import { watchUrl } from "../lib/format"
import type { StudioVideoDetail } from "../lib/types"
import { AiStatusBadge, KindBadge, VideoStatusPill } from "../components/StatusChips"
import { DetailsTab } from "../components/video/DetailsTab"
import { TranscriptTab } from "../components/video/TranscriptTab"
import { CaptionsTab } from "../components/video/CaptionsTab"
import { ClipsTab } from "../components/video/ClipsTab"
import { CommentsPanel } from "../components/video/CommentsPanel"
import { AnalyticsTab } from "../components/video/AnalyticsTab"
import { MonetisationTab } from "../components/video/MonetisationTab"
import { ProductsTab } from "../components/video/ProductsTab"
import { DubbingTab } from "../components/video/DubbingTab"
import { ChaptersTab } from "../components/video/ChaptersTab"
import { RepurposeTab } from "../components/video/RepurposeTab"
import { useT } from "../i18n"

const TABS = [
  { key: "details", label: "Details" },
  { key: "chapters", label: "Chapters" },
  { key: "transcript", label: "Transcript" },
  { key: "captions", label: "Captions" },
  { key: "clips", label: "Clips" },
  { key: "comments", label: "Comments" },
  { key: "analytics", label: "Analytics" },
  { key: "products", label: "Product links" },
  { key: "dubbing", label: "Dubbing" },
  { key: "repurpose", label: "Repurpose" },
]

const MONEY_TAB = { key: "monetisation", label: "Monetisation" }

const BUSY = ["uploading", "processing", "scanning"]

export default function VideoDetail() {
  const t = useT()
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const moneyOn = useHasFeature("video.earnings")
  const moneyAllowed = useHasPermission("video.earnings")
  const money = moneyOn && moneyAllowed
  const tabs = money ? [...TABS, MONEY_TAB] : TABS
  const tab = tabs.some((x) => x.key === params.get("tab")) ? params.get("tab")! : "details"

  const { data: video, isLoading, isError } = useQuery({
    queryKey: ["studio-video", id],
    queryFn: async () => (await api.get<StudioVideoDetail>(`${STUDIO}/videos/${id}`)).data,
    refetchInterval: (q) => {
      const v = q.state.data
      return v && (BUSY.includes(v.status) || v.ai_status === "running" || v.ai_status === "pending") ? 4000 : false
    },
  })

  if (isLoading) return <Spinner />
  if (isError || !video) {
    return <EmptyState title={t("This video could not be found")} hint={t("It may have been deleted.")} />
  }

  const isLive = video.status === "published" && video.visibility !== "private"

  return (
    <ListPage>
      <PageHeader
        title={video.title}
        onBack={() => navigate("/videos")}
        actions={
          isLive ? (
            <a href={watchUrl(video.public_id)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-brand hover:text-brand">
              <ExternalLink size={14} /> {t("Watch page")}
            </a>
          ) : undefined
        }
      />
      <div className="-mt-1 mb-3 flex pl-10 flex-wrap items-center gap-2">
        <KindBadge kind={video.kind} />
        <VideoStatusPill video={video} />
        <AiStatusBadge value={video.ai_status} />
        {video.ai_generated && <Badge color="purple">{t("AI-generated")}</Badge>}
        {video.made_for_kids && <Badge color="blue">{t("Made for kids · no ads")}</Badge>}
        {video.access === "members" && <Badge color="purple">{t("Members only")}</Badge>}
        {video.access === "paid" && <Badge color="green">{t("Paid · {price}", { price: formatMoney(video.price_minor ?? null, "INR") })}</Badge>}
        {video.source === "embed" && <Badge color="blue">{t("Linked from {platform}", { platform: video.embed_platform === "bilibili" ? "Bilibili" : "YouTube" })}</Badge>}
      </div>
      {video.status_note && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{video.status_note}</p>
      )}
      <Tabs tabs={tabs.map((x) => ({ ...x, label: t(x.label) }))} active={tab} onChange={(k) => setParams({ tab: k }, { replace: true })} />
      <div className="pb-8 pt-4">
        {tab === "details" && <DetailsTab video={video} />}
        {tab === "chapters" && <ChaptersTab key={video.id} video={video} />}
        {tab === "transcript" && <TranscriptTab video={video} />}
        {tab === "captions" && <CaptionsTab video={video} />}
        {tab === "clips" && <ClipsTab video={video} />}
        {tab === "comments" && <CommentsPanel publicId={video.public_id} durationMs={video.duration_ms} />}
        {tab === "analytics" && <AnalyticsTab video={video} />}
        {tab === "products" && <ProductsTab video={video} />}
        {tab === "dubbing" && <DubbingTab video={video} />}
        {tab === "repurpose" && <RepurposeTab key={video.id} video={video} />}
        {tab === "monetisation" && <MonetisationTab key={video.id} video={video} />}
      </div>
    </ListPage>
  )
}
