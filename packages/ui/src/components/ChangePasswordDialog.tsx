import { useState } from "react"
import { Drawer, Field, PasswordField } from "./ui"
import { Button } from "./primitives"
import { useUiText } from "../text"

export function ChangePasswordDialog({
  open,
  onOpenChange,
  onSubmit,
  minLength = 6,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>
  minLength?: number
}) {
  const ui = useUiText()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function close() {
    setCurrent("")
    setNext("")
    setConfirm("")
    setError(null)
    onOpenChange(false)
  }

  async function submit() {
    if (!current) {
      setError(ui.t("password.enterCurrent"))
      return
    }
    if (next.length < minLength) {
      setError(ui.t("password.tooShort", { n: minLength }))
      return
    }
    if (next !== confirm) {
      setError(ui.t("password.mismatch"))
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSubmit(current, next)
      close()
    } catch (e: unknown) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || ui.t("password.failed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      title={ui.t("password.title")}
      width="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={close}>
            {ui.t("cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving ? ui.t("saving") : ui.t("password.title")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={ui.t("password.current")} required>
          <PasswordField
            value={current}
            autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
            }}
          />
        </Field>
        <Field label={ui.t("password.new")} required hint={ui.t("password.minHint", { n: minLength })}>
          <PasswordField
            value={next}
            autoComplete="new-password"
            onChange={(e) => setNext(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
            }}
          />
        </Field>
        <Field label={ui.t("password.confirm")} required>
          <PasswordField
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
            }}
          />
        </Field>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </Drawer>
  )
}
