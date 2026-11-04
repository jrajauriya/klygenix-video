import type { ReactNode } from "react"
import { ShieldOff } from "lucide-react"
import { useSession } from "@klygenixvideo/auth"
import { ProtectedRoute } from "@klygenixvideo/client"
import { Spinner } from "@klygenixvideo/ui"
import { roleLabel, teamLevel, useActing, useTeamMe } from "../../lib/team"
import { useT } from "../../i18n"

function TeamGate({ k, children }: { k: string; children: ReactNode }) {
  const t = useT()
  useSession()
  const { data: me, isLoading } = useTeamMe()
  if (isLoading || !me) return <Spinner />
  if (teamLevel(me, k) === "none") {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <ShieldOff size={22} aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold text-navy">{t("Not part of your role")}</h2>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          {t("As {role} on {channel}, this screen is not open to you. The channel owner decides what each role can do.", {
            role: t(roleLabel(me.role)),
            channel: me.channel?.name ?? "",
          })}
        </p>
      </div>
    )
  }
  return <>{children}</>
}

export function Guard({ k, children }: { k: string; children: ReactNode }) {
  const acting = useActing()
  if (acting !== null) return <TeamGate k={k}>{children}</TeamGate>
  return (
    <ProtectedRoute featureKey={k} permissionKey={k}>
      {children}
    </ProtectedRoute>
  )
}
