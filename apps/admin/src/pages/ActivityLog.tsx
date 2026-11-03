import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import {
  Badge, Button, Card, DataTable, Field, Input, PageHeader, Select, StatCard,
} from "@klygenixvideo/ui"
import { formatDate } from "@klygenixvideo/client"
import { viewerZone } from "../lib/shared"

interface TenantRow {
  tenant_id: number
  name: string
  slug: string
  products: string[]
  is_active: boolean
  active_users: number
  total_users: number
  total_events: number
  logins: number
  last_activity_at: string | null
}

interface UserRow {
  user_id: number
  name: string
  email: string
  role: string
  is_active: boolean
  last_seen_at: string | null
  sessions: number
  creates: number
  updates: number
  deletes: number
  total_events: number
}

interface Summary {
  tenant_id: number
  tenant_name: string
  active_users: number
  total_events: number
  logins: number
  users: UserRow[]
}

interface Event {
  id: number
  occurred_at: string
  user_name: string | null
  app: string
  kind: string
  label: string
  method: string
  path: string
  status_code: number
  duration_ms: number | null
}

const KINDS = [
  { value: "all", label: "Everything" },
  { value: "login", label: "Sign-ins" },
  { value: "create", label: "Created" },
  { value: "update", label: "Changed" },
  { value: "delete", label: "Deleted" },
]

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function kindColor(kind: string) {
  if (kind === "delete") return "red"
  if (kind === "create") return "green"
  if (kind === "login") return "blue"
  return "slate"
}

/**
 * Who has been using what. The tenant list is the way in; picking one opens its people
 * and, under them, the events themselves.
 */
