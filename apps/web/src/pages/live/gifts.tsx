import { Coffee, Flower2, Gift, Trophy } from "lucide-react"

export function giftIcon(gift: string | null | undefined, size = 18) {
  const g = (gift ?? "").toLowerCase()
  if (g === "chai") return <Coffee size={size} aria-hidden="true" />
  if (g === "rose") return <Flower2 size={size} aria-hidden="true" />
  if (g === "trophy") return <Trophy size={size} aria-hidden="true" />
  return <Gift size={size} aria-hidden="true" />
}
