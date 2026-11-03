import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { rootOptions, startErrorTracking, withReporting } from "@klygenixvideo/observe"
import { bootTheme } from "@klygenixvideo/ui"
import { configureApp } from "@klygenixvideo/client"
import { api } from "@klygenixvideo/auth"
import App from "./App"
import "@klygenixvideo/fonts/console.css"
import "./index.css"

// Must run before anything renders: the permission and feature hooks derive their
// endpoints from it.
configureApp("admin")
api.defaults.headers["X-Klygenix-App"] = "admin"
bootTheme("admin")

startErrorTracking("admin")

createRoot(document.getElementById("root")!, rootOptions()).render(
  withReporting(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
