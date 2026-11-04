import { api, errorCode, statusOf } from "./api"
import type { Key } from "./strings"
import type { TeamInvite } from "./types"

const TOKEN = /^[\w-]{10,100}$/

export function inviteToken(text: string | null | undefined): string | null {
  const raw = (text ?? "").trim()
  if (!raw) return null
  const match = raw.match(/[?&#]token=([^&#\s]+)/)
  let token = raw
  if (match) {
    try {
      token = decodeURIComponent(match[1])
    } catch {
      token = match[1]
    }
  }
  return TOKEN.test(token) ? token : null
}

export async function previewInvite(token: string): Promise<TeamInvite> {
  return (await api.get<TeamInvite>("/api/video/team/invite", { params: { token } })).data
}

export async function acceptInvite(token: string): Promise<{ tenant_id: number; role: string }> {
  return (await api.post<{ tenant_id: number; role: string }>("/api/video/team/accept", { token })).data
}

export async function leaveChannel(tenantId: number): Promise<void> {
  try {
    await api.post(`/api/video/me/channels/${tenantId}/leave`)
  } catch (err) {
    if (errorCode(err) !== "team_member_not_found") throw err
  }
}

export function expired(invite: TeamInvite, now = Date.now()): boolean {
  return Boolean(invite.expires_at) && new Date(invite.expires_at as string).getTime() <= now
}

export function inviteProblem(error: unknown): Key | null {
  const code = errorCode(error)
  const status = statusOf(error)
  if (code === "team_invite_expired" || status === 410) return "invite.expired"
  if (code === "team_invite_other_email" || (status === 403 && !code)) return "invite.otherEmail"
  if (code === "team_invite_self") return "invite.self"
  if (code === "team_invite_not_found" || status === 404) return "invite.notFound"
  return null
}
