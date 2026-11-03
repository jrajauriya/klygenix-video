import type { BadgeColor } from "@klygenixvideo/ui"

/**
 * One role vocabulary for the whole platform. The master estate has two shapes of this
 * file that drifted apart; this repository has one.
 */
export const ROLE_META: Record<string, { label: string; what: string; color: BadgeColor }> = {
  global_admin: { label: "Platform owner", what: "Runs Klygenix Play itself. Sees every tenant.", color: "purple" },
  owner: { label: "Owner", what: "Owns the account. Every screen, every approval.", color: "purple" },
  admin: { label: "Manager", what: "Runs the day to day. Approves within their band.", color: "blue" },
  user: { label: "Staff", what: "Sees only what the screen-access matrix allows.", color: "slate" },
}

export const ASSIGNABLE_ROLES = ["admin", "user"] as const

export function roleLabel(role?: string | null): string {
  if (!role) return "—"
  return ROLE_META[role]?.label ?? role.replace(/_/g, " ")
}

export function roleColor(role?: string | null): BadgeColor {
  if (!role) return "slate"
  return ROLE_META[role]?.color ?? "slate"
}
