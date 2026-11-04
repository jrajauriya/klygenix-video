# Legal drafts — placeholders and open questions

The web app's legal pages (`apps/web/src/pages/legal/Legal.tsx`, routes `/legal/*`) are drafts written from
what the product does today. Every page shows "Draft — pending legal review". This file lists every
`[PLACEHOLDER: …]` on the pages and the questions for the lawyer (and the CA where money or tax is involved),
grouped by page. "Product fact" notes say what the code does now, so the answer can be checked against it.

## Company facts used on every page

| Placeholder | Where |
|---|---|
| Effective date | header of every page |
| CIN | Terms (intro), Privacy (intro), Grievance (address) |
| Registered address | Terms (intro, §15), Privacy (intro), Grievance (address) |
| GSTIN of Klygenix Technologies Private Limited | Terms §15 |
| Jurisdiction city | Terms §14, Copyright §3 |

## Terms of Service — `/legal/terms`

Placeholders
- AI provider contracts: confirm the providers may not train on customer content (§5).
- Plan refund policy (§7): today plans are not refunded for part of a period; confirm what the law requires.
- Legal characterisation of the creator marketplace (§8): Klygenix "collects as an e-commerce operator, keeps a
  commission and passes the rest" — confirm with counsel and CA.
- Liability cap amount in INR (§12).
- Indemnity scope for consumers (§12).
- Notice period for material changes, e.g. 30 days (§13).
- Whether to include an arbitration clause (§14).
- Legal contact email (§15).

Open questions
1. Age gate: India 18; DE, NL, IE, LU, SK, HU, RO, HR, PL 16; elsewhere 13 (`backend/app/video/trust/age.py`). Is
   18 in India right given the DPDP Act's verifiable parental consent rules (we offer no parental consent flow)? Is
   the EU list complete and current? Should the US COPPA position be stated?
2. Content licence: wide enough for transcripts, translations, dubbing, clip suggestions, search vectors and live
   replays? Should it survive deletion for backups (monthly backups are kept up to 7 years)?
