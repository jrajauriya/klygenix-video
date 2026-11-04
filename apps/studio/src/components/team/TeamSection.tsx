import { useCallback, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ChevronDown, ChevronUp, RotateCcw, Save, Trash2, UserPlus } from "lucide-react"
import { api, useAuthStore } from "@klygenixvideo/auth"
import { Badge, Button, Field, Input, RoleEditor, Select, Spinner, useConfirm, type AccessActions } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { detail, when } from "../../lib/format"
import { ROLE_INFO, TEAM_ROLES, roleLabel, useActing, useHasPermission, useTeamMe } from "../../lib/team"
import { Initial } from "./ChannelSwitcher"
import { useT } from "../../i18n"

interface Member {
  id: number
  email: string
  name: string | null
  role: string
  status: "invited" | "active"
  invited_at: string | null
  accepted_at: string | null
  expires_at: string | null
}

interface TeamOut {
  members: Member[]
  limit: number
  roles: string[]
  owner_only: string[]
}

const KEY = ["studio-team"]

export function TeamSection() {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const me = useAuthStore((s) => s.user)
  const acting = useActing()
  const { data: teamMe } = useTeamMe()
  const canManage = useHasPermission("video.users", "full") && (acting === null || teamMe?.role === "manager")
  const { data, isLoading, isError } = useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<TeamOut>(`${STUDIO}/team`)).data,
  })
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<string>("editor")
  const [busy, setBusy] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [matrix, setMatrix] = useState(false)
  const [actions, setActions] = useState<AccessActions | null>(null)
  const onActions = useCallback((a: AccessActions) => setActions(a), [])

  const roles = (data?.roles?.length ? data.roles : [...TEAM_ROLES]).map((r) => ({ value: r, label: t(roleLabel(r)) }))
  const used = data?.members.length ?? 0
  const full = Boolean(data && used >= data.limit)
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  async function invite() {
    setBusy("invite")
    setRefused(null)
    try {
      const { data: m } = await api.post<Member>(`${STUDIO}/team/invites`, { email: email.trim(), role })
      toast.success(t("Invitation sent to {email}", { email: m.email }))
      setEmail("")
      qc.invalidateQueries({ queryKey: KEY })
    } catch (err) {
      setRefused(detail(err, t("The invitation could not be sent")))
    } finally {
      setBusy(null)
    }
  }

  async function changeRole(m: Member, next: string) {
    if (next === m.role) return
    setBusy(`role-${m.id}`)
    try {
      await api.patch(`${STUDIO}/team/${m.id}`, { role: next })
      toast.success(t("{name} is now {role}", { name: m.name || m.email, role: t(roleLabel(next)) }))
      qc.invalidateQueries({ queryKey: KEY })
    } catch (err) {
      toast.error(detail(err, t("The role could not be changed")))
    } finally {
      setBusy(null)
    }
  }

  async function remove(m: Member) {
    const invited = m.status === "invited"
    const ok = await confirm({
      title: invited ? t("Withdraw the invitation to {email}?", { email: m.email }) : t("Remove {name} from the team?", { name: m.name || m.email }),
      message: invited
        ? t("The link in their email stops working. You can invite them again later.")
        : t("They lose access to this channel's studio straight away. Their own account and channel are not affected."),
      confirmLabel: invited ? t("Withdraw") : t("Remove"),
      variant: "destructive",
    })
    if (!ok) return
    setBusy(`off-${m.id}`)
    try {
      await api.delete(`${STUDIO}/team/${m.id}`)
      toast.success(invited ? t("Invitation withdrawn") : t("Removed from the team"))
      qc.invalidateQueries({ queryKey: KEY })
    } catch (err) {
      toast.error(detail(err, t("Could not remove them")))
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <Spinner />
  if (isError || !data) return <p className="text-sm text-slate-500">{t("The team could not be loaded. Try again in a moment.")}</p>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={full ? "amber" : "slate"}>{t("{used} of {limit} seats used", { used, limit: data.limit })}</Badge>
        {full && acting === null && (
          <span className="text-sm text-slate-600">
            {t("All seats are in use.")} <Link to="/billing" className="font-semibold text-brand hover:underline">{t("Upgrade for more seats")}</Link>
          </span>
        )}
      </div>

      {canManage && (
        <div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("Email address")} className="min-w-48 flex-1">
              <Input type="email" value={email} maxLength={200} autoComplete="off" placeholder="name@example.com"
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && validEmail && !full) invite() }} />
            </Field>
            <Field label={t("Role")} className="w-40">
              <Select value={role} onChange={setRole} options={roles} aria-label={t("Role")} />
            </Field>
            <Button onClick={invite} disabled={busy !== null || !validEmail || full}>
              <UserPlus size={14} /> {busy === "invite" ? t("Sending…") : t("Invite")}
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">{t("They get an email with a link. Invitations expire after a few days.")}</p>
          {refused && <p role="alert" className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{refused}</p>}
        </div>
      )}

      {data.members.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
          {t("No one else is on this channel's team yet.")}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {data.members.map((m) => {
            const self = m.email.toLowerCase() === me?.email?.toLowerCase()
            const expired = m.status === "invited" && m.expires_at !== null && new Date(m.expires_at).getTime() < Date.now()
            const who = m.name || m.email
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <Initial name={who} className="h-8 w-8 text-sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-800">
                    <span className="truncate">{who}</span>
                    {self && <span className="text-xs font-normal text-slate-500">({t("you")})</span>}
                    {m.status === "active" ? (
                      <Badge color="green">{t("Active")}</Badge>
                    ) : expired ? (
                      <Badge color="red">{t("Invitation expired")}</Badge>
                    ) : (
                      <Badge color="amber">{t("Invited")}</Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {m.name ? `${m.email} · ` : ""}
                    {m.status === "active"
                      ? t("joined {when}", { when: when(m.accepted_at) })
                      : m.expires_at
                        ? t("invited {when} · expires {expires}", { when: when(m.invited_at), expires: when(m.expires_at, true) })
                        : t("invited {when}", { when: when(m.invited_at) })}
                  </p>
                </div>
                {canManage && !self ? (
                  <>
                    <Select value={m.role} onChange={(v) => changeRole(m, v)} options={roles} className="w-36"
                      disabled={busy !== null} aria-label={t("Role for {name}", { name: who })} />
                    <Button size="icon" variant="ghost" className="text-red-700" disabled={busy !== null}
                      aria-label={m.status === "invited" ? t("Withdraw the invitation to {email}", { email: m.email }) : t("Remove {name}", { name: who })}
                      onClick={() => remove(m)}>
                      <Trash2 size={15} />
                    </Button>
                  </>
                ) : (
                  <Badge color="slate">{t(roleLabel(m.role))}</Badge>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("What each role can do")}</h3>
        <dl className="grid gap-2 sm:grid-cols-2">
          {TEAM_ROLES.map((r) => (
            <div key={r} className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-sm font-semibold text-navy">{t(roleLabel(r))}</dt>
              <dd className="text-xs text-slate-600">{t(ROLE_INFO[r].what)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-slate-500">{t("Earnings, payouts and billing stay with you, the owner, whatever the role.")}</p>
      </div>

      {acting === null && canManage && (
        <div className="border-t border-slate-100 pt-4">
          <button type="button" aria-expanded={matrix} onClick={() => setMatrix((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
            {matrix ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
            {t("Fine-tune screen access for each role")}
          </button>
          {matrix && (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-600">{t("Click a cell to cycle between Hidden, View and Full. Money screens stay owner-only for team roles.")}</p>
              <RoleEditor app="video" canEdit onActions={onActions} />
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => actions?.reset()} disabled={!actions || actions.saving}>
                  <RotateCcw size={14} /> {t("Reset to defaults")}
                </Button>
                <Button size="sm" onClick={() => actions?.save()} disabled={!actions?.dirty || actions.saving}>
                  <Save size={14} /> {actions?.saving ? t("Saving…") : t("Save screen access")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
