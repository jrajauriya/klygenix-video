import { useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Search } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, DataTable, Input, PageHeader } from "@klygenixvideo/ui"
import { detail, relative } from "../../lib/shared"
import { SUPPORT, type SupportUser } from "./shared"

export function AccountBadges({ u }: { u: SupportUser }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {!u.is_active && <Badge color="red">Inactive</Badge>}
      {u.verified ? <Badge color="green">Verified</Badge> : <Badge color="amber">Not verified</Badge>}
      {u.two_step && <Badge color="blue">Two-step</Badge>}
      {u.channel?.suspended && <Badge color="red">Channel suspended</Badge>}
      {!!u.channel?.strikes && <Badge color="amber">{u.channel.strikes} strike{u.channel.strikes === 1 ? "" : "s"}</Badge>}
    </span>
  )
}

export default function SupportDesk() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = (params.get("q") ?? "").trim()
  const [text, setText] = useState(q)
  const { data: rows = [], isFetching, isError, error } = useQuery({
    queryKey: ["admin-support-lookup", q],
    queryFn: async () => (await api.get<SupportUser[]>(`${SUPPORT}/lookup`, { params: { q } })).data,
    enabled: q.length >= 2,
    retry: false,
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const next = text.trim()
    setParams(next ? { q: next } : {}, { replace: true })
  }

  return (
    <>
      <PageHeader title="Support desk" subtitle="Find an account, see what happened to it, and help without changing what the person sees" />
      <Card className="mb-4 p-4">
        <form onSubmit={submit} role="search" className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="support-q" className="label">Email, @handle, user id, order or payment id</label>
            <Input
              id="support-q"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="asha@demo.klygenix.com, @asha, 42, order_…, pay_…"
              autoComplete="off"
              minLength={2}
              maxLength={120}
              autoFocus
            />
          </div>
          <Button type="submit" disabled={text.trim().length < 2}>
            <Search size={14} /> Look up
          </Button>
        </form>
      </Card>
      {isError && <Card className="mb-4 p-4 text-sm text-red-700" role="alert">{detail(error, "The lookup failed")}</Card>}
      {q.length >= 2 && (
        <DataTable
          label="Matching accounts"
          loading={isFetching}
          rows={rows}
          rowKey={(r) => r.id}
          unitLabel="accounts"
          emptyTitle="No account matches"
          emptyDescription="Try the full email, the channel handle with @, or the payment id from the receipt."
          onRowClick={(r) => navigate(`/support/users/${r.id}`)}
          columns={[
            {
              key: "who",
              header: "Account",
              render: (r) => (
                <span className="block min-w-0">
                  <span className="block truncate font-medium text-navy">{r.name || r.email}</span>
                  <span className="block truncate text-xs text-slate-500">{r.email} · #{r.id}</span>
                </span>
              ),
            },
            {
              key: "channel",
              header: "Channel",
              render: (r) => (r.channel ? <span className="font-mono text-sm">@{r.channel.handle}</span> : <span className="text-slate-500">None</span>),
            },
            { key: "role", header: "Role", render: (r) => <span className="text-sm">{r.role}</span> },
            { key: "state", header: "State", render: (r) => <AccountBadges u={r} /> },
            { key: "last", header: "Last sign-in", render: (r) => <span className="text-slate-500">{r.last_login ? relative(r.last_login) : "Never"}</span> },
          ]}
        />
      )}
    </>
  )
}
