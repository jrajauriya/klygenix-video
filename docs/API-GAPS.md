# API gaps

Needs found by the frontend agents. Each entry names the screen, what is missing and the stop-gap in use.

## Studio (apps/studio)

1. **Team members for Play studio (`video.users`).** The Store team API (`/api/store/studio/team`, invites, role matrix screen) was removed and there is no Play replacement for listing, inviting or removing studio members, or editing a member's role. Needed: `GET/POST /api/video/studio/team`, `PATCH/DELETE /api/video/studio/team/{user_id}`, invite accept flow. Stop-gap: Settings shows a "Team members — coming soon" card; no `/users` route.
2. **Channel analytics aggregate.** Dashboard and Analytics sum `GET /api/video/studio/videos?limit=100` in the browser (the limit is capped at 100), so totals miss older videos on large channels and there is no time series. Needed: `GET /api/video/studio/analytics?from=&to=` → channel totals (views, watch_ms, likes, comments, danmaku, followers gained) plus a per-day series, and per-video series at `GET /api/video/studio/videos/{id}/analytics`.
3. **Creator comment inbox.** Comments and danmaku can only be read per video (`/api/video/videos/{public_id}/comments|danmaku`). Needed: `GET /api/video/studio/comments?status=&video_id=&limit=&offset=` (newest first across the channel, with video title) so the Comments page does not need a video picker. Danmaku rows also lack the author name, which moderation would want.
4. **Captions list on the studio video.** `GET /api/video/studio/videos/{id}` has no `captions` field; the Captions tab reads `captions.available` from the public `GET /api/video/videos/{public_id}`. Add `captions: {available, translatable, sources}` to the studio detail (and which languages came from the creator vs speech-to-text).
5. **Clip ideas count in the video list.** The dashboard "Make clips" card needs an extra `GET /suggestions` call; `suggestion_count` exists only on the detail. Add it to `studio_video()` list rows.
6. **Changing the channel handle.** `PATCH /api/video/studio/channel` ignores `handle`; the Channel page shows it read-only.

## Mobile (apps/mobile)
- `POST /api/video/devices/push-token {token, platform}` and `POST /api/video/devices/push-token/forget {token}` — the app registers an Expo push token once an EAS projectId exists (none yet, so it is a no-op today).
- `GET /api/video/feed/reels` cards: add `comments` (count) and, for a signed-in viewer, `liked` and `following`, so the reel's like/follow buttons start in the right state without a per-reel `GET /videos/{id}`.

