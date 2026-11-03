import { createBrowserRouter, useRouteError } from "react-router-dom"
import { Layout } from "./components/Layout"
import HomePage from "./pages/Home"
import NotFound from "./pages/NotFound"

function RouteError() {
  const error = useRouteError() as { status?: number } | undefined
  if (error?.status === 404) return <NotFound />
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">Reload the page to try again.</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white">Reload</button>
    </div>
  )
}

const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default })

export const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/reels", lazy: page(() => import("./pages/Reels")) },
      { path: "/reels/:id", lazy: page(() => import("./pages/Reels")) },
      { path: "/watch/:id", lazy: page(() => import("./pages/watch/WatchPage")) },
      { path: "/party/:code", lazy: page(() => import("./pages/PartyJoin")) },
      { path: "/playlist/:id", lazy: page(() => import("./pages/Playlist")) },
      { path: "/search", lazy: page(() => import("./pages/Search")) },
      { path: "/plans", lazy: page(() => import("./pages/Plans")) },
      { path: "/account", lazy: page(() => import("./pages/Account")) },
      { path: "/login", lazy: async () => ({ Component: (await import("./pages/Auth")).LoginPage }) },
      { path: "/signup", lazy: async () => ({ Component: (await import("./pages/Auth")).SignupPage }) },
      { path: "/legal/terms", lazy: async () => ({ Component: (await import("./pages/legal/Legal")).TermsPage }) },
      { path: "/legal/privacy", lazy: async () => ({ Component: (await import("./pages/legal/Legal")).PrivacyPage }) },
      { path: "/legal/guidelines", lazy: async () => ({ Component: (await import("./pages/legal/Legal")).GuidelinesPage }) },
      { path: "/legal/copyright", lazy: async () => ({ Component: (await import("./pages/legal/Legal")).CopyrightPage }) },
      { path: "/legal/grievance", lazy: async () => ({ Component: (await import("./pages/legal/Legal")).GrievancePage }) },
      { path: "/:channel", lazy: page(() => import("./pages/Channel")) },
      { path: "*", element: <NotFound /> },
    ],
  },
])
