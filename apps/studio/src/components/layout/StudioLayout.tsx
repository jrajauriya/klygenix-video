import { useEffect, useMemo, useState } from "react"
import { Link, Navigate, Outlet, useLocation } from "react-router-dom"
import {
  AppShell, ChangePasswordDialog, Header, KlygenixIcon, KlygenixWordmark, Sidebar, Spinner, ThemeSheet, isThemeKey,
} from "@klygenixvideo/ui"
import { api, useAuthStore, useLogout, useThemePreference } from "@klygenixvideo/auth"
import { useHasFeature, usePermissions } from "@klygenixvideo/client"
import { toast } from "sonner"
import { Ban, ExternalLink, KeyRound, ShieldCheck, Upload } from "lucide-react"
import type { NavItem, NavSection } from "@klygenixvideo/ui"
import { sections, topLinks } from "./nav"
import TwoStep from "../TwoStep"
import { FeedbackButton } from "../FeedbackButton"
import { LanguagePicker } from "../LanguagePicker"
import { NotificationBell } from "./NotificationBell"
import { useChannel } from "../../lib/hooks"
import { channelUrl } from "../../lib/format"
import { roleLabel, switchChannel, teamLevel, useActing, useHasPermission, useMyChannels, useTeamMe } from "../../lib/team"
import { ChannelSwitcher } from "../team/ChannelSwitcher"
import { useHtmlLang, useT } from "../../i18n"

const OPEN_WITHOUT_CHANNEL = ["/welcome", "/settings", "/billing", "/moderation", "/team/accept"]
const OPEN_PREFIXES = ["/brand", "/sponsorships/deals/"]

