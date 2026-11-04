import { Link } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { useAuthStore } from "@klygenixvideo/auth"
import { TV_VERSION, useMe } from "../lib/api"
import { LANG_OPTIONS, setLang, useLang, useT } from "../lib/i18n"
import { Phone } from "../components/Tiles"

const btn = "inline-block rounded-full px-10 py-4 text-2xl font-semibold"

function LanguageSwitch() {
  const lang = useLang()
  const t = useT()
  const qc = useQueryClient()
  return (
    <div className="mt-10">
      <h2 id="lang-title" className="text-3xl font-bold">{t("Language")}</h2>
      <div role="group" aria-labelledby="lang-title" className="mt-4 flex gap-6" data-focus-group>
        {LANG_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            lang={o.value}
            aria-pressed={lang === o.value}
            onClick={() => {
              if (lang === o.value) return
              setLang(o.value)
              qc.invalidateQueries()
            }}
            className={`${btn} ${lang === o.value ? "bg-ink text-bg" : "bg-panel-3 text-ink"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Profile() {
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const qc = useQueryClient()
  const me = useMe().data
  const t = useT()

  function signOut() {
    clearAuth()
    qc.clear()
  }

  return (
    <div className="safe-x max-w-[90rem]">
      <h1 className="text-5xl font-bold">{t("Profile and settings")}</h1>
      {user ? (
        <>
          <p className="mt-6 text-3xl font-semibold">{me?.profile?.display_name || user.name}</p>
          <p className="mt-1 text-2xl text-muted">{user.email}</p>
          {me && <p className="mt-4 text-2xl">{t("Plan:")} <strong>{me.plans.viewer.name}</strong></p>}
          <div className="mt-6 max-w-[70rem]">
            <Phone what={t("Premium, memberships and purchases are managed on the web.")} />
          </div>
          <div className="mt-8 flex gap-6" data-focus-group>
            <Link to="/feedback" state={{ from: "/profile" }} data-autofocus className={`${btn} bg-brand text-white`}>{t("Send feedback")}</Link>
            <button type="button" onClick={signOut} className={`${btn} bg-panel-3 text-ink`}>{t("Sign out")}</button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-6 max-w-[70rem] text-2xl leading-snug text-muted">
            {t("Sign in to see what you were watching, the channels you follow and your Premium benefits. You approve the sign-in on your phone — no typing a password on the TV.")}
          </p>
          <div className="mt-8 flex gap-6" data-focus-group>
            <Link to="/login" data-autofocus className={`${btn} bg-brand text-white`}>{t("Sign in with your phone")}</Link>
            <Link to="/feedback" state={{ from: "/profile" }} className={`${btn} bg-panel-3 text-ink`}>{t("Send feedback")}</Link>
          </div>
        </>
      )}
      <LanguageSwitch />
      <p className="mt-12 text-xl text-muted">{t("Klygenix Play for TV · version {v}", { v: TV_VERSION })}</p>
    </div>
  )
}
