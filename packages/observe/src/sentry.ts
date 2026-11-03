import { captureException, init } from "@sentry/react"
import { scrubBreadcrumb, scrubEvent, scrubText } from "./scrub"

export type Reporter = (error: unknown, componentStack?: string) => void

export type StartOptions = { dsn: string; app: string; release?: string; environment?: string; tunnel?: string }

export function start({ dsn, app, release, environment, tunnel }: StartOptions): Reporter {
  init({
    dsn,
    tunnel: tunnel || undefined,
    release: release || undefined,
    environment: environment || undefined,
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    sendClientReports: false,
    maxBreadcrumbs: 50,
    maxValueLength: 1000,
    integrations: (defaults) => defaults.filter((i) => i.name !== "BrowserSession"),
    initialScope: { tags: { app } },
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  })
  return (error, componentStack) => {
    captureException(error, componentStack ? { contexts: { react: { componentStack: scrubText(componentStack) } } } : undefined)
  }
}
