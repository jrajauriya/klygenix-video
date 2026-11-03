# Klygenix Play — store listing kit

Everything the App Store and Google Play ask for, written from what the app actually does.
**Not submitted**: both stores need the Apple Developer and Google Play accounts (blocked on the owner).
The icon in `apps/mobile/assets/` is a generated placeholder mark — replace it with the designed icon before
the first submission.

## Identity
| Field | Value |
|---|---|
| App name | Klygenix Play |
| Subtitle (iOS, 30) | Watch, ask and clip videos |
| Short description (Play, 80) | Videos and reels you can ask questions — with AI chapters, subtitles and live chat. |
| Bundle id / package | `com.klygenix.play` |
| Category | Photo & Video (iOS) · Video Players & Editors (Play) |
| Secondary category | Education (iOS) |
| Support URL | https://play.klygenix.com/legal/grievance |
| Privacy policy URL | https://play.klygenix.com/legal/privacy |
| Marketing URL | https://play.klygenix.com |
| Copyright | © 2026 Klygenix Technologies Private Limited |

## Description — English
Klygenix Play makes every video easier to learn from.

- **Ask the video** — type a question and get an answer that points to the exact second it was said.
- **Chapters, summaries and subtitles** — in English, Hindi, Marathi, Bengali, Tamil and Telugu.
- **Reels** — swipe through short videos; creators turn one long video into many reels.
- **Danmaku** — comments that fly across the video at the moment they were written.
- **Live** — watch creators live and chat with everyone watching.
- **Study tools** — notes, quizzes and flashcards made from the video, each linked to its moment.
- **Create** — record or pick a vertical video, upload it, and let AI suggest clips and captions.

Memberships, tips and paid videos are managed on the Klygenix Play website.

## Description — Hindi
Klygenix Play हर वीडियो से सीखना आसान बनाता है।

- **वीडियो से पूछें** — सवाल लिखें और ऐसा जवाब पाएँ जो ठीक उसी पल पर ले जाए जहाँ वह बात कही गई थी।
- **चैप्टर, सारांश और सबटाइटल** — अंग्रेज़ी, हिंदी, मराठी, बंगाली, तमिल और तेलुगु में।
- **रील्स** — छोटे वीडियो स्वाइप करें; क्रिएटर एक लंबे वीडियो से कई रील्स बनाते हैं।
- **दानमाकू** — कमेंट जो वीडियो पर उसी पल उड़ते हैं जब वे लिखे गए थे।
- **लाइव** — क्रिएटर्स को लाइव देखें और सबके साथ चैट करें।
- **पढ़ाई के टूल** — वीडियो से बने नोट्स, क्विज़ और फ़्लैशकार्ड, हर एक अपने पल से जुड़ा।
- **बनाएँ** — वर्टिकल वीडियो रिकॉर्ड करें या चुनें, अपलोड करें, और AI को क्लिप और कैप्शन सुझाने दें।

मेंबरशिप, टिप और पेड वीडियो Klygenix Play वेबसाइट पर संभाले जाते हैं।

## Keywords (iOS, 100 characters)
`video,reels,learn,ask,subtitles,hindi,live,chat,creator,clips,danmaku,notes,quiz,education`

## What's new (first release)
First release: reels, Ask the video, chapters and subtitles in six languages, danmaku, live, study tools and creating from your phone.

## Age rating
**Recommendation: 17+ (Apple) / Mature 17+ via IARC (Play).** It is an open user-generated-content platform with
live streaming and chat; the server enforces 18+ in India and 13+ elsewhere at sign-up (rule V13), so the listing
must not promise a younger audience. Questionnaire answers:
- User-generated content: **yes** — moderated (scan before publish, reports, moderators, strikes, takedowns), users can report and block.
- Live streaming: **yes**, with chat moderation.
- Unrestricted web access: **no** (links open the system browser).
- Gambling, contests, simulated gambling: **no**. Alcohol/tobacco/drugs references: **infrequent/mild (UGC)**. Mature themes: **infrequent/mild (UGC)**.
- In-app purchases: **none** in the app (memberships, tips and paid videos are on the web).
**Owner/lawyer decision:** final rating.

## App privacy (Apple) / Data safety (Google)
Collected and linked to the user; **not sold, not used for third-party advertising, no tracking across apps**:
| Data | Why | Optional |
|---|---|---|
| Name, email address | Account, sign-in, receipts | No |
| Date of birth | Age gate (server-side, V13) | No |
| Country, language | Prices, subtitles, feed language | No |
| Photos/videos (user content) | Videos the user uploads or records | Yes |
| Other user content | Comments, danmaku, live chat, notes, quiz answers | Yes |
| Product interaction | Watch history and progress (resume, recommendations), likes, follows | No |
| Search history | Search inside videos | Yes |
| Purchase history | Plans, memberships and purchases made on the web (shown in the app) | No |
| Device ID | Expo push token, only if notifications are allowed | Yes |
| Crash data / performance | Error reports (sentry-compatible, self-hosted ingest) | No |
Not collected: precise or coarse location, contacts, health, financial info in the app (payments happen on the web
with Razorpay / the merchant of record), browsing history outside the app, advertising identifier.
Data is encrypted in transit (TLS). Users can export their data and delete their account in the app's web account
page (`/account` → Privacy & data), which also covers the store's "account deletion" requirement — link:
https://play.klygenix.com/account.

## Permissions and their reasons
| Permission | Text shown | When |
|---|---|---|
| Camera | Record a vertical video for your channel. | Create tab, Go live |
| Microphone | Record sound with your video. | Create tab, Go live |
| Photo library (read) | Pick a video from your library to upload. | Create tab |
| Notifications | (system prompt) | After sign-in, once; settings in Profile |
Blocked on Android: location, image-only media access.

## Screenshots to take (6.7" iPhone, 6.1" iPhone, Android phone; English and Hindi)
1. Watch page with Ask open and a cited answer.
2. Reels feed.
3. Chapters + subtitles in Hindi.
4. Danmaku over a video.
5. Live with chat.
6. Study tab: quiz with a "watch this moment" link.
7. Create: clip suggestions on a long video.

## Review notes for Apple / Google
- Demo account: create one on staging before submitting (the local demo logins do not exist on the review server).
- Payments: the app sells nothing; Profile links to the website where allowed by the storefront's rules (V1.29).
- UGC safeguards: report on every video, comment, danmaku line, live message and channel; block via moderation;
  published content is scanned first (V08); grievance officer contact at /legal/grievance.

## Still needed before submission
Apple Developer and Google Play accounts · EAS project id (`eas init`) · push credentials (APNs key, FCM) via EAS ·
designed icon and screenshots · final age rating · a staging host and demo account for review · the lawyer-reviewed
privacy policy and terms at the URLs above.
