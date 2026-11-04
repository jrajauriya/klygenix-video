import {
  Bot, Building2, FileBarChart, FileClock, FlaskConical, Handshake, IndianRupee, Film, Gavel, Inbox, Layers, LayoutDashboard, Mail,
  MessageSquareText, MonitorPlay, Radio, Rocket, ScrollText, Settings, ShieldAlert, ShieldCheck, Sparkles, Ticket, TriangleAlert, Users,
} from "lucide-react"
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
      { to: "/takedowns/report", label: "Compliance report", icon: FileBarChart, permissionKey: "admin.takedowns" },
      { to: "/videos", label: "Videos", icon: Film, permissionKey: "admin.moderation" },
      { to: "/live", label: "Live streams", icon: Radio, permissionKey: "admin.moderation" },
    ],
  },
  {
    key: "growth",
    label: "Growth",
    icon: Sparkles,
    items: [
      { to: "/ads", label: "Advertising", icon: MonitorPlay, permissionKey: "admin.ads" },
      { to: "/sponsorships", label: "Sponsorships", icon: Handshake, permissionKey: "admin.sponsorships" },
      { to: "/reco", label: "Recommender", icon: FlaskConical, permissionKey: "admin.reco" },
    ],
  },
  {
    key: "beta",
    label: "Beta",
    icon: Users,
    items: [
      { to: "/beta", label: "Waitlist", icon: Users, permissionKey: "admin.beta" },
      { to: "/beta/codes", label: "Invite codes", icon: Ticket, permissionKey: "admin.beta" },
      { to: "/beta/outbox", label: "Email outbox", icon: Inbox, permissionKey: "admin.beta" },
      { to: "/beta/feedback", label: "Feedback", icon: MessageSquareText, permissionKey: "admin.beta" },
    ],
  },
  {
    key: "platform",
    label: "Platform",
    icon: Building2,
    items: [
      { to: "/tenants", label: "Accounts", icon: Building2, permissionKey: "admin.tenants" },
      { to: "/plans", label: "Plans", icon: Layers, permissionKey: "admin.plans" },
      { to: "/money", label: "Money", icon: IndianRupee, permissionKey: "admin.money" },
      { to: "/ai-usage", label: "AI usage", icon: Bot, permissionKey: "admin.ai_usage" },
      { to: "/logs", label: "Activity Log", icon: ScrollText, permissionKey: "admin.logs" },
      { to: "/audit", label: "Audit log", icon: FileClock, permissionKey: "admin.logs" },
      { to: "/ops/failed", label: "Failed jobs", icon: TriangleAlert, permissionKey: "admin.dashboard" },
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
