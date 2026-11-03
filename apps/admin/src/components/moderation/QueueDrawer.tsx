import { useQuery } from "@tanstack/react-query"
import { api } from "@klygenixvideo/auth"
import { Badge, Drawer, SectionHeading, Spinner } from "@klygenixvideo/ui"
import { REPORT_STATUS, Status, VIDEO_ADMIN, humanise, reasonLabel, relative, useCanAct, when } from "../../lib/shared"
import type { QueueItem, ReportRow } from "../../lib/types"
import { ActionForm } from "./ActionForm"
import { TargetPreview } from "./TargetPreview"

export function QueueDrawer({ item, onClose, onActed }: { item: QueueItem | null; onClose: () => void; onActed: () => void }) {
  const canAct = useCanAct("admin.moderation")
  const { data: reports = [], isLoading } = useQuery<ReportRow[]>({
    queryKey: ["admin-video-reports", item?.target_type, item?.target_id],
    queryFn: async () =>
      (await api.get(`${VIDEO_ADMIN}/reports`, {
        params: { target_type: item?.target_type, target_id: item?.target_id },
      })).data,
    enabled: Boolean(item),
  })

  if (!item) return null

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={`${humanise(item.target_type)} #${item.target_id}`}
      subtitle={item.why === "held" ? `Held by the scan ${relative(item.since)}` : `First reported ${relative(item.since)}`}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-1.5">
          <Badge color={item.why === "held" ? "amber" : "red"}>{item.why === "held" ? "Held" : "Reported"}</Badge>
          {item.labels.map((l) => (
            <Badge key={l} color="slate">
              {reasonLabel(l)}
            </Badge>
          ))}
        </div>

        <section>
          <SectionHeading>What was flagged</SectionHeading>
          <div className="mt-2">
            <TargetPreview type={item.target_type} id={item.target_id} target={item.target} />
          </div>
        </section>

        <section>
          <SectionHeading>Reports ({reports.length})</SectionHeading>
          {isLoading ? (
            <Spinner />
          ) : reports.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No reports — held by the automatic scan.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {reports.map((r) => (
                <li key={r.id} className="px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-navy">{reasonLabel(r.reason)}</span>
                    <Status map={REPORT_STATUS} status={r.status} />
                  </div>
                  {r.details && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{r.details}</p>}
                  <p className="mt-1 text-xs text-slate-400">{when(r.created_at, true)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionHeading>Decision</SectionHeading>
          <div className="mt-2">
            {canAct ? (
              <ActionForm targetType={item.target_type} targetId={item.target_id} onDone={onActed} />
            ) : (
              <p className="text-sm text-slate-500">You can view the queue but not act on it.</p>
            )}
          </div>
        </section>
      </div>
    </Drawer>
  )
}
