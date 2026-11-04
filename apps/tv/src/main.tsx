import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { rootOptions, startErrorTracking, withReporting } from "@klygenixvideo/observe"
import App from "./App"
import { configureApi } from "./lib/api"
import { initLang } from "./lib/i18n"
import "@klygenixvideo/fonts/console.css"
import "./index.css"

configureApi()
initLang()
startErrorTracking("tv")

createRoot(document.getElementById("root")!, rootOptions()).render(
  withReporting(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
