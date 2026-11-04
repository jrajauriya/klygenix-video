import { Link } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { useAuthStore } from "@klygenixvideo/auth"
import { TV_VERSION, useMe } from "../lib/api"
import { Phone } from "../components/Tiles"

const btn = "inline-block rounded-full px-10 py-4 text-2xl font-semibold"

export default function Profile() {
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const qc = useQueryClient()
  const me = useMe().data

  function signOut() {
    clearAuth()
    qc.clear()
  }

  return (
    <div className="safe-x max-w-[90rem]">
      <h1 className="text-5xl font-bold">Profile and settings</h1>
      {user ? (
        <>
          <p className="mt-6 text-3xl font-semibold">{me?.profile?.display_name || user.name}</p>
          <p className="mt-1 text-2xl text-muted">{user.email}</p>
          {me && <p className="mt-4 text-2xl">Plan: <strong>{me.plans.viewer.name}</strong></p>}
          <div className="mt-6 max-w-[70rem]">
            <Phone what="Premium, memberships and purchases are managed on the web." />
          </div>
          <div className="mt-8 flex gap-6" data-focus-group>
            <Link to="/feedback" state={{ from: "/profile" }} data-autofocus className={`${btn} bg-brand text-white`}>Send feedback</Link>
            <button type="button" onClick={signOut} className={`${btn} bg-panel-3 text-ink`}>Sign out</button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-6 max-w-[70rem] text-2xl leading-snug text-muted">
            Sign in to see what you were watching, the channels you follow and your Premium benefits. You approve the sign-in on your phone — no typing a password on the TV.
          </p>
          <div className="mt-8 flex gap-6" data-focus-group>
            <Link to="/login" data-autofocus className={`${btn} bg-brand text-white`}>Sign in with your phone</Link>
            <Link to="/feedback" state={{ from: "/profile" }} className={`${btn} bg-panel-3 text-ink`}>Send feedback</Link>
          </div>
        </>
      )}
      <p className="mt-12 text-xl text-muted">Klygenix Play for TV · version {TV_VERSION}</p>
    </div>
  )
}
