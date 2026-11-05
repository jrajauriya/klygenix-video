"""Run 6 channel teams: invites, roles through both gates, acting tenant, owner-only money, removal, audit."""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

from harness import admin_login, check, client, creator, finish, ok, premium, settled, signup, sql, uid, upload, wait_for


def token_for(email: str) -> str:
    row = sql("SELECT data->>'link' FROM kv_admin.mail_outbox WHERE template = 'team_invite' AND to_email = :e "
              "ORDER BY id DESC LIMIT 1", e=email.lower())
    return parse_qs(urlparse(row[0][0]).query)["token"][0] if row else ""


def acting(c, tenant_id: int):
    a = client(c.headers["Authorization"].split()[1])
    a.headers["X-Kv-Tenant"] = str(tenant_id)
    return a


owner = creator("Team Owner")
tid = owner.user["tenant_id"]
ed = signup("Team Editor")
mod = signup("Team Moderator")
stranger = signup("Team Stranger")

print("\n== invites")
r = owner.post("/api/video/studio/team/invites", json={"email": ed.email, "role": "editor"})
check("owner invites an editor", (r.status_code, r.json().get("status")), (201, "invited"))
mid = r.json()["id"]
check("inviting yourself is refused", owner.post("/api/video/studio/team/invites",
                                                json={"email": owner.email, "role": "editor"}).status_code, 400)
check("the same person twice is refused", owner.post("/api/video/studio/team/invites",
                                                    json={"email": ed.email, "role": "analyst"}).status_code, 409)
check("an unknown role is refused", owner.post("/api/video/studio/team/invites",
                                              json={"email": mod.email, "role": "boss"}).status_code, 422)
check("the free plan allows one member", owner.post("/api/video/studio/team/invites",
                                                    json={"email": mod.email, "role": "moderator"}).status_code, 402)
tok = token_for(ed.email)
ok("the invitation mail carries a link", len(tok) > 10)
pv = ed.get(f"/api/video/team/invite?token={tok}").json()
check("the invitee sees which channel and role", (pv["role"], pv["for_you"], bool(pv["channel"])), ("editor", True, True))
check("someone else cannot accept it", stranger.post("/api/video/team/accept", json={"token": tok}).status_code, 403)
note = wait_for(lambda: [n for n in ed.get("/api/video/me/inbox").json()["items"] if n["kind"] == "team_invite"], 20)
ok("an invitee with an account also gets it in their inbox", bool(note) and "/team/accept?token=" in (note[0]["url"] or ""), note)
r = ed.post("/api/video/team/accept", json={"token": tok})
check("the invitee accepts", (r.status_code, r.json().get("tenant_id")), (200, tid))
check("a used invitation cannot be reused", ed.post("/api/video/team/accept", json={"token": tok}).status_code, 404)
chans = ed.get("/api/video/me/channels").json()
ok("the editor's channel list includes the owner's channel", any(c["tenant_id"] == tid and c["role"] == "editor" for c in chans), chans)

print("\n== the acting channel")
ea = acting(ed, tid)
me = ea.get("/api/video/studio/team/me").json()
check("acting as editor in the owner's channel", (me["tenant_id"], me["role"], me["member"]), (tid, "editor", True))
check("money is never in an editor's map", (me["permissions"]["video.earnings"], me["permissions"]["video.billing"]), ("none", "none"))
v = settled(ea, upload(ea, "reel-chai", "Uploaded by the editor")["id"])
check("the editor's upload belongs to the channel", sql("SELECT tenant_id FROM kv_media.videos WHERE id = :i", i=v["id"])[0][0], tid)
check("the owner sees it", any(x["id"] == v["id"] for x in owner.get("/api/video/studio/videos").json()), True)
r = ea.get("/api/video/studio/earnings")
check("earnings are owner-only", r.status_code, 403)
check("an editor reads comments", ea.get("/api/video/studio/comments").status_code, 200)
check("an editor cannot invite", ea.post("/api/video/studio/team/invites", json={"email": stranger.email, "role": "analyst"}).status_code, 403)
check("an editor cannot rename the handle", ea.post("/api/video/studio/channel/handle", json={"handle": "taken-by-editor"}).status_code, 403)
check("without the header the editor is in their own studio", ed.get("/api/video/studio/team/me").json()["tenant_id"], ed.user["tenant_id"])
r = acting(stranger, tid).get("/api/video/studio/videos")
check("a forged channel header is refused with a code", (r.status_code, r.json().get("code"), r.headers.get("x-error-code")),
      (403, "team_not_member", "team_not_member"))
