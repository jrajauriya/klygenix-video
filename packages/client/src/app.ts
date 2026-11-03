/**
 * Each app declares its own key once, in main.tsx, before anything renders.
 * The permission and feature hooks derive their endpoints from it, so a screen
 * never hard-codes "/api/pay/..." and a copied file cannot query the wrong app.
 */
let APP_KEY = ""

export function configureApp(key: string) {
  APP_KEY = key
}

export function appKey(): string {
  if (!APP_KEY) {
    throw new Error("configureApp() must run before any Klygenix Play hook. Call it in main.tsx.")
  }
  return APP_KEY
}
