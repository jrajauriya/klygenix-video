import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { FileDown } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, DataTable, Field, Input, PageHeader, SectionHeading, Spinner, StatCard, downloadFile } from "@klygenixvideo/ui"
import { VIDEO_ADMIN, humanise, num, reasonLabel, when } from "../lib/shared"
import { thisMonth } from "../components/money/shared"

interface Report {
  month: string
  generated_at: string
  notices: { kind: string; received: number; resolved: number; resolved_in_time: number; acknowledged_in_time: number }[]
  user_reports: { reason: string; received: number; resolved: number }[]
  actions: { target_type: string; action: string; automated: number; by_moderators: number }[]
  appeals: { status: string; count: number }[]
  notices_open_at_month_end: number
}

const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((n, r) => n + pick(r), 0)

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—")

export default function ComplianceReport() {
  const navigate = useNavigate()
  const [month, setMonth] = useState(thisMonth())
  const valid = /^\d{4}-\d{2}$/.test(month)
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-compliance-report", month],
    queryFn: async () => (await api.get<Report>(`${VIDEO_ADMIN}/compliance/report`, { params: { month } })).data,
    enabled: valid,
  })

  const received = data ? sum(data.notices, (r) => r.received) : 0
  const inTime = data ? sum(data.notices, (r) => r.resolved_in_time) : 0
  const ackInTime = data ? sum(data.notices, (r) => r.acknowledged_in_time) : 0
  const reports = data ? sum(data.user_reports, (r) => r.received) : 0

  return (
    <>
      <PageHeader
        title="Compliance report"
        subtitle="Monthly IT Rules grievance and moderation figures, in IST"
        onBack={() => navigate("/takedowns")}
        actions={
          <div className="flex items-end gap-2">
            <Field label="Month" className="w-44">
              <Input type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Button
              variant="outline"
              disabled={!valid}
              onClick={() => downloadFile(`${VIDEO_ADMIN}/compliance/report?month=${month}&format=csv`, `it-rules-report-${month}.csv`)}
            >
              <FileDown size={14} /> CSV
            </Button>
          </div>
        }
      />
      {!valid ? (
        <p className="text-sm text-slate-500">Pick a month.</p>
      ) : isLoading ? (
        <Spinner />
      ) : isError || !data ? (
        <p className="text-sm text-red-700">The report could not be loaded.</p>
      ) : (
        <div className="space-y-5 pb-8">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard size="sm" label="Notices received" value={num(received)} accent="navy" />
            <StatCard size="sm" label="Acknowledged in time" value={pct(ackInTime, received)} accent="blue" />
            <StatCard size="sm" label="Resolved in time" value={pct(inTime, received)} accent="green" />
            <StatCard size="sm" label="Open at month end" value={num(data.notices_open_at_month_end)} accent={data.notices_open_at_month_end ? "amber" : "green"} />
            <StatCard size="sm" label="User reports" value={num(reports)} accent="brand" />
          </div>
          <p className="text-xs text-slate-500">Generated {when(data.generated_at, true)}.</p>

          <section>
            <SectionHeading>Legal notices</SectionHeading>
            <DataTable
              label="Legal notices by kind"
              rows={data.notices}
              rowKey={(r) => r.kind}
              unitLabel="kinds"
              emptyTitle="No notices this month"
              columns={[
                { key: "kind", header: "Kind", render: (r) => humanise(r.kind) },
                { key: "received", header: "Received", align: "right", render: (r) => <span className="font-num">{num(r.received)}</span> },
                { key: "resolved", header: "Resolved", align: "right", render: (r) => <span className="font-num">{num(r.resolved)}</span> },
                { key: "ack", header: "Acknowledged in time", align: "right", render: (r) => <span className="font-num">{num(r.acknowledged_in_time)}</span> },
                { key: "time", header: "Resolved in time", align: "right", render: (r) => <span className="font-num">{num(r.resolved_in_time)}</span> },
              ]}
            />
          </section>

          <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <section>
              <SectionHeading>User reports</SectionHeading>
              <DataTable
                label="User reports by reason"
                rows={data.user_reports}
                rowKey={(r) => r.reason}
                unitLabel="reasons"
                emptyTitle="No reports this month"
                columns={[
                  { key: "reason", header: "Reason", render: (r) => reasonLabel(r.reason) },
                  { key: "received", header: "Received", align: "right", render: (r) => <span className="font-num">{num(r.received)}</span> },
                  { key: "resolved", header: "Resolved", align: "right", render: (r) => <span className="font-num">{num(r.resolved)}</span> },
                ]}
              />
            </section>
            <section>
              <SectionHeading>Appeals</SectionHeading>
              <Card className="p-4">
                {data.appeals.length === 0 ? (
                  <p className="text-sm text-slate-500">No appeals this month.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.appeals.map((a) => (
                      <li key={a.status} className="flex justify-between py-2 text-sm">
                        <span className="text-slate-700">{humanise(a.status)}</span>
                        <span className="font-num font-semibold text-navy">{num(a.count)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>
          </div>

          <section>
            <SectionHeading>Moderation actions</SectionHeading>
            <DataTable
              label="Moderation actions"
              rows={data.actions}
              rowKey={(r) => `${r.target_type}:${r.action}`}
              unitLabel="rows"
              emptyTitle="No actions this month"
              columns={[
                { key: "target", header: "Target", render: (r) => humanise(r.target_type) },
                { key: "action", header: "Action", render: (r) => humanise(r.action) },
                { key: "auto", header: "Automated", align: "right", render: (r) => <span className="font-num">{num(r.automated)}</span> },
                { key: "mods", header: "By moderators", align: "right", render: (r) => <span className="font-num">{num(r.by_moderators)}</span> },
              ]}
            />
          </section>
        </div>
      )}
    </>
  )
}
