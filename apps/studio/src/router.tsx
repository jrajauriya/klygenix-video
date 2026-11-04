import type { ReactNode } from "react"
import { ForgotPage, InvitePage, ResetPage, SignupPage, VerifyPage } from "@klygenixvideo/auth"
import { createBrowserRouter } from "react-router-dom"
import { ProtectedRoute } from "@klygenixvideo/client"
import { StudioLayout } from "./components/layout/StudioLayout"
import Login from "./pages/Login"
import Onboarding from "./pages/Onboarding"
import Dashboard from "./pages/Dashboard"
import Videos from "./pages/Videos"
import VideoDetail from "./pages/VideoDetail"
import Clips from "./pages/Clips"
import ClipEditor from "./pages/ClipEditor"
import ChannelPage from "./pages/Channel"
import Comments from "./pages/Comments"
import Community from "./pages/Community"
import Analytics from "./pages/Analytics"
import Billing from "./pages/Billing"
import Earnings from "./pages/Earnings"
import Moderation from "./pages/Moderation"
import Settings from "./pages/Settings"
import Live from "./pages/Live"
import GoLive from "./pages/GoLive"
import NotFound from "./pages/NotFound"
import Sponsorships from "./pages/Sponsorships"
import DealDetail from "./pages/DealDetail"
import BrandProfile from "./pages/brand/BrandProfile"
import Campaigns from "./pages/brand/Campaigns"
import CampaignDetail from "./pages/brand/CampaignDetail"
import Briefs from "./pages/brand/Briefs"
import BrandDeals from "./pages/brand/BrandDeals"

const guard = (key: string, element: ReactNode) => (
  <ProtectedRoute featureKey={key} permissionKey={key}>
    {element}
  </ProtectedRoute>
)

export const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/signup", element: <SignupPage /> },
  { path: "/verify", element: <VerifyPage /> },
  { path: "/forgot", element: <ForgotPage /> },
  { path: "/reset", element: <ResetPage /> },
  { path: "/invite", element: <InvitePage /> },
  {
    element: <StudioLayout />,
    children: [
      { path: "/welcome", element: guard("video.channels", <Onboarding />) },
      { path: "/", element: guard("video.dashboard", <Dashboard />) },
      { path: "/videos", element: guard("video.uploads", <Videos />) },
      { path: "/videos/:id", element: guard("video.uploads", <VideoDetail />) },
      { path: "/clips", element: guard("video.clips", <Clips />) },
      { path: "/clips/:id", element: guard("video.clips", <ClipEditor />) },
      { path: "/channel", element: guard("video.channels", <ChannelPage />) },
      { path: "/live", element: guard("video.live", <Live />) },
      { path: "/live/:publicId", element: guard("video.live", <GoLive />) },
      { path: "/comments", element: guard("video.comments", <Comments />) },
      { path: "/community", element: guard("video.channels", <Community />) },
      { path: "/analytics", element: guard("video.analytics", <Analytics />) },
      { path: "/earnings", element: guard("video.earnings", <Earnings />) },
      { path: "/sponsorships", element: guard("video.sponsorships", <Sponsorships />) },
      { path: "/sponsorships/deals/:id", element: guard("video.dashboard", <DealDetail />) },
      { path: "/brand", element: guard("video.brand", <BrandProfile />) },
      { path: "/brand/campaigns", element: guard("video.brand", <Campaigns />) },
      { path: "/brand/campaigns/:id", element: guard("video.brand", <CampaignDetail />) },
      { path: "/brand/briefs", element: guard("video.brand", <Briefs />) },
      { path: "/brand/deals", element: guard("video.brand", <BrandDeals />) },
      { path: "/billing", element: guard("video.billing", <Billing />) },
      { path: "/moderation", element: guard("video.dashboard", <Moderation />) },
      { path: "/settings", element: guard("video.settings", <Settings />) },
      { path: "*", element: <NotFound /> },
    ],
  },
])