check("the channel's plan and meters, not the member's", (me["plan"]["key"], [u["metric"] for u in me["usage"]]),
      ("creator_free", ["ai_minutes", "renders", "ai_images"]))
steps = [s["key"] for s in ea.get("/api/video/studio/onboarding").json()["steps"]]
check("the checklist hides money and channel set-up from an editor", ("payouts" in steps, "profile" in steps), (False, False))
check("viewer routes ignore the header", ea.get("/api/video/me").status_code, 200)

print("\n== more seats on a paid plan, moderators")
premium(owner, "creator_pro")
r = owner.post("/api/video/studio/team/invites", json={"email": mod.email, "role": "moderator"})
check("pro allows more members", r.status_code, 201)
check("the moderator accepts", mod.post("/api/video/team/accept", json={"token": token_for(mod.email)}).status_code, 200)
ma = acting(mod, tid)
check("a moderator handles comments", ma.get("/api/video/studio/comments").status_code, 200)
fan_comment = stranger.post(f"/api/video/videos/{v['public_id']}/comments", json={"body": "Spammy line for the moderator"}).json()
other = signup("Team Outsider")
check("an outsider cannot delete a viewer's comment", other.delete(f"/api/video/comments/{fan_comment['id']}").status_code, 403)
check("the team moderator can", mod.delete(f"/api/video/comments/{fan_comment['id']}").status_code, 204)
check("a moderator cannot see videos", ma.get("/api/video/studio/videos").status_code, 403)
check("a moderator cannot see analytics", ma.get("/api/video/studio/analytics").status_code, 403)
matrix = owner.get("/api/video/roles/permissions").json()
ok("the owner's matrix lists the team roles", {"manager", "editor", "moderator", "analyst"} <= set(matrix), list(matrix))
cur = matrix["moderator"]
r = owner.put("/api/video/roles/permissions", json={"permissions": {"moderator": [{"permission_key": k, "access_level": lv} for k, lv in {**cur, "video.analytics": "view"}.items()]}})
check("the owner can widen a role", r.status_code, 200)
check("the change applies to the moderator at once", ma.get("/api/video/studio/analytics").status_code, 200)

print("\n== the channel's moderation notices")
admin = admin_login()
r = admin.post("/api/video/admin/actions", json={"target_type": "video", "target_id": v["id"], "action": "remove", "reason": "Misleading title"})
act = r.json()["id"] if r.status_code == 201 else None
check("the platform removes a team upload", r.status_code, 201)
ids = lambda c: [a["id"] for a in c.get("/api/video/me/moderation").json()["actions"]]
ok("the owner sees the notice", act in ids(owner))
ok("the moderator sees the channel's notice", act in ids(ma))
ok("an editor reads it too", act in ids(ea))
ok("without the channel header the moderator sees only their own", act not in ids(mod))
check("an outsider forging the header is refused", acting(stranger, tid).get("/api/video/me/moderation").status_code, 403)
check("an editor cannot appeal", ea.post("/api/video/appeals", json={"action_id": act, "text": "This title is accurate, please look again."}).status_code, 403)
r = ma.post("/api/video/appeals", json={"action_id": act, "text": "The title matches the video, please look again."})
check("the moderator appeals for the channel", r.status_code, 201)
check("the appeal is the channel's, filed by the moderator", sql("SELECT tenant_id, user_id FROM kv_trust.appeals WHERE id = :i", i=r.json()["id"])[0],
      (tid, mod.user["id"]))
