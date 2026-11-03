import { Component, type ErrorInfo, type ReactNode } from "react"
import type { RootOptions } from "react-dom/client"
import type { Reporter } from "./sentry"

const DSN: string = import.meta.env.VITE_SENTRY_DSN || ""
const TUNNEL_SETTING: string = import.meta.env.VITE_SENTRY_TUNNEL || ""

export function tunnelUrl(setting = TUNNEL_SETTING, api: string = import.meta.env.VITE_API_URL || ""): string | undefined {
  if (setting === "direct") return undefined
  if (setting) return setting
  return `${api.replace(/\/+$/, "")}/api/observe/tunnel`
}

let reporter: Reporter | null = null
const early: Array<[unknown, string | undefined]> = []
const seen = new WeakSet<object>()

function report(error: unknown, componentStack?: string): void {
  if (error && typeof error === "object") {
    if (seen.has(error)) return
    seen.add(error)
  }
  if (reporter) reporter(error, componentStack)
  else if (early.length < 20) early.push([error, componentStack])
}

export function startErrorTracking(app: string): void {
  if (!DSN) return
  const onError = (e: ErrorEvent) => report(e.error ?? e.message)
  const onRejection = (e: PromiseRejectionEvent) => report(e.reason)
  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)
  import("./sentry")
    .then(({ start }) => {
      reporter = start({
        dsn: DSN,
        app,
        release: import.meta.env.VITE_SENTRY_RELEASE,
        environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
        tunnel: tunnelUrl(),
      })
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
      for (const [error, stack] of early.splice(0)) reporter(error, stack)
    })
    .catch(() => {})
}

export function rootOptions(): RootOptions | undefined {
  if (!DSN) return undefined
  const forward = (error: unknown, info: { componentStack?: string }) => {
    report(error, info.componentStack)
    console.error(error)
  }
  return { onCaughtError: forward, onUncaughtError: forward }
}

type BoundaryState = { failed: boolean }

class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    report(error, info.componentStack ?? undefined)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <div>
          <p style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Something went wrong.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer" }}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}

export function withReporting(node: ReactNode): ReactNode {
  if (!DSN) return node
  return <ErrorBoundary>{node}</ErrorBoundary>
}
