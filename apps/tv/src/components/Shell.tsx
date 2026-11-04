import { NavLink, Outlet } from "react-router-dom"
import { useAuthStore } from "@klygenixvideo/auth"
import { useSpatialNavigation } from "../lib/focus"

export function Frame() {
  useSpatialNavigation()
  return <Outlet />
}

const NAV = [
  { to: "/", label: "Home" },
  { to: "/search", label: "Search" },
  { to: "/profile", label: "Profile" },
]

export function Shell() {
  const user = useAuthStore((s) => s.user)
  return (
    <div className="min-h-screen bg-bg pb-16">
      <header className="safe-x flex items-center gap-12 pt-[3.375rem]">
        <p className="text-4xl font-extrabold tracking-tight">
          Klygenix <span className="text-brand-soft">Play</span>
        </p>
        <nav aria-label="Main" className="flex gap-4" data-focus-group>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `rounded-full px-8 py-3 text-2xl font-semibold ${isActive ? "bg-ink text-bg" : "text-ink hover:bg-panel-3"}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <p className="ml-auto text-xl text-muted">{user ? `Signed in as ${user.name || user.email}` : "Not signed in"}</p>
      </header>
      <main id="main" className="pt-10">
        <Outlet />
      </main>
    </div>
  )
}
