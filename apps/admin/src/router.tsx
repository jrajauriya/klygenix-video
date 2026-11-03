import type { ReactNode } from "react"
import { createBrowserRouter } from "react-router-dom"
import { ProtectedRoute } from "@klygenixvideo/client"
import { AdminLayout } from "./components/layout/AdminLayout"
import Login from "./pages/Login"
import Dashboard from "./pages/Dashboard"
import Tenants from "./pages/Tenants"
import TenantDetail from "./pages/TenantDetail"
import ComingSoon from "./pages/ComingSoon"
import ActivityLog from "./pages/ActivityLog"
import AdminUsers from "./pages/AdminUsers"
import EmailConfigPage from "./pages/EmailConfig"
import Readiness from "./pages/Readiness"
import ModerationQueue from "./pages/ModerationQueue"
import ModerationActions from "./pages/ModerationActions"
import Appeals from "./pages/Appeals"
import Takedowns from "./pages/Takedowns"
import Videos from "./pages/Videos"
import AiUsage from "./pages/AiUsage"
import Plans from "./pages/Plans"
import Money from "./pages/Money"
import AuditLog from "./pages/AuditLog"
import FailedJobs from "./pages/FailedJobs"
import LiveStreams from "./pages/LiveStreams"

const gate = (key: string, el: ReactNode) => <ProtectedRoute permissionKey={key}>{el}</ProtectedRoute>

export const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    element: <AdminLayout />,
    children: [
      { path: "/", element: gate("admin.dashboard", <Dashboard />) },
      { path: "/moderation", element: gate("admin.moderation", <ModerationQueue />) },
      { path: "/moderation/actions", element: gate("admin.moderation", <ModerationActions />) },
      { path: "/moderation/appeals", element: gate("admin.moderation", <Appeals />) },
      { path: "/takedowns", element: gate("admin.takedowns", <Takedowns />) },
      { path: "/videos", element: gate("admin.moderation", <Videos />) },
      { path: "/live", element: gate("admin.moderation", <LiveStreams />) },
      { path: "/ai-usage", element: gate("admin.ai_usage", <AiUsage />) },
      { path: "/plans", element: gate("admin.plans", <Plans />) },
      { path: "/money", element: gate("admin.money", <Money />) },
      { path: "/tenants", element: gate("admin.tenants", <Tenants />) },
      { path: "/tenants/:tenantId", element: gate("admin.tenants", <TenantDetail />) },
      { path: "/logs", element: gate("admin.logs", <ActivityLog />) },
      { path: "/audit", element: gate("admin.logs", <AuditLog />) },
      { path: "/ops/failed", element: gate("admin.dashboard", <FailedJobs />) },
      { path: "/email", element: gate("admin.email", <EmailConfigPage />) },
      { path: "/users", element: gate("admin.team", <AdminUsers />) },
      { path: "/readiness", element: gate("admin.settings", <Readiness />) },
      { path: "/settings", element: gate("admin.settings", <ComingSoon title="Settings" />) },
      { path: "*", element: <ComingSoon title="Not found" /> },
    ],
  },
])