export default function ActivityLog() {
  const zone = viewerZone()
  const [from, setFrom] = useState(daysAgo(4))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [tenant, setTenant] = useState<TenantRow | null>(null)
  const [kind, setKind] = useState("all")
  const [userId, setUserId] = useState<number | null>(null)

  const window = `date_from=${from}&date_to=${to}`

  const { data: tenants = [], isLoading } = useQuery<TenantRow[]>({
    queryKey: ["admin-activity-tenants", from, to],
    queryFn: async () => (await api.get(`/api/admin/activity/tenants?${window}`)).data,
  })

  const { data: summary } = useQuery<Summary>({
    queryKey: ["admin-activity-users", tenant?.tenant_id, from, to],
    queryFn: async () =>
      (await api.get(`/api/admin/activity/tenants/${tenant?.tenant_id}/users?${window}`)).data,
    enabled: Boolean(tenant),
  })

  const { data: events = [] } = useQuery<Event[]>({
    queryKey: ["admin-activity-events", tenant?.tenant_id, from, to, kind, userId],
    queryFn: async () => {
      const params = new URLSearchParams(window)
      if (kind !== "all") params.set("kind", kind)
      if (userId !== null) params.set("user_id", String(userId))
      return (
        await api.get(`/api/admin/activity/tenants/${tenant?.tenant_id}/events?${params}`)
      ).data
    },
    enabled: Boolean(tenant),
  })

  const range = (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="From">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field label="To">
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
    </div>
  )

  if (!tenant) {
    return (
      <>
        <PageHeader
          title="Activity Log"
          subtitle="Every customer, and how much they have actually used the product"
        />
        <Card className="mb-4 p-4">{range}</Card>
        <DataTable<TenantRow>
          loading={isLoading}
          rows={tenants}
          rowKey={(r) => r.tenant_id}
          unitLabel="customers"
          emptyTitle="Nothing in this window"
          emptyDescription="Widen the dates, or wait for someone to sign in."
          onRowClick={(r) => setTenant(r)}
          columns={[
            {
              key: "name",
              header: "Customer",
              sortValue: (r) => r.name,
              render: (r) => (
                <div>
                  <b>{r.name}</b>
                  <span className="ml-2 text-xs text-slate-400">{r.slug}</span>
                </div>
              ),
            },
            {
              key: "users",
              header: "Users seen",
              align: "right",
              className: "font-num",
              sortValue: (r) => r.active_users,
              render: (r) => `${r.active_users} of ${r.total_users}`,
            },
            {
              key: "logins",
              header: "Sign-ins",
              align: "right",
              className: "font-num",
              sortValue: (r) => r.logins,
              render: (r) => r.logins,
            },
            {
              key: "total_events",
              header: "Events",
              align: "right",
              className: "font-num font-semibold",
              sortValue: (r) => r.total_events,
              render: (r) => r.total_events,
            },
            {
              key: "last",
              header: "Last seen",
              sortValue: (r) => r.last_activity_at ?? "",
              render: (r) =>
                r.last_activity_at ? (
                  formatDate(r.last_activity_at, zone, true)
                ) : (
                  <span className="text-slate-400">never</span>
                ),
            },
          ]}
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={tenant.name}
        subtitle="Who signed in, and what they did"
        actions={
          <Button variant="outline" onClick={() => { setTenant(null); setUserId(null) }}>
            <ArrowLeft size={16} /> All customers
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Users seen" value={String(summary?.active_users ?? 0)} size="sm" />
        <StatCard label="Sign-ins" value={String(summary?.logins ?? 0)} size="sm" />
        <StatCard label="Events" value={String(summary?.total_events ?? 0)} size="sm" />
      </div>

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        {range}
        <Field label="Showing">
          <Select value={kind} onChange={setKind} options={KINDS} />
        </Field>
        {userId !== null && (
          <Button variant="outline" onClick={() => setUserId(null)}>
            Everyone
          </Button>
        )}
      </Card>

      <DataTable<UserRow>
        rows={summary?.users ?? []}
        rowKey={(u) => u.user_id}
        unitLabel="users"
        emptyTitle="Nobody here yet"
        emptyDescription="This customer has users but none of them did anything in this window."
        onRowClick={(u) => setUserId(u.user_id)}
        columns={[
          {
            key: "name",
            header: "User",
            sortValue: (u) => u.name,
            render: (u) => (
              <div>
                <b>{u.name}</b>
                <span className="ml-2 text-xs text-slate-400">{u.email}</span>
              </div>
            ),
          },
          { key: "role", header: "Role", render: (u) => <Badge color="slate">{u.role}</Badge> },
          {
            key: "sessions",
            header: "Sign-ins",
            align: "right",
            className: "font-num",
            sortValue: (u) => u.sessions,
            render: (u) => u.sessions,
          },
          {
            key: "changes",
            header: "Created / changed / deleted",
            align: "right",
            className: "font-num",
            render: (u) => `${u.creates} / ${u.updates} / ${u.deletes}`,
          },
          {
            key: "last_seen",
            header: "Last seen",
            sortValue: (u) => u.last_seen_at ?? "",
            render: (u) =>
              u.last_seen_at ? formatDate(u.last_seen_at, zone, true) : <span className="text-slate-400">never</span>,
          },
        ]}
      />

      <div className="mt-6">
        <DataTable<Event>
          rows={events}
          rowKey={(e) => e.id}
          unitLabel="events"
          emptyTitle="No events"
          emptyDescription="Nothing was recorded for this customer in the window chosen."
          columns={[
            {
              key: "occurred_at",
              header: "When",
              sortValue: (e) => e.occurred_at,
              render: (e) => formatDate(e.occurred_at, zone, true),
            },
            { key: "user_name", header: "Who", render: (e) => e.user_name ?? "—" },
            {
              key: "kind",
              header: "What",
              render: (e) => <Badge color={kindColor(e.kind)}>{e.kind}</Badge>,
            },
            { key: "label", header: "Detail", render: (e) => e.label },
            {
              key: "status_code",
              header: "Result",
              align: "right",
              className: "font-num",
              render: (e) => (
                <span className={e.status_code >= 400 ? "text-red-600" : undefined}>
                  {e.status_code}
                </span>
              ),
            },
            {
              key: "duration_ms",
              header: "Took",
              align: "right",
              className: "font-num",
              render: (e) => (e.duration_ms === null ? "—" : `${e.duration_ms} ms`),
            },
          ]}
        />
      </div>
    </>
  )
}
