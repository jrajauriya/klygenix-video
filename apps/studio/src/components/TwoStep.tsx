import { useState } from "react"
import { toast } from "sonner"
import { Copy } from "lucide-react"
import { Button, Drawer, DrawerFooter, Field, Input } from "@klygenixvideo/ui"
import { api, useAuthStore } from "@klygenixvideo/auth"
import type { UserInfo } from "@klygenixvideo/types"
import { useT } from "../i18n"

function detail(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback
}

export default function TwoStep({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const { token, user, setAuth } = useAuthStore()
  const [secret, setSecret] = useState<{ secret: string; otpauth_url: string } | null>(null)
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [codes, setCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const enabled = Boolean(user?.totp_enabled)

  async function refresh() {
    if (!token) return
    try {
      const { data } = await api.get<UserInfo>("/api/auth/me")
      setAuth(token, data)
    } catch {
      return
    }
  }

  function close() {
    setSecret(null)
    setCode("")
    setPassword("")
    setCodes(null)
    onClose()
  }

  async function begin() {
    setBusy(true)
    try {
      setSecret((await api.post("/api/auth/totp/setup")).data)
    } catch (err) {
      toast.error(detail(err, t("Two-step sign-in could not be started.")))
    } finally {
      setBusy(false)
    }
  }

  async function enable() {
    setBusy(true)
    try {
      const { data } = await api.post<{ recovery_codes: string[] }>("/api/auth/totp/enable", { code })
      setCodes(data.recovery_codes)
      await refresh()
      toast.success(t("Two-step sign-in is on"))
    } catch (err) {
      toast.error(detail(err, t("That code is not right.")))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      await api.post("/api/auth/totp/disable", { password, code })
      await refresh()
      toast.success(t("Two-step sign-in is off"))
      close()
    } catch (err) {
      toast.error(detail(err, t("It could not be turned off.")))
    } finally {
      setBusy(false)
    }
  }

  const grouped = secret?.secret.match(/.{1,4}/g)?.join(" ") ?? ""

  return (
    <Drawer open={open} onClose={close} title={t("Two-step sign-in")} subtitle={t("A six-digit code from an authenticator app, as well as your password.")}>
      {codes ? (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">
            {t("Keep these recovery codes somewhere safe. Each one signs you in once if your phone is lost. They are shown now and never again.")}
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 font-num">
            {codes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(codes.join("\n"))
                toast.success(t("Codes copied"))
              } catch {
                toast.success(t("Codes ready"))
              }
            }}
          >
            <Copy size={14} /> {t("Copy the codes")}
          </Button>
        </div>
      ) : enabled ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t("It is on. To turn it off, confirm both your password and a current code.")}</p>
          <Field label={t("Password")}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={t("Code, or a recovery code")}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        </div>
      ) : secret ? (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">
            {t("Add this key to Google Authenticator, 1Password, Authy or any TOTP app, then type the code it shows.")}
          </p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center font-num text-base tracking-wider">{grouped}</div>
          <a href={secret.otpauth_url} className="block text-xs text-brand underline">
            {t("On a phone? Open it in your authenticator app directly")}
          </a>
          <Field label={t("Code from the app")}>
            <Input value={code} inputMode="numeric" onChange={(e) => setCode(e.target.value)} placeholder="123456" />
          </Field>
        </div>
      ) : (
        <p className="text-sm text-slate-600">
          {t("Once it is on, signing in asks for a code as well as your password, so a stolen password alone is not enough. You will get ten recovery codes in case the phone is lost.")}
        </p>
      )}

      <DrawerFooter
        onCancel={close}
        save={
          codes
            ? { label: t("Done"), onClick: close }
            : enabled
              ? { label: t("Turn it off"), pending: busy, disabled: !password || !code, onClick: disable }
              : secret
                ? { label: t("Turn it on"), pending: busy, disabled: code.trim().length < 6, onClick: enable }
                : { label: t("Set it up"), pending: busy, onClick: begin }
        }
      />
    </Drawer>
  )
}
