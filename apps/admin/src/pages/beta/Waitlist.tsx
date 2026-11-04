import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Send } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select } from "@klygenixvideo/ui"
import { Status, VIDEO_ADMIN, detail, humanise, num, relative, useCanAct, type Tone } from "../../lib/shared"

interface Entry {
  id: number
  email: string
  name: string
  role: string
  country: string
  language: string
  note: string
  channel_url: string | null
  status: string
  created_at: string
  confirmed_at: string | null
  invited_at: string | null
}

const KEY = "admin-beta-waitlist"

const STATUS: Record<string, Tone> = {
  pending: { label: "Not confirmed", color: "slate" },
  confirmed: { label: "Confirmed", color: "blue" },
  invited: { label: "Invited", color: "purple" },
  joined: { label: "Joined", color: "green" },
  removed: { label: "Removed", color: "red" },
}

const STATUS_FILTER = [{ value: "", label: "Any status" }, ...Object.entries(STATUS).map(([value, t]) => ({ value, label: t.label }))]
const ROLE_FILTER = [
  { value: "", label: "Any role" },
  { value: "viewer", label: "Viewer" },
  { value: "creator", label: "Creator" },
  { value: "brand", label: "Brand" },
]

export default function Waitlist() {
  const qc = useQueryClient()
  const canAct = useCanAct("admin.beta")
  const [status, setStatus] = useState("")
  const [role, setRole] = useState("")
  const [q, setQ] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(100)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [inviting, setInviting] = useState(false)
  const [days, setDays] = useState("30")

  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => setPage(1), [status, role, search])

  const { data, isLoading } = useQuery({
    queryKey: [KEY, status, role, search, page, size],
    queryFn: async () => {
      const params = Object.fromEntries(Object.entries({ status, role, q: search }).filter(([, v]) => v))
      const res = await api.get<{ items: Entry[]; counts: Record<string, number> }>(`${VIDEO_ADMIN}/beta/waitlist`, {
        params: { ...params, limit: size, offset: (page - 1) * size },
      })
      return { ...res.data, total: Number(res.headers["x-total-count"] ?? res.data.items.length) }
    },
  })
  const rows = data?.items ?? []
  const invitable = rows.filter((r) => r.status === "pending" || r.status === "confirmed")
  const daysN = Number(days)

  const invite = useMutation({
    mutationFn: async () => (await api.post<{ invited: number }>(`${VIDEO_ADMIN}/beta/waitlist/invite`, { ids: [...picked], days: daysN })).data,
    onSuccess: (d) => {
      toast.success(`${d.invited} invite${d.invited === 1 ? "" : "s"} sent`)
      setPicked(new Set())
      setInviting(false)
      qc.invalidateQueries({ queryKey: [KEY] })
    },
    onError: (err) => toast.error(detail(err, "The invites could not be sent")),
  })

  function toggle(id: number, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const allPicked = invitable.length > 0 && invitable.every((r) => picked.has(r.id))

  return (
    <>
      <PageHeader title="Waitlist" subtitle="People waiting to join the beta. Pick them and send invite codes." />
      {data && (
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.entries(STATUS).map(([k, t]) => (
            <Badge key={k} color={t.color}>{t.label}: <span className="font-num">{num(data.counts[k] ?? 0)}</span></Badge>
          ))}
        </div>
      )}
      <DataTable
        label="Waitlist"
        loading={isLoading}
        rows={rows}
        rowKey={(r) => r.id}
        serverTotal={data?.total ?? 0}
        onServerPage={(p, s) => {
          setPage(p)
          setSize(s)
        }}
        pageSize={size}
        pageSizeOptions={[50, 100, 200, 500]}
        unitLabel="people"
        emptyTitle="Nobody on the waitlist"
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="Search by email"
        toolbarRight={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={status} onChange={setStatus} options={STATUS_FILTER} aria-label="Status" className="w-40" />
            <Select value={role} onChange={setRole} options={ROLE_FILTER} aria-label="Role" className="w-36" />
            {canAct && invitable.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setPicked(allPicked ? new Set() : new Set(invitable.map((r) => r.id)))}>
                {allPicked ? "Clear selection" : "Select page"}
              </Button>
            )}
            {canAct && (
              <Button size="sm" disabled={picked.size === 0} onClick={() => setInviting(true)}>
                <Send size={13} /> Invite {picked.size || ""}
              </Button>
            )}
          </div>
        }
        columns={[
          {
            key: "pick",
            header: "",
            srHeader: "Select",
            width: "2.5rem",
            render: (r) =>
              canAct && (r.status === "pending" || r.status === "confirmed") ? (
                <input
                  type="checkbox"
                  aria-label={`Select ${r.email}`}
                  checked={picked.has(r.id)}
                  onChange={(e) => toggle(r.id, e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-brand"
                />
              ) : null,
          },
          {
            key: "who",
            header: "Person",
            render: (r) => (
              <span className="block min-w-0">
                <span className="block truncate font-medium text-navy">{r.email}</span>
                <span className="block truncate text-xs text-slate-500">{r.name || "No name"} · {r.country} · {r.language.toUpperCase()}</span>
              </span>
            ),
          },
          { key: "role", header: "Role", render: (r) => humanise(r.role) },
          {
            key: "note",
            header: "Note",
            render: (r) => (
              <span className="block max-w-xs">
                {r.note && <span className="block truncate text-sm text-slate-600" title={r.note}>{r.note}</span>}
                {r.channel_url && (
                  <a href={r.channel_url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-brand hover:underline">{r.channel_url}</a>
                )}
              </span>
            ),
          },
          { key: "status", header: "Status", render: (r) => <Status map={STATUS} status={r.status} /> },
          { key: "joined", header: "Joined list", render: (r) => <span className="text-slate-500">{relative(r.created_at)}</span> },
          { key: "invited", header: "Invited", render: (r) => <span className="text-slate-500">{r.invited_at ? relative(r.invited_at) : "—"}</span> },
        ]}
      />
      <Modal
        open={inviting}
        onClose={() => setInviting(false)}
        size="sm"
        title={`Invite ${picked.size} ${picked.size === 1 ? "person" : "people"}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setInviting(false)} disabled={invite.isPending}>Cancel</Button>
            <Button onClick={() => invite.mutate()} disabled={invite.isPending || !Number.isInteger(daysN) || daysN < 1 || daysN > 365}>
              {invite.isPending ? "Sending…" : "Send invites"}
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          Each person gets a one-use code by email, in their language. Creators get a creator code that also opens a channel.
        </p>
        <Field label="Code valid for (days)" hint="1 to 365.">
          <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className="max-w-[8rem]" />
        </Field>
      </Modal>
    </>
  )
}
