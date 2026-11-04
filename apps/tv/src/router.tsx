import { createBrowserRouter } from "react-router-dom"
import { Frame, Shell } from "./components/Shell"
import Home from "./pages/Home"
import Watch from "./pages/Watch"
import Live from "./pages/Live"
import Search from "./pages/Search"
import Subscriptions from "./pages/Subscriptions"
import Channel from "./pages/Channel"
import Profile from "./pages/Profile"
import SignIn from "./pages/SignIn"
import Feedback from "./pages/Feedback"
import NotFound from "./pages/NotFound"

export const router = createBrowserRouter([
  {
    element: <Frame />,
    children: [
      { path: "/watch/:id", element: <Watch /> },
      { path: "/live/:id", element: <Live /> },
      {
        element: <Shell />,
        children: [
          { path: "/", element: <Home /> },
          { path: "/subscriptions", element: <Subscriptions /> },
          { path: "/search", element: <Search /> },
          { path: "/channel/:handle", element: <Channel /> },
          { path: "/profile", element: <Profile /> },
          { path: "/login", element: <SignIn /> },
          { path: "/feedback", element: <Feedback /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
])
