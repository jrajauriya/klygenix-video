import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Check, Plus } from "lucide-react"
import { Btn } from "./bits"
import { errText, loginPath, useSignedIn } from "../lib/api"

export function FollowButton({ handle, following, onChange, size = "md", className }: { handle: string; following: boolean; onChange?: (following: boolean) => void; size?: "sm" | "md"; className?: string }) {
  const signedIn = useSignedIn()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [on, setOn] = useState(following)
  const [pending, setPending] = useState(false)
  const [seen, setSeen] = useState(following)
  if (seen !== following) {
    setSeen(following)
    setOn(following)
  }

  async function toggle() {
    if (!signedIn) {
      navigate(loginPath())
      return
    }
    const next = !on
    setOn(next)
    setPending(true)
    try {
      if (next) await api.post(`/api/video/channels/${handle}/follow`)
      else await api.delete(`/api/video/channels/${handle}/follow`)
      onChange?.(next)
      qc.invalidateQueries({ queryKey: ["following"] })
      qc.invalidateQueries({ queryKey: ["channel", handle] })
    } catch (err) {
      setOn(!next)
      toast.error(errText(err, "That did not work. Try again."))
    } finally {
      setPending(false)
    }
  }

  return (
    <Btn tone={on ? "soft" : "light"} size={size} onClick={toggle} disabled={pending} aria-pressed={on} className={className}>
      {on ? <Check size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
      {on ? "Following" : "Follow"}
    </Btn>
  )
}
