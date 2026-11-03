import { Bot, Building2, Film, Gavel, Layers, LayoutDashboard, Mail, Rocket, ScrollText, Settings, ShieldAlert, ShieldCheck } from "lucide-react"
import type { NavItem, NavSection } from "@klygenixvideo/ui"

export const topLinks: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, permissionKey: "admin.dashboard" },
]

export const sections: NavSection[] = [
  {
    key: "trust",
    label: "Trust and safety",
    icon: ShieldAlert,
    items: [
      { to: "/moderation", label: "Moderation", icon: ShieldAlert, permissionKey: "admin.moderation" },
      { to: "/takedowns", label: "Takedowns", icon: Gavel, permissionKey: "admin.takedowns" },
      { to: "/videos", label: "Videos", icon: Film, permissionKey: "admin.moderation" },
    ],
  },
  {
    key: "platform",
    label: "Platform",
    icon: Building2,
    items: [
      { to: "/tenants", label: "Accounts", icon: Building2, permissionKey: "admin.tenants" },
      { to: "/plans", label: "Plans", icon: Layers, permissionKey: "admin.plans" },
      { to: "/ai-usage", label: "AI usage", icon: Bot, permissionKey: "admin.ai_usage" },
      { to: "/logs", label: "Activity Log", icon: ScrollText, permissionKey: "admin.logs" },
    ],
  },
  {
    key: "config",
    label: "Configuration",
    icon: Mail,
    items: [{ to: "/email", label: "Email Config", icon: Mail, permissionKey: "admin.email" }],
  },
  {
    key: "admin",
    label: "Administration",
    icon: ShieldCheck,
    items: [
      { to: "/users", label: "Users & Roles", icon: ShieldCheck, permissionKey: "admin.team" },
      { to: "/readiness", label: "Launch readiness", icon: Rocket, permissionKey: "admin.settings" },
      { to: "/settings", label: "Settings", icon: Settings, permissionKey: "admin.settings" },
    ],
  },
]
