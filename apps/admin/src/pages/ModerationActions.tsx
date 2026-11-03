import { useState } from "react"
import { Drawer, DataTable, PageHeader } from "@klygenixvideo/ui"
import { usePagedList } from "@klygenixvideo/client"
import { ACTION_TONE, Row, Status, VIDEO_ADMIN, humanise, when } from "../lib/shared"
import type { ActionRow } from "../lib/types"
import { ModerationTabs } from "../components/moderation/ModerationTabs"

export default function ModerationActions() {
  const [open, setOpen] = useState<ActionRow | null>(null)
  const list = usePagedList<ActionRow>("admin-video-actions", `${VIDEO_ADMIN}/actions`, {}, 50)

  return (
    <>
      <PageHeader title="Moderation" subtitle="Every decision taken, newest first" />
      <ModerationTabs active="/moderation/actions" />
      <DataTable
        label="Actions log"
        loading={list.isLoading}
        rows={list.rows}
        rowKey={(r) => r.id}
        serverTotal={list.total}
        onServerPage={list.onServerPage}
        pageSize={list.pageSize}
        pageSizeOptions={[25, 50, 100, 200]}
        unitLabel="actions"
        emptyTitle="No actions yet"
        emptyDescription="Decisions from the queue, appeals and takedowns are logged here."
        onRowClick={(r) => setOpen(r)}
        columns={[
          { key: "when", header: "When", render: (r) => when(r.created_at, true) },
          { key: "action", header: "Action", render: (r) => <Status map={ACTION_TONE} status={r.action} /> },
          { key: "target", header: "Target", render: (r) => `${humanise(r.target_type)} #${r.target_id}` },
          { key: "reason", header: "Reason", render: (r) => <span className="line-clamp-1 max-w-md text-slate-600">{r.reason}</span> },
          { key: "actor", header: "By", render: (r) => (r.actor_user_id ? `User #${r.actor_user_id}` : "System") },
        ]}
      />
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open ? `Action #${open.id}` : ""}>
        {open && (
          <dl className="grid grid-cols-2 gap-4">
            <Row label="Action" value={<Status map={ACTION_TONE} status={open.action} />} />
            <Row label="When" value={when(open.created_at, true)} />
            <Row label="Target" value={`${humanise(open.target_type)} #${open.target_id}`} />
            <Row label="By" value={open.actor_user_id ? `User #${open.actor_user_id}` : "System"} />
            <Row label="Reason" value={open.reason} wide />
          </dl>
        )}
      </Drawer>
    </>
  )
}
