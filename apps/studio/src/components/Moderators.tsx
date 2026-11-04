import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Trash2, UserPlus } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Drawer, Field, Input, Spinner, useConfirm } from "@klygenixvideo/ui"
import { useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../lib/hooks"
import { detail, when } from "../lib/format"
import type { Moderator } from "../lib/types"
import { useT } from "../i18n"

export function ModeratorsDrawer({ onClose }: { onClose: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canEdit = useHasPermission("video.comments", "full")
  const { data, isLoading } = useQuery({
    queryKey: ["studio-moderators"],
    queryFn: async () => (await api.get<Moderator[]>(`${STUDIO}/moderators`)).data,
  })
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    try {
      const { data: m } = await api.post<Moderator>(`${STUDIO}/moderators`, { email: email.trim() })
      toast.success(t("{name} can now moderate your channel", { name: m.name || m.email }))
      setEmail("")
      qc.invalidateQueries({ queryKey: ["studio-moderators"] })
    } catch (err) {
      toast.error(detail(err, t("Could not add them. They need a Klygenix Play account with this email.")))
    } finally {
      setBusy(false)
    }
  }

  async function remove(m: Moderator) {
    const ok = await confirm({ title: t("Remove {name}?", { name: m.name || m.email }), message: t("They can no longer hide anything on your channel."), confirmLabel: t("Remove"), variant: "destructive" })
    if (!ok) return
    try {
      await api.delete(`${STUDIO}/moderators/${m.id}`)
      toast.success(t("Moderator removed"))
      qc.invalidateQueries({ queryKey: ["studio-moderators"] })
    } catch (err) {
      toast.error(detail(err, t("Could not remove them")))
    }
  }

  return (
    <Drawer open onClose={onClose} title={t("Moderators")} subtitle={t("People who help keep your comments friendly.")}>
      <div className="space-y-5">
        <p className="rounded-lg bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700">
          {t("Moderators can hide comments, danmaku and community posts on this channel only, from the watch page. They cannot see your earnings, analytics or settings, and cannot change your videos.")}
        </p>
        {canEdit && (
          <div className="flex items-end gap-2">
            <Field label={t("Their email")} hint={t("They need a Klygenix Play account.")} className="min-w-0 flex-1">
              <Input type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && email.includes("@")) add() }} />
            </Field>
            <Button onClick={add} disabled={busy || !email.includes("@")} className="mb-5">
              <UserPlus size={14} /> {busy ? t("Adding…") : t("Add")}
            </Button>
          </div>
        )}
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <p className="text-sm text-slate-500">{t("No moderators yet.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {data.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{m.name || m.email}</p>
                  <p className="truncate text-xs text-slate-500">{t("{email} · added {when}", { email: m.email, when: when(m.added_at) })}</p>
                </div>
                {canEdit && (
                  <Button size="icon" variant="ghost" aria-label={t("Remove {name}", { name: m.name || m.email })} onClick={() => remove(m)}>
                    <Trash2 size={15} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  )
}