export function StudioLayout() {
  const { token, user } = useAuthStore()
  const logout = useLogout()
  const location = useLocation()
  const perms = usePermissions()
  const features = useHasFeature
  const liveOn = useHasFeature("video.live")
  const t = useT()
  useHtmlLang()
  const [changing, setChanging] = useState(false)
  const [twoStep, setTwoStep] = useState(false)
  const [theming, setTheming] = useState(false)
  const [resending, setResending] = useState(false)
  const theme = useThemePreference("studio")
  const { data: channel, isLoading: channelLoading } = useChannel()
  const acting = useActing()
  const { data: teamMe } = useTeamMe()
  const { data: myChannels, isLoading: channelsLoading } = useMyChannels()
  const canUpload = useHasPermission("video.uploads", "full")
  const firstTeam = myChannels?.find((c) => c.role !== "owner")
  const adopt = channel === null && acting === null && Boolean(firstTeam) && !OPEN_WITHOUT_CHANNEL.includes(location.pathname)

  useEffect(() => {
    if (adopt && firstTeam) switchChannel(firstTeam.tenant_id, location.pathname + location.search)
  }, [adopt, firstTeam, location.pathname, location.search])

  const localTop = useMemo(() => topLinks.map((i) => ({ ...i, label: t(i.label) })), [t])
  const localSections = useMemo<NavSection[]>(
    () => sections.map((s) => ({ ...s, label: t(s.label), items: s.items.map((i) => ({ ...i, label: t(i.label) })) })),
    [t],
  )

  if (!token || !user) {
    const returnUrl = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?returnUrl=${returnUrl}`} replace />
  }

  const openPath = OPEN_WITHOUT_CHANNEL.includes(location.pathname) || OPEN_PREFIXES.some((p) => location.pathname.startsWith(p))
  if (adopt || (channel === null && acting === null && channelsLoading && !openPath)) return <Spinner />
  const needsChannel = channel === null && !openPath
  if (needsChannel) return <Navigate to="/welcome" replace />

  const canSee = (item: NavItem) => {
    if (item.featureKey === "video.live" && !liveOn) return false
    if (acting !== null) return Boolean(item.permissionKey) && teamLevel(teamMe, item.permissionKey!) !== "none"
    if (item.featureKey && !features(item.featureKey)) return false
    if (!item.permissionKey) return true
    if (user.role === "owner" || user.role === "global_admin") return true
    return (perms[item.permissionKey] ?? "none") !== "none"
  }

  const menuButton = "flex w-full items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50"

  return (
    <AppShell
      storageKey="kv-studio"
      sidebar={(s) => (
        <Sidebar
          logo={<KlygenixWordmark />}
          glyph={<KlygenixIcon />}
          title={t("Studio")}
          topLinks={localTop}
          sections={localSections}
          canSee={canSee}
          storageKey="kv-studio"
          {...s}
        />
      )}
      header={({ onMenu }) => (
        <Header
          onMenu={onMenu}
          title={t("Klygenix Play Studio")}
          right={
            <>
            <ChannelSwitcher />
            <FeedbackButton app="studio" label={t("Feedback")} />
            <NotificationBell />
            {channel && (
              <>
                <a
                  href={channelUrl(channel.handle)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-brand hover:text-brand sm:flex"
                >
                  <ExternalLink size={15} /> {t("View channel")}
                </a>
                {canUpload && <Link
                  to="/videos?upload=1"
                  className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-hover"
                >
                  <Upload size={15} /> <span className="hidden sm:inline">{t("Upload")}</span>
                </Link>}
              </>
            )}
            </>
          }
          user={{
            name: user.name,
            email: user.email,
            roleLabel: acting !== null && teamMe ? t("{role} on {channel}", { role: t(roleLabel(teamMe.role)), channel: teamMe.channel?.name ?? "" }) : t(user.role.replace(/_/g, " ")),
            onLogout: logout,
            onTheme: () => setTheming(true),
            extra: (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                  <span className="text-sm font-medium text-slate-600">{t("Language")}</span>
                  <LanguagePicker compact onSaved={() => toast.success(t("Language saved"))} />
                </div>
                <button onClick={() => setChanging(true)} className={menuButton}>
                  <KeyRound size={16} /> {t("Change password")}
                </button>
                <button onClick={() => setTwoStep(true)} className={menuButton}>
                  <ShieldCheck size={16} /> {t("Two-step sign-in")} {user.totp_enabled ? t("(on)") : ""}
                </button>
              </>
            ),
          }}
        />
      )}
    >
      {channel?.is_suspended && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <Ban size={18} className="mt-0.5 shrink-0 text-red-600" />
          <p className="min-w-0 flex-1">
            {t("Your channel is suspended. Your videos are hidden until the suspension is lifted. See moderation notices for details.")}{" "}
            <Link to="/moderation" className="font-medium underline">{t("Moderation")}</Link>
          </p>
        </div>
      )}
      {user.email_verified === false && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span>{t("Confirm your email address. The link is in your inbox.")}</span>
          <button
            className="font-medium underline disabled:opacity-50"
            disabled={resending}
            onClick={async () => {
              setResending(true)
              try {
                const { data } = await api.post("/api/auth/verify/resend")
                toast.success(data.message ?? t("Link sent"))
              } catch (err: any) {
                toast.error(err?.response?.data?.detail ?? t("The link could not be sent"))
              } finally {
                setResending(false)
              }
            }}
          >
            {t("Send the link again")}
          </button>
        </div>
      )}
      {user.must_enrol_totp && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <span>{t("Your organisation requires two-step sign-in. Set it up to carry on working.")}</span>
          <button className="font-medium underline" onClick={() => setTwoStep(true)}>{t("Set it up now")}</button>
        </div>
      )}
      {channelLoading ? <Spinner /> : <Outlet />}
      <TwoStep open={twoStep} onClose={() => setTwoStep(false)} />
      <ThemeSheet
        open={theming}
        onClose={() => setTheming(false)}
        app="studio"
        accent="#A21CAF"
        value={isThemeKey(theme.current) ? theme.current : undefined}
        saving={theme.saving}
        onSelect={(key) => theme.save(key).catch(() => toast.error(t("Could not save the theme")))}
      />
      <ChangePasswordDialog
        open={changing}
        onOpenChange={setChanging}
        onSubmit={async (currentPassword, newPassword) => {
          await api.post("/api/auth/change-password", { current_password: currentPassword, new_password: newPassword })
          toast.success(t("Password changed"))
        }}
      />
    </AppShell>
  )
}
