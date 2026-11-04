import { useEffect, useState } from "react"
import { Badge, DataTable, Drawer, Input, PageHeader, SectionHeading } from "@klygenixvideo/ui"
import { usePagedList } from "@klygenixvideo/client"
import { Row, VIDEO_ADMIN, humanise, relative, when } from "../../lib/shared"

interface Mail {
  id: number
  template: string
  language: string
  to: string
  subject: string
  body_text: string
  body_html: string
  provider: string
  status: string
  error: string | null
  created_at: string
}

const tone = (s: string) => (s === "sent" || s === "captured" ? "green" : s === "failed" ? "red" : "slate")

export default function Outbox() {
  const [to, setTo] = useState("")
  const [template, setTemplate] = useState("")
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<Mail | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setFilters(Object.fromEntries(Object.entries({ to: to.trim().toLowerCase(), template: template.trim() }).filter(([, v]) => v))), 350)
    return () => clearTimeout(t)
  }, [to, template])

  const list = usePagedList<Mail>("admin-beta-outbox", `${VIDEO_ADMIN}/beta/outbox`, filters, 50)

  return (
    <>
      <PageHeader title="Email outbox" subtitle="Every email the platform sent or tried to send, newest first" />
      <DataTable
        label="Email outbox"
        loading={list.isLoading}
        rows={list.rows}
        rowKey={(r) => r.id}
        serverTotal={list.total}
        onServerPage={list.onServerPage}
        pageSize={list.pageSize}
        pageSizeOptions={[50, 100, 200]}
        unitLabel="emails"
        emptyTitle="No emails"
        onRowClick={(r) => setOpen(r)}
        toolbarRight={
          <div className="flex flex-wrap gap-2">
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Exact recipient email" aria-label="Recipient" className="w-56" />
            <Input value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="Template, like invite" aria-label="Template" className="w-44" />
          </div>
        }
        columns={[
          {
            key: "subject",
            header: "Email",
            render: (r) => (
              <span className="block min-w-0">
                <span className="block max-w-md truncate font-medium text-navy">{r.subject}</span>
                <span className="block truncate text-xs text-slate-500">{r.to}</span>
              </span>
            ),
          },
          { key: "template", header: "Template", render: (r) => <span className="font-num text-xs">{r.template}</span> },
          { key: "lang", header: "Language", render: (r) => r.language.toUpperCase() },
          { key: "status", header: "Status", render: (r) => <Badge color={tone(r.status)}>{humanise(r.status)}</Badge> },
          { key: "provider", header: "Provider", render: (r) => <span className="text-slate-500">{r.provider}</span> },
          { key: "when", header: "Sent", render: (r) => <span className="text-slate-500">{relative(r.created_at)}</span> },
        ]}
      />
      {open && (
        <Drawer open onClose={() => setOpen(null)} width="lg" title={open.subject} subtitle={`To ${open.to} · ${when(open.created_at, true)}`}>
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-4">
              <Row label="Template" value={open.template} />
              <Row label="Language" value={open.language.toUpperCase()} />
              <Row label="Provider" value={open.provider} />
              <Row label="Status" value={humanise(open.status)} />
              {open.error && <Row label="Error" value={open.error} wide />}
            </dl>
            <section>
              <SectionHeading>Text version</SectionHeading>
              <pre className="whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-4 font-sans text-sm text-slate-800">{open.body_text}</pre>
              <p className="mt-2 text-xs text-slate-500">The HTML version is not rendered here; it carries the same words.</p>
            </section>
          </div>
        </Drawer>
      )}
    </>
  )
}
