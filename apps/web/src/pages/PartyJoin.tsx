import { useEffect, useState } from "react"
import { Navigate, useNavigate, useParams } from "react-router-dom"
import { api } from "@klygenixvideo/auth"
import { loginPath, useSignedIn } from "../lib/api"
import { useTitle } from "../lib/title"
import NotFound from "./NotFound"
import { useT } from "../i18n"

export default function PartyJoin() {
  const { code = "" } = useParams()
  const clean = code.trim().toUpperCase()
  const signedIn = useSignedIn()
  const navigate = useNavigate()
  const [missing, setMissing] = useState(false)
  const t = useT("support")
  useTitle(t("Watch party"))

  useEffect(() => {
    if (!signedIn || !/^[A-Z0-9]{6}$/.test(clean)) return
    let live = true
    api.get<{ video_id: string; code: string }>(`/api/video/parties/${clean}`)
      .then(({ data }) => { if (live) navigate(`/watch/${data.video_id}?party=${data.code}`, { replace: true }) })
      .catch(() => { if (live) setMissing(true) })
    return () => { live = false }
  }, [clean, signedIn, navigate])

  if (!/^[A-Z0-9]{6}$/.test(clean) || missing) return <NotFound what="watch party" />
  if (!signedIn) return <Navigate to={loginPath(`/party/${clean}`)} replace />
  return <p className="p-10 text-center text-sm text-muted">{t("Joining the watch party…")}</p>
}
