import {
  BarChart3, Clapperboard, Megaphone, CreditCard, LayoutDashboard, MessageSquareText, PlaySquare, Radio, Settings, ShieldAlert,
  Sparkles, Tv, UserCog, Users, Wallet,
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
    key: "account",
    label: "Account",
    icon: UserCog,
    items: [
      { to: "/earnings", label: "Earnings", icon: Wallet, featureKey: "video.earnings", permissionKey: "video.earnings" },
      { to: "/billing", label: "Billing", icon: CreditCard, featureKey: "video.billing", permissionKey: "video.billing" },
      { to: "/moderation", label: "Moderation", icon: ShieldAlert, featureKey: "video.dashboard", permissionKey: "video.dashboard" },
      { to: "/settings", label: "Settings", icon: Settings, featureKey: "video.settings", permissionKey: "video.settings" },
    ],
  },
]
