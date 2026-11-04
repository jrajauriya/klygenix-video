import {
  BarChart3, Building2, CalendarDays, Clapperboard, FileText, Handshake, Megaphone, CreditCard, LayoutDashboard, MessageSquareText, MonitorPlay,
  PlaySquare, Radio, Settings, ShieldAlert, Sparkles, Tv, UserCog, Users, Wallet,
} from "lucide-react"
import type { NavItem, NavSection } from "@klygenixvideo/ui"

export const topLinks: NavItem[] = []

export const sections: NavSection[] = [
  {
    key: "create",
    label: "Create",
    icon: Sparkles,
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, featureKey: "video.dashboard", permissionKey: "video.dashboard" },
      { to: "/videos", label: "Videos", icon: PlaySquare, featureKey: "video.uploads", permissionKey: "video.uploads" },
      { to: "/calendar", label: "Calendar", icon: CalendarDays, featureKey: "video.uploads", permissionKey: "video.uploads" },
      { to: "/live", label: "Live", icon: Radio, featureKey: "video.live", permissionKey: "video.live" },
      { to: "/clips", label: "Clip maker", icon: Clapperboard, featureKey: "video.clips", permissionKey: "video.clips" },
      { to: "/channel", label: "Channel", icon: Tv, featureKey: "video.channels", permissionKey: "video.channels" },
    ],
  },
  {
    key: "audience",
    label: "Audience",
    icon: Users,
    items: [
      { to: "/comments", label: "Comments & danmaku", icon: MessageSquareText, featureKey: "video.comments", permissionKey: "video.comments" },
      { to: "/community", label: "Community", icon: Megaphone, featureKey: "video.channels", permissionKey: "video.channels" },
      { to: "/analytics", label: "Analytics", icon: BarChart3, featureKey: "video.analytics", permissionKey: "video.analytics" },
    ],
  },
  {
    key: "brand",
    label: "Brand",
    icon: Building2,
    items: [
      { to: "/brand", label: "Brand profile", icon: Building2, featureKey: "video.brand", permissionKey: "video.brand" },
      { to: "/brand/campaigns", label: "Ad campaigns", icon: MonitorPlay, featureKey: "video.brand", permissionKey: "video.brand" },
      { to: "/brand/briefs", label: "Sponsorship briefs", icon: FileText, featureKey: "video.brand", permissionKey: "video.brand" },
      { to: "/brand/deals", label: "Brand deals", icon: Handshake, featureKey: "video.brand", permissionKey: "video.brand" },
    ],
  },
  {
    key: "account",
    label: "Account",
    icon: UserCog,
    items: [
      { to: "/earnings", label: "Earnings", icon: Wallet, featureKey: "video.earnings", permissionKey: "video.earnings" },
      { to: "/sponsorships", label: "Sponsorships", icon: Handshake, featureKey: "video.sponsorships", permissionKey: "video.sponsorships" },
      { to: "/billing", label: "Billing", icon: CreditCard, featureKey: "video.billing", permissionKey: "video.billing" },
      { to: "/moderation", label: "Moderation", icon: ShieldAlert, featureKey: "video.dashboard", permissionKey: "video.dashboard" },
      { to: "/settings", label: "Settings", icon: Settings, featureKey: "video.settings", permissionKey: "video.settings" },
    ],
  },
]
