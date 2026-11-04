import { useQuery } from "@tanstack/react-query"
import { getJson, useSignedIn } from "./api"
import type { ChannelSupport } from "./types"
import { tr } from "../i18n"

export function useChannelSupport(handle: string | null | undefined, enabled = true) {
  const signedIn = useSignedIn()
  return useQuery({
    queryKey: ["support", handle, signedIn],
    enabled: Boolean(handle) && enabled,
    queryFn: () => getJson<ChannelSupport>(`/api/video/channels/${handle}/support`),
  })
}

export function feeText(support: Pick<ChannelSupport, "commission_bps"> | null | undefined): string {
  const bps = support?.commission_bps
  if (typeof bps !== "number") return tr("a platform fee")
  const pct = bps / 100
  return tr("a {pct}% platform fee", { pct: Number.isInteger(pct) ? pct : pct.toFixed(1) })
}
