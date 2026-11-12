import type { ConfigContext, ExpoConfig } from "expo/config"

const domain = process.env.EXPO_PUBLIC_DOMAIN || "play.klygenix.com"
const flat = (process.env.EXPO_PUBLIC_HOST_STYLE || "flat") === "flat"
const studio = flat ? domain.replace(/^([^.]+)\./, "$1-studio.") : `studio.${domain}`
const category = ["BROWSABLE", "DEFAULT"]

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Klygenix Play",
  slug: config.slug ?? "klygenix-play",
  ios: { ...config.ios, associatedDomains: [`applinks:${domain}`, `applinks:${studio}`] },
  android: {
    ...config.android,
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        category,
        data: ["/watch/", "/reels/", "/live/", "/@"].map((pathPrefix) => ({ scheme: "https", host: domain, pathPrefix })),
      },
      { action: "VIEW", autoVerify: true, category, data: [{ scheme: "https", host: studio, pathPrefix: "/team/accept" }] },
    ],
  },
})
