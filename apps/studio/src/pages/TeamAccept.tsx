import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertTriangle, Check, MailWarning, Users } from "lucide-react"
import { api, useAuthStore } from "@klygenixvideo/auth"
import { Button, Card, Spinner } from "@klygenixvideo/ui"
import { ROLE_INFO, roleLabel, switchChannel } from "../lib/team"
import { detail, status, when } from "../lib/format"
import { Initial } from "../components/team/ChannelSwitcher"
import { useT } from "../i18n"

interface InvitePreview {
  channel: { name: string; handle: string } | null
  role: string
  inviter: string | null
  expires_at: string | null
  for_you: boolean
}

function Problem({ title, body }: { title: string; body: string }) {
  const t = useT()
  return (
    <Card className="mx-auto mt-10 max-w-lg p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700">
        <AlertTriangle size={22} aria-hidden="true" />
      </div>
      <h1 className="text-base font-bold text-navy">{title}</h1>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
      <Link to="/" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">{t("Go to your studio")}</Link>
    </Card>
  )
}

export default function TeamAccept() {
  const t = useT()
  const [params] = useSearchParams()
  const token = (params.get("token") ?? "").trim()
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ["studio-team-invite", token],
    queryFn: async () => (await api.get<InvitePreview>("/api/video/team/invite", { params: { token } })).data,
    enabled: token.length >= 10,
    retry: false,
  })

  if (token.length < 10) {
    return <Problem title={t("This link is incomplete")} body={t("Open the link from the invitation email again, or ask for a new invitation.")} />
  }
  if (isLoading) return <Spinner />
  if (error || !data) {
    const code = status(error)
    if (code === 404) return <Problem title={t("Invitation not found")} body={t("It does not exist or was withdrawn. Ask the channel for a new one.")} />
    if (code === 410) return <Problem title={t("Invitation expired")} body={t("Invitations last a few days. Ask the channel for a new one.")} />
    return <Problem title={t("The invitation could not be opened")} body={detail(error, t("Try again in a moment."))} />
  }

  const channelName = data.channel?.name ?? t("this channel")
  const role = t(roleLabel(data.role))

  async function accept() {
    setBusy(true)
    setRefused(null)
    try {
      const { data: res } = await api.post<{ tenant_id: number; role: string }>("/api/video/team/accept", { token })
      toast.success(t("You joined {channel} as {role}", { channel: channelName, role }))
      switchChannel(res.tenant_id)
    } catch (err) {
      const code = status(err)
      setRefused(
        code === 404 ? t("This invitation does not exist or was withdrawn.")
          : code === 410 ? t("This invitation has expired. Ask for a new one.")
          : code === 403 ? t("This invitation was sent to another email address.")
          : detail(err, t("The invitation could not be accepted")),
      )
      setBusy(false)
    }
  }

  function switchAccount() {
    const back = encodeURIComponent(`/team/accept?token=${token}`)
    clearAuth()
    window.location.href = `/login?returnUrl=${back}`
  }

  return (
    <Card className="mx-auto mt-10 max-w-lg p-6">
      <div className="flex items-center gap-3">
        <Initial name={channelName} className="h-12 w-12 text-lg" />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Users size={13} aria-hidden="true" /> {t("Team invitation")}
          </p>
          <h1 className="truncate text-lg font-bold text-navy">{t("Join {channel}", { channel: channelName })}</h1>
          {data.channel && <p className="text-sm text-slate-500">@{data.channel.handle}</p>}
        </div>
      </div>

      <div className="mt-5 space-y-2 text-sm text-slate-700">
        <p>
          {data.inviter
            ? t("{inviter} invited you to help run this channel as {role}.", { inviter: data.inviter, role })
            : t("You were invited to help run this channel as {role}.", { role })}
        </p>
        {ROLE_INFO[data.role] && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
            <span className="font-semibold text-navy">{role}:</span> {t(ROLE_INFO[data.role].what)}
          </p>
        )}
        <p className="text-slate-600">{t("You keep your own account and your own channel. Switch between channels from the studio header.")}</p>
        {data.expires_at && <p className="text-xs text-slate-500">{t("The invitation expires {when}.", { when: when(data.expires_at, true) })}</p>}
      </div>

      {!data.for_you && (
        <div role="alert" className="mt-4 flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <MailWarning size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            {t("This invitation was sent to a different email address, not {email}. Sign in with the address it was sent to, or ask for a new invitation.", { email: user?.email ?? "" })}
          </p>
        </div>
      )}

      {refused && <p role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{refused}</p>}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {data.for_you ? (
          <>
            <Link to="/" className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:text-navy">{t("Not now")}</Link>
            <Button onClick={accept} disabled={busy}>
              <Check size={15} /> {busy ? t("Joining…") : t("Accept and join")}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={switchAccount}>{t("Sign in with another account")}</Button>
        )}
      </div>
    </Card>
  )
}