3. Embeds of YouTube/Bilibili: is anything needed beyond "their terms apply" (YouTube API Services terms require
   specific wording and a link to Google's privacy policy)?
4. Strike policy (90-day expiry, suspension at 3 active strikes) — acceptable as a published rule?

## Privacy Policy — `/legal/privacy`

Placeholders
- Privacy contact email; DPO name and contact; EU representative if required (§1).
- Legal basis for recommendations / For you feed (§3).
- Advertising plans (§5) — the page says no third-party ads today.
- Safety-scan vendor; backup provider and region (§5).
- Provider regions for cross-border transfer (§6).
- Retention: tax/invoice period (e.g. 8 years), backup retention vs. erasure duties, security log period (§7).
- Response time for rights requests (§8).
- Whether any analytics will be added (§11).

Open questions
1. Is Klygenix a Significant Data Fiduciary (decides whether a DPO, DPIA and audits are mandatory)?
2. Legal bases under DPDP s.6/s.7 for each purpose in the §3 table; is "legitimate uses" right for safety scanning
   and fraud prevention?
3. Cross-border transfer: Bunny.net, Microsoft Azure (OpenAI, Speech, TTS), Sentry, Expo/Apple/Google push, Lemon
   Squeezy — which regions, and what the DPDP s.16 notification allows.
4. Buyer data shown to creators: the creator-side tax invoice carries the buyer's name, email and state
   (`commerce/support.py::_invoice`). Is that disclosure enough, or should the email be masked?
5. Face detection for clip reframing (`studio/faces.py`) only locates faces, never identifies them. Does it still
   count as biometric processing anywhere we operate (GDPR art. 9, BIPA)?
6. Backups: a monthly dump is kept for 7 years (`infra/backup-ship-rehearse.sh`). How does that square with the
   erasure right? Is "restored backups re-apply erasures" sufficient?
7. Breach notification wording and timing under the DPDP Rules.
8. GDPR: are we "established" or "targeting" the EU (Art. 3(2)) so that an Art. 27 representative is needed?
9. Product gap to fix before launch (not a legal question): "Download my data" and "Delete my account"
   (`backend/app/video/routers/me.py`) do not yet include or erase **live chat / super chat / gift messages**
   (`kv_social.live_messages`) or the **push log**. The policy lists only what export and erase cover today.

## Community Guidelines — `/legal/guidelines`

Placeholders
- The age-restriction standard (what must be marked age-restricted).

Open questions
1. IT Rules 2021 rule 3(1)(b) lists the categories users must be told not to post. Does the rule list cover them all
   (including content threatening the unity/integrity of India, impersonation, deepfakes per the 2023 advisory)?
2. Misinformation rule wording — acceptable scope?
3. Report reasons in the product are: spam, sexual, violence, hate, harassment, self_harm, child_safety, copyright,
   misinformation, scam, impersonation, other. Should the guidelines map one-to-one?

## Copyright & counter-notice — `/legal/copyright`

Placeholders
- Timelines vs. Copyright Rules 2013 r.75 (disable within 36 hours, 21-day window for a court order) and the
  IT Rules 72-hour requirement.
- What complainant details are shared with the uploader.
- Counter-notice waiting period (e.g. 21 days).
- Whether to follow the US DMCA counter-notice process and appoint a designated agent.
- Jurisdiction city (counter-notice consent).

Open questions
1. Product SLAs today (`TAKEDOWN_SLA_HOURS` in settings since run 4; was `routers/trust.py` `SLA`): acknowledge 24 h for every kind; resolve
   intimate imagery 24 h, court orders 36 h, copyright / IT Rules / other 15 days. Copyright r.75 expects action
   within 36 hours of a valid notice. Should the copyright SLA change?
2. **Built in run 4:** a dedicated counter-notice form (Account → Notices on the web, Moderation in the studio)
   with the DMCA §512(g) statements and a typed signature; it is mailed to the claimant with the uploader's name and
   address, and the video is restored after `COUNTER_NOTICE_RESTORE_DAYS` (10 business days, placeholder) unless an
   admin records that the claimant filed a court action. Confirm: the waiting period for India (no statutory
   counter-notice), whether to share the uploader's address with the claimant, and the 10–14 business-day US window.
3. Refunds to buyers when paid content is removed after a valid notice: mandatory, discretionary, or none?

## Grievance Officer — `/legal/grievance`

Placeholders
- Grievance Officer name, email and phone.
- The 72-hour removal-request category list.

Open questions
1. IT Rules rule 3(2) as amended in 2022: removal requests under rule 3(1)(b) must be resolved within 72 hours.
   The product's `it_rules` takedown kind is currently on a 15-day SLA — confirm which categories need 72 hours.
2. At what user count do Significant Social Media Intermediary duties start (Chief Compliance Officer, Nodal
   Contact Person, Resident Grievance Officer, monthly compliance reports)? Do we need to plan for them now?
3. Can the same person be the DPDP grievance contact and the IT Rules Grievance Officer?
4. GAC appeal window (30 days) and Data Protection Board wording — confirm.

## Creator Monetisation Terms — `/legal/monetisation`

Placeholders
- Minimum age for payouts (e.g. 18).
- Launch prices: tips ₹10–₹10,000; boosts ₹29/₹99/₹199; super chats ₹49/₹199/₹499; gifts Chai ₹19, Rose ₹49,
  Trophy ₹199 (`backend/app/video/commerce/support.py`, `TIP_MIN/MAX_MINOR` in `config.py`).
- Commission per plan: Creator Free 20%, Pro 10%, Business 8% (`db-scripts/02-reference-data.sql`,
  `commission_bps`), charged on the pre-tax value, GST on top.
- Payout schedule and any minimum payout.
- Buyer refund policy for memberships and paid videos.
- Notice period before commission/hold/reserve changes.

Open questions (CA and counsel)
1. GST on commission; TCS under CGST s.52 and TDS under s.194-O — rates, thresholds, and whether tips are in scope
   (the product charges no GST and no TCS on tips).
2. Issuing invoices / bills of supply in the creator's name (series `KVC`) as an e-commerce operator — confirm
   the mechanism and wording.
3. Holds: creator share held 7 days (`REFUND_WINDOW_DAYS`); reserve 5% for 30 days (`MARKETPLACE_RESERVE_*`).
   Acceptable under Razorpay Route's terms and the payment aggregator guidelines?
4. Recovery of refunds already paid out by netting against future sales — enforceable as drafted?
5. Is the "no per-view payouts / no ad revenue share" statement wise to put in the terms?
6. Creator money is India/INR only today; what changes when it opens abroad (merchant of record payouts)?

## Live Streaming Rules — `/legal/live`

Placeholders
- Which plans include live streaming (feature key `video.live`).
- Minimum age for a child to appear on stream without an adult.
- Rule on pre-recorded "premieres".
- Reporting individual live chat messages.

Open questions
1. Live streams cannot be scanned before broadcast (V08 applies to the replay only). Is reactive moderation plus
   platform stop enough for IT Rules due diligence on live content?
2. Refund on removal (decided in run 3): the channel owner **or a channel moderator** removing a super chat or gift
   refunds it in full automatically (`routers/live.py::moderate`). Confirm the wording; boosted danmaku still refunds
   only when the creator deletes it.
3. Viewers cannot report a single live chat message or a live stream today (report targets are video, comment,
   danmaku, channel). Is reporting the channel enough until that is built?
4. Recording consent: replays are on by default (`replay_enabled=true`). Should creators be reminded that guests
   on stream must agree to being recorded?
5. Live chat retention is 90 days after the stream (`backend/app/video/retention.py`); raw segments 24 hours.
   Do any law-enforcement preservation duties require longer?

## Run 4 additions — to confirm

**Advertising (V5.1)** — policy text needed for advertisers and creators.
- Creator share `ADS_CREATOR_SHARE_BPS` = 55% of ad spend on their own videos, paid monthly (placeholder; a commercial
  decision). It is a revenue share of real ad money, not a per-view rate (rule V10).
- GST on ad sales (platform invoice series `KVA`, `PLATFORM` rate) and the tax treatment of the creator's share
  (194-O? 194J/194C? GST on the creator's supply to Klygenix?) — **confirm with the CA** before any live ad money.
- Ads are never shown on embeds, reels, members-only or paid videos, the creator's own videos, or to Premium viewers;
  skippable after 5 s; mid-rolls only past 8 minutes. Creators opt in per channel and can turn ads off per video.
- Advertising standards: ASCI code, prohibited categories, the creative review rules admin applies.

**Sponsorships (V5.2)**
- Platform commission `SPONSORSHIP_COMMISSION_BPS` = 10% (placeholder). Creator's GST applies if they gave a GSTIN.
- Every deliverable carries "Paid partnership with {brand}" (ASCI influencer guidelines; FTC for US viewers).
  Confirm the wording and whether off-platform deals must also be declared by creators.
- Escrow terms: brand approves or the deal auto-approves 7 days after delivery; disputes decided by Klygenix.
  Needs brand terms and creator sponsorship terms.

**Closed beta** — waitlist and invite mails are transactional; confirm the privacy-notice wording for waitlist data
(kept until joined or removed).
