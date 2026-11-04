import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { AppShell, Header, Sidebar, KlygenixIcon, KlygenixWordmark } from "@klygenixvideo/ui"
import { api, useAuthStore, useLogout } from "@klygenixvideo/auth"
import { usePermissions, roleLabel } from "@klygenixvideo/client"
import type { NavItem } from "@klygenixvideo/ui"
import { topLinks, sections } from "./nav"
import { VIDEO_ADMIN } from "../../lib/shared"
import { FeedbackButton } from "../feedback/FeedbackButton"

export function AdminLayout() {
  const { token, user } = useAuthStore()
  const logout = useLogout()
  const location = useLocation()
  const perms = usePermissions()
  const seesQueue =
    user?.role === "global_admin" || user?.role === "owner" || (perms["admin.moderation"] ?? "none") !== "none"
  const { data: waiting = 0 } = useQuery<number>({
    queryKey: ["admin-video-queue", "count"],
    queryFn: async () => {
      const res = await api.get(`${VIDEO_ADMIN}/queue`, { params: { limit: 1 } })
      return Number(res.headers?.["x-total-count"]) || 0
    },
    enabled: Boolean(token && user) && seesQueue,
    refetchInterval: 60_000,
  })

  if (!token || !user) {
    const returnUrl = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?returnUrl=${returnUrl}`} replace />
  }

  // The admin console is for Klygenix staff. Identify them by role and by the tenant
  // SLUG the backend was configured with — never by tenant_id === 1, which depends on
  // row insertion order and locks you out of a freshly built database.
  const isPlatformStaff =
    user.role === "global_admin" || user.role === "owner" || user.role === "admin"
  if (!isPlatformStaff) return <Navigate to="/login" replace />

  const canSee = (item: NavItem) => {
    if (!item.permissionKey) return true
    if (user.role === "global_admin" || user.role === "owner") return true
    return (perms[item.permissionKey] ?? "none") !== "none"
  }

  return (
    <AppShell
      storageKey="kv-admin"
      sidebar={(s) => (
        <Sidebar
          logo={<KlygenixWordmark />}
          glyph={<KlygenixIcon />}
          title="Admin"
          topLinks={topLinks}
          sections={sections}
          canSee={canSee}
          itemBadge={(item) =>
            item.to === "/moderation" && waiting > 0 ? (
              <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 font-num text-[11px] font-semibold leading-none text-amber-800">
                {waiting}
              </span>
            ) : null
          }
          storageKey="kv-admin"
          {...s}
        />
      )}
      header={({ onMenu }) => (
        <Header
          onMenu={onMenu}
          title="Admin Console"
          right={<FeedbackButton app="admin" />}
          user={{
            name: user.name,
            email: user.email,
            roleLabel: roleLabel(user.role),
            onLogout: logout,
          }}
        />
      )}
    >
      <Outlet />
    </AppShell>
  )
}
