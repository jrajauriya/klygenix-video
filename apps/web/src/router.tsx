import { createBrowserRouter, useRouteError, type LoaderFunctionArgs } from "react-router-dom"
import { useAuthStore } from "@klygenixvideo/auth"
import { getJson } from "./lib/api"
import { reelsKey, reelsPage } from "./lib/reelsFeed"
import { queryClient } from "./lib/queryClient"
import { preloadHls, warmHls } from "@klygenixvideo/player/src/preload"
import { Layout } from "./components/Layout"
import HomePage from "./pages/Home"
import NotFound from "./pages/NotFound"
import { useT } from "./i18n"

function RouteError() {
  const error = useRouteError() as { status?: number } | undefined
  const t = useT()
  if (error?.status === 404) return <NotFound />
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-xl font-bold">{t("Something went wrong")}</h1>
      <p className="mt-2 text-sm text-muted">{t("Reload the page to try again.")}</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white">{t("Reload")}</button>
    </div>
  )
}

function prefetchVideo({ params }: LoaderFunctionArgs) {
  preloadHls()
  const signedIn = signedInNow()
  if (params.id) {
    const key = ["video", params.id, signedIn]
    void queryClient.prefetchQuery({ queryKey: key, queryFn: () => getJson(`/api/video/videos/${params.id}`) }).then(() => {
      const v = queryClient.getQueryData<{ playback?: { type?: string; url?: string } | null }>(key)
      if (v?.playback?.type === "hls") warmHls(v.playback.url)
    })
    void queryClient.prefetchQuery({ queryKey: ["ad-breaks", params.id, signedIn], queryFn: () => getJson(`/api/video/ads/breaks`, { video: params.id }), retry: false })
  }
  return null
}

function signedInNow() {
  const { token, user } = useAuthStore.getState()
  return Boolean(token && user)
}

function prefetchReels({ params, request }: LoaderFunctionArgs) {
  preloadHls()
  const signedIn = signedInNow()
  const start = params.id ?? new URL(request.url).searchParams.get("start")
  void queryClient.prefetchInfiniteQuery({ queryKey: reelsKey(signedIn), queryFn: reelsPage, initialPageParam: 0 }).then(() => {
    if (start) return
    const first = queryClient.getQueryData<{ pages: { rows: { playback?: { type?: string; url?: string } | null }[] }[] }>(reelsKey(signedIn))
    const pb = first?.pages[0]?.rows[0]?.playback
    if (pb?.type === "hls") warmHls(pb.url)
  })
  if (start) {
    const key = ["video", start, signedIn]
    void queryClient.prefetchQuery({ queryKey: key, queryFn: () => getJson(`/api/video/videos/${start}`) }).then(() => {
      const v = queryClient.getQueryData<{ playback?: { type?: string; url?: string } | null }>(key)
      if (v?.playback?.type === "hls") warmHls(v.playback.url)
    })
  }
  return null
}

const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default })

export const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/reels", loader: prefetchReels, lazy: page(() => import("./pages/Reels")) },
      { path: "/reels/:id", loader: prefetchReels, lazy: page(() => import("./pages/Reels")) },
      { path: "/watch/:id", loader: prefetchVideo, lazy: page(() => import("./pages/watch/WatchPage")) },
      { path: "/live/:publicId", loader: () => { preloadHls(); return null }, lazy: page(() => import("./pages/live/LivePage")) },
      { path: "/party/:code", lazy: page(() => import("./pages/PartyJoin")) },
      { path: "/playlist/:id", lazy: page(() => import("./pages/Playlist")) },
      { path: "/search", lazy: page(() => import("./pages/Search")) },
      { path: "/plans", lazy: page(() => import("./pages/Plans")) },
      { path: "/account", lazy: page(() => import("./pages/Account")) },
      { path: "/account/notices", lazy: page(() => import("./pages/CopyrightNotices")) },
      { path: "/notifications", lazy: page(() => import("./pages/Notifications")) },
      { path: "/subscriptions", lazy: page(() => import("./pages/Subscriptions")) },
      { path: "/activate", lazy: page(() => import("./pages/Activate")) },
      { path: "/brands", lazy: page(() => import("./pages/Brands")) },
      { path: "/waitlist", lazy: async () => ({ Component: (await import("./pages/Waitlist")).WaitlistPage }) },
      { path: "/waitlist/confirm", lazy: async () => ({ Component: (await import("./pages/Waitlist")).WaitlistConfirmPage }) },
      { path: "/login", lazy: async () => ({ Component: (await import("./pages/Auth")).LoginPage }) },
      { path: "/signup", lazy: async () => ({ Component: (await import("./pages/Auth")).SignupPage }) },
      { path: "/legal/terms", lazy: async () => ({ Component: (await import("./pages/legal/Legal")).TermsPage }) },
      { path: "/legal/privacy", lazy: async () => ({ Component: (await import("./pages/legal/Legal")).PrivacyPage }) },
      { path: "/legal/guidelines", lazy: async () => ({ Component: (await import("./pages/legal/Legal")).GuidelinesPage }) },
      { path: "/legal/copyright", lazy: async () => ({ Component: (await import("./pages/legal/Legal")).CopyrightPage }) },
      { path: "/legal/grievance", lazy: async () => ({ Component: (await import("./pages/legal/Legal")).GrievancePage }) },
      { path: "/legal/monetisation", lazy: async () => ({ Component: (await import("./pages/legal/Legal")).MonetisationPage }) },
      { path: "/legal/live", lazy: async () => ({ Component: (await import("./pages/legal/Legal")).LiveRulesPage }) },
      { path: "/:channel", lazy: page(() => import("./pages/Channel")) },
      { path: "*", element: <NotFound /> },
    ],
  },
])