## Viewer web (apps/web)
1. **Viewer state on feed cards.** `GET /api/video/feed/reels` (and `/feed/home`, `/channels/{handle}/videos`) cards lack `liked`, `following`, `comments` and `captions.available` for a signed-in viewer. Stop-gap: the reels feed calls `GET /api/video/videos/{id}` for the reel on screen to get like/follow state, comment count and a caption language. (Same need as mobile above.)
2. **Up next / related videos.** No `GET /api/video/videos/{public_id}/related`. Stop-gap: the watch page lists the home feed minus the current video.
3. **Search paging.** `GET /api/video/search` has `limit` (max 50) but no `offset`/`X-Total-Count`, so results stop at 50 with no "more".
4. **History management.** No way to remove one item from `GET /api/video/me/history` or clear it (`DELETE /api/video/me/history/{public_id}`, `DELETE /api/video/me/history`), nor `offset`/`X-Total-Count` on it. The Privacy page promises erasure; there is also no viewer-facing data export / account deletion endpoint in the video API (`POST /api/video/me/export`, `DELETE /api/video/me`).
5. **Comment authors.** Comment rows carry only `author` (display name): no author id, channel handle or avatar, so names cannot link to a channel and creator replies cannot be badged. Add `author_channel: {handle, avatar} | null` and `is_creator`.
6. **Danmaku from another viewer cannot be reported from the overlay** (the layer is pointer-events-none by design). The rail could offer it, but danmaku rows have no author/ownership hint beyond `mine`; fine for now, noting it for moderation parity.
7. **Checkout status for sandbox failure.** After `POST /sandbox/pay/{id}?outcome=failed` the page polls `GET /api/video/checkout/{id}` and treats `status` in `failed|cancelled|expired` as failed; please confirm those are the status values the sandbox writes (the code path wasn't documented).

## Resolved (3 Nov 2026, backend) — proven by `tests/test_viewer_extras.py`
| Gap | Endpoint / change |
|---|---|
| Studio 2 — channel analytics | `GET /api/video/studio/analytics?from=&to=` → `{totals, period, days[], top[]}` (default 28 days, max 366); `GET /api/video/studio/videos/{id}/analytics` → `{totals (completion_rate, avg_view_ms), days[]}`. Daily rows come from the counter flush into `kv_social.view_daily` (IST day). |
| Studio 3 — comment inbox | `GET /api/video/studio/comments?kind=comments|danmaku&status=visible|hidden&video_id=&limit=&offset=` (X-Total-Count) — newest first across the channel with `video_public_id`, `video_title`, `author`, `report_count`; danmaku rows carry `author`, `t_ms`, `mode`, `color`. Hidden rows included. |
| Studio 4 — captions on the studio detail | `captions: {available, translatable, sources: [{language, source}]}` on `GET /studio/videos/{id}`. |
| Studio 5 — clip idea count | `suggestion_count` on every `GET /studio/videos` row. |
| Mobile — push tokens | `POST /api/video/devices/push-token {token, platform: ios|android|web}` (idempotent, moves a token to the signed-in user), `POST /api/video/devices/push-token/forget {token}`. Table `kv_social.device_tokens` (migration kv0000000004). |
| Mobile + Web 1 — viewer state on cards | Every feed card (`/feed/home`, `/feed/reels`, `/feed/following`, `/me/history`, `/videos/{id}/related`) now has `comments`, `captions.available`, `liked`, `following` (false when anonymous). |
| Web 2 — related | `GET /api/video/videos/{public_id}/related?limit=12` — same channel first, then shared tags, then language, then fresh; same kind. |
| Web 3 — search paging | `GET /api/video/search?offset=` (≤500) with `X-Total-Count` and `total` in the body. |
| Web 4 — history and data rights | `GET /me/history` takes `offset`, sends X-Total-Count and `watched_at`; `DELETE /me/history/{public_id}`, `DELETE /me/history`; `POST /api/video/me/export` (JSON attachment); `DELETE /api/video/me {confirm: "DELETE"}` — 409 `cancel_plan_first` while a paid plan renews; erases email, name, password, likes, follows, history, questions, tokens, comments/danmaku text; soft-deletes the channel's videos; invoices and payments are kept (tax law). Audited. |
| Web 5 — comment authors | Comment rows carry `author_channel: {handle, name, avatar} | null` and `is_creator`. |
| Web 7 — failed sandbox payment | The payments worker sets the checkout `status` to `failed`; `failed|cancelled|expired` is the right test. |

| Studio inbox — hide/unhide | `PATCH /api/video/studio/comments/{id} {status: visible|hidden, kind: comment|danmaku}` (own videos only; not for deleted rows). |
| V1.7 / V3.1 — playlists and series | Public: `GET /api/video/channels/{handle}/playlists` (public, non-empty, with `cover`), `GET /api/video/playlists/{id}` (`videos` are feed cards; unlisted by link; private only to the owner). Studio (`video.channels`): `GET/POST /studio/playlists`, `PATCH/DELETE /studio/playlists/{id}`, `POST /studio/playlists/{id}/items {video_id}`, `DELETE /studio/playlists/{id}/items/{video_id}`, `PUT /studio/playlists/{id}/order {video_ids}`. Viewer: `GET /api/video/me/playlists/{id}/progress` → `{total, completed, percent, next, videos[]}`. Proven by `tests/test_playlists.py`. |

| V3.7 — watch parties | `POST /api/video/parties {video_id}` → `{code, video_id, host_name, playing, position_ms, server_time, members, is_host}`; `GET /parties/{code}` (any case); host only: `POST /parties/{code}/state {playing, position_ms}`, `DELETE /parties/{code}`; anyone signed in: `POST /parties/{code}/chat {text}`. WebSocket `/api/video/ws/parties/{code}` sends `hello` (full state), then `state`, `chat`, `members`, `ended`. State lives in Redis for 6 h (no table). Proven by `tests/test_parties.py`. |

| V1.3 — thumbnail ideas | Studio detail carries `thumbnail_custom` and `thumbnail_ideas: [{at_ms, key, reason, url, chosen}]` (up to four frames the pipeline picks at chapter starts, the strongest clip moments and a third of the way in). `POST /studio/videos/{id}/thumbnail/pick {key}` (must be one of the ideas), `DELETE /studio/videos/{id}/thumbnail` (back to the provider frame). An uploaded custom thumbnail now shows on every card (it was saved but ignored before). Proven by `tests/test_thumbnails.py`. |

## Still open (decisions, not oversights)
- **Studio 1 — team members.** Not ported: a Play channel is one person in V1. Needs the Store team API rewritten on `video.*` keys — logged in BUILD-PLAN.
- **Studio 6 — handle change.** Deliberately read-only: shared `/@handle` links, embeds and share previews would break. Needs a redirect table first.
- **Web 6 — reporting danmaku from the overlay.** By design; the rail is the place.