v2 = settled(owner, upload(owner, "reel-chai", "Owner chai for a notice")["id"])
t = client().post("/api/video/takedowns", json={"kind": "copyright", "complainant_name": "Rights Holder", "complainant_email": f"rights-{uid()}@example.com",
                                                "target_url": f"https://play.klygenix.com/watch/{v2['public_id']}",
                                                "details": "This is my original recording uploaded without licence.", "sworn": True})
ref = t.json()["reference"]
td = next(x for x in admin.get("/api/video/admin/takedowns").json() if x["reference"] == ref)
admin.post(f"/api/video/admin/takedowns/{td['id']}", json={"status": "actioned", "note": "Matches the claim"})
seen = {x["reference"]: x["can_counter"] for x in ma.get("/api/video/me/takedowns").json()}
check("the moderator sees the takedown but may not counter it", seen.get(ref), False)
check("the owner may", {x["reference"]: x["can_counter"] for x in owner.get("/api/video/me/takedowns").json()}.get(ref), True)
cn = {"full_name": "Team Moderator", "address": "12 MG Road, Pune 411001, India", "phone": "+91 98200 00000",
      "email": mod.email, "statement": "I recorded this video myself; the claimant has misidentified it.",
      "good_faith": True, "consent_jurisdiction": True, "signature": "Team Moderator"}
r = ma.post(f"/api/video/me/takedowns/{ref}/counter-notice", json=cn)
check("a counter-notice is the owner's alone", (r.status_code, r.headers.get("X-Error-Code")), (403, "owner_only"))

print("\n== managers, roles and removal")
r = owner.patch(f"/api/video/studio/team/{mid}", json={"role": "manager"})
check("the owner promotes the editor to manager", r.json()["role"], "manager")
check("a manager can invite", ea.post("/api/video/studio/team/invites", json={"email": stranger.email, "role": "analyst"}).status_code, 201)
label = sql("SELECT actor_label FROM kv_admin.audit_log WHERE tenant_id = :t AND actor_user_id = :u AND action = 'team.invite' "
            "ORDER BY id DESC LIMIT 1", t=tid, u=ed.user["id"])
ok("the trail names the member and the channel", bool(label) and f"team manager, tenant {tid}" in (label[0][0] or ""), label)
check("a manager cannot change their own role", ea.patch(f"/api/video/studio/team/{mid}", json={"role": "editor"}).status_code, 400)
check("a manager still never sees earnings", ea.get("/api/video/studio/earnings").status_code, 403)
team = owner.get("/api/video/studio/team").json()
check("the team lists three people", len(team["members"]), 3)
pending = next(m for m in team["members"] if m["email"] == stranger.email)
sql("UPDATE kv_admin.tenant_members SET expires_at = now() - interval '1 minute' WHERE id = :i", i=pending["id"])
check("an expired invitation cannot be previewed", stranger.get(f"/api/video/team/invite?token={token_for(stranger.email)}").status_code, 410)
check("an expired invitation is refused", stranger.post("/api/video/team/accept", json={"token": token_for(stranger.email)}).status_code, 410)
check("the owner removes the manager", owner.delete(f"/api/video/studio/team/{mid}").status_code, 200)
check("a removed member loses access at once", ea.get("/api/video/studio/videos").status_code, 403)
check("the moderator can leave", mod.post(f"/api/video/me/channels/{tid}/leave").status_code, 200)
check("and is gone", ma.get("/api/video/studio/comments").status_code, 403)
check("and no longer sees the notices", ma.get("/api/video/me/moderation").status_code, 403)
actions = {a for (a,) in sql("SELECT action FROM kv_admin.audit_log WHERE action LIKE 'team.%' AND target_id IN "
                             "(SELECT id FROM kv_admin.tenant_members WHERE tenant_id = :t)", t=tid)}
ok("every team change is audited", {"team.invite", "team.accept", "team.role", "team.remove"} <= actions, actions)

finish()
