import type { ReactNode } from "react"
import { Lock, ShieldOff } from "lucide-react"
import { useSession } from "@klygenixvideo/auth"
import { useHasFeature } from "./features"
import { usePermissions, useHasPermission } from "./permissions"
import type { Level } from "./permissions"

interface Props {
  /** Per-tenant feature key — set by the global admin. */
  featureKey?: string
  /** Per-role permission key — set by the tenant owner. */
  permissionKey?: string
  level?: Level
  children: ReactNode
}

/**
 * Page-level guard stacking both access layers:
 *   Gate 1 (global admin): tenant_features  → is this menu unlocked for this customer?
 *   Gate 2 (tenant owner): role_permissions → can my role access it?
 *
 * Both must pass. The sidebar hides what these refuse, so a blocked screen is normally
 * unreachable — this catches the pasted URL.
 *
 * Unlike the master estate, this lives in a shared package and the admin console uses
 * it too. An app with its own copy is an app whose guard will drift.
 */
export function ProtectedRoute({ featureKey, permissionKey, level = "view", children }: Props) {
  // Asks the server whether this session is still good, and signs out if it is not.
  useSession()
  const featureOn = useHasFeature(featureKey)
  const perms = usePermissions()
  const allowed = useHasPermission(permissionKey, level)

  // Render nothing while permissions load, or the denial flashes before the answer arrives.
  if (permissionKey && Object.keys(perms).length === 0) return null

  if (featureKey && !featureOn) {
    return (
      <Denied
        icon={<Lock size={22} />}
        title="Not part of your plan"
        body="This screen is not enabled for your account. Your Klygenix administrator can turn it on."
      />
    )
  }

  if (!allowed) {
    return (
      <Denied
        icon={<ShieldOff size={22} />}
        title="You do not have access"
        body="Your role does not include this screen. Ask an owner to change it in Users & Roles."
      />
    )
  }

  return <>{children}</>
}

function Denied({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        {icon}
      </div>
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{body}</p>
    </div>
  )
}
