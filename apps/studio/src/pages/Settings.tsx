import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import { Languages, Palette, UserRound, Users } from "lucide-react"
import { useAuthStore, useThemePreference } from "@klygenixvideo/auth"
import { Badge, Button, Card, PageHeader, THEMES, ThemeSheet, isThemeKey } from "@klygenixvideo/ui"
import { LanguagePicker } from "../components/LanguagePicker"
import TwoStep from "../components/TwoStep"
import { useT } from "../i18n"

function Section({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="mt-0.5 text-brand">{icon}</span>
        <div>
          <h2 className="text-sm font-bold text-navy">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}
        </div>
      </div>
      <div className="pl-8">{children}</div>
    </Card>
  )
}

export default function Settings() {
  const t = useT()
  const user = useAuthStore((s) => s.user)
  const theme = useThemePreference("studio")
  const [theming, setTheming] = useState(false)
  const [twoStep, setTwoStep] = useState(false)
  const themeLabel = t(THEMES.find((x) => x.key === theme.current)?.label ?? "Light")

  return (
    <div className="max-w-3xl space-y-4 pb-8">
      <PageHeader title={t("Settings")} subtitle={t("How the studio looks and reads for you.")} />

      <Section icon={<Languages size={18} />} title={t("Language")} hint={t("The studio menus are available in English and Hindi. Your channel's language is set on the Channel page.")}>
        <LanguagePicker onSaved={() => toast.success(t("Language saved"))} />
      </Section>

      <Section icon={<Palette size={18} />} title={t("Theme")} hint={t("Light, dark, or a coloured sidebar. Saved to your account.")}>
        <div className="flex items-center gap-3">
          <Badge color="slate">{themeLabel}</Badge>
          <Button variant="outline" size="sm" onClick={() => setTheming(true)}>{t("Choose a theme")}</Button>
        </div>
      </Section>

      <Section icon={<UserRound size={18} />} title={t("Your account")}>
        {user && (
          <div className="text-sm">
            <p className="font-semibold text-navy">{user.name}</p>
            <p className="text-slate-500">{user.email}</p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setTwoStep(true)}>
            {t("Two-step sign-in")} {user?.totp_enabled ? t("(on)") : ""}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">{t("Change your password from the account menu at the top right.")}</p>
      </Section>

      <Section icon={<Users size={18} />} title={t("Team members")} hint={t("Invite editors and managers to help run your channel.")}>
        <div className="flex items-center gap-2">
          <Badge color="amber">{t("Coming soon")}</Badge>
          <span className="text-sm text-slate-500">{t("For now, only the channel owner can sign in to the studio.")}</span>
        </div>
      </Section>

      <ThemeSheet
        open={theming}
        onClose={() => setTheming(false)}
        app="studio"
        accent="#A21CAF"
        value={isThemeKey(theme.current) ? theme.current : undefined}
        saving={theme.saving}
        onSelect={(key) => theme.save(key).catch(() => toast.error(t("Could not save the theme")))}
      />
      <TwoStep open={twoStep} onClose={() => setTwoStep(false)} />
    </div>
  )
}
