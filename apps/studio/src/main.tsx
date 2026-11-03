import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { rootOptions, startErrorTracking, withReporting } from "@klygenixvideo/observe"
import { bootTheme } from "@klygenixvideo/ui"
import { configureApp } from "@klygenixvideo/client"
import App from "./App"
import "@klygenixvideo/fonts/console.css"
import "@klygenixvideo/fonts/brand.css"
import "./index.css"

configureApp("video")
bootTheme("studio")

startErrorTracking("studio")

createRoot(document.getElementById("root")!, rootOptions()).render(
  withReporting(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {})
  })
}
