import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { rootOptions, startErrorTracking, withReporting } from "@klygenixvideo/observe"
import { applyTheme } from "@klygenixvideo/ui"
import { configureApp } from "@klygenixvideo/client"
import { api } from "@klygenixvideo/auth"
import App from "./App"
import "./i18n"
import { registerServiceWorker } from "./pwa"
import "@klygenixvideo/fonts/console.css"
import "./index.css"

configureApp("video")
api.defaults.headers["X-Klygenix-App"] = "web"
applyTheme("dark")

startErrorTracking("web")

createRoot(document.getElementById("root")!, rootOptions()).render(
  withReporting(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)

registerServiceWorker()
