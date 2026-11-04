import { useState, type FormEvent, type ReactNode } from "react"
import { Link, NavLink } from "react-router-dom"
import { CheckCircle2, FileWarning } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { PageShell } from "../../components/Layout"
import { Btn, Field, INPUT, TEXTAREA } from "../../components/bits"
import { errText } from "../../lib/api"
import { longDate } from "../../lib/format"
import { useTitle } from "../../lib/title"

const NAV = [
  { to: "/legal/terms", label: "Terms of Service" },
  { to: "/legal/privacy", label: "Privacy Policy" },
  { to: "/legal/guidelines", label: "Community Guidelines" },
  { to: "/legal/copyright", label: "Copyright & counter-notice" },
  { to: "/legal/grievance", label: "Grievance Officer" },
  { to: "/legal/monetisation", label: "Creator Monetisation Terms" },
  { to: "/legal/live", label: "Live Streaming Rules" },
]

const COMPANY = "Klygenix Technologies Private Limited"
const DRAFTED = "3 November 2026"
const A = "text-brand-soft underline underline-offset-2"

function Ph({ children }: { children: ReactNode }) {
  return <mark className="rounded bg-[#FACC15] px-1 font-semibold text-black">[PLACEHOLDER: {children}]</mark>
}

function L({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className={A}>{children}</Link>
}

function DraftBanner() {
  return (
    <div role="note" className="mt-4 flex gap-3 rounded-2xl border border-[#FACC15]/60 bg-[#422006] p-4 text-sm text-[#fef3c7]">
      <FileWarning size={20} className="mt-0.5 shrink-0 text-[#FACC15]" aria-hidden="true" />
      <div>
        <p className="font-bold text-[#fde68a]">Draft — pending legal review</p>
        <p className="mt-1 leading-relaxed">This text has not yet been reviewed by a lawyer and may change before Klygenix Play launches. It describes how the product works today. Items marked <span className="rounded bg-[#FACC15] px-1 font-semibold text-black">[PLACEHOLDER]</span> are still to be decided or filled in.</p>
      </div>
    </div>
  )
}

function S({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Table({ head, rows }: { head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="bg-panel-2 text-muted">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(([a, b], i) => (
            <tr key={i}><td className="px-4 py-2.5 align-top font-medium text-ink">{a}</td><td className="px-4 py-2.5 align-top">{b}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  useTitle(title)
  return (
    <PageShell className="max-w-6xl">
      <div className="grid gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label="Legal" className="-mx-3 flex gap-1 overflow-x-auto px-3 scrollbar-none lg:mx-0 lg:flex-col lg:px-0">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => cn("shrink-0 rounded-full px-3.5 py-2 text-sm lg:rounded-xl", isActive ? "bg-brand/25 font-semibold text-white" : "text-muted hover:bg-white/5 hover:text-ink")}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <article className="min-w-0 max-w-3xl">
          <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
          <p className="mt-1 text-xs text-faint">Draft of {DRAFTED} · Effective date: <Ph>effective date</Ph></p>
          <DraftBanner />
          <div className="mt-6 space-y-7 text-[15px] leading-relaxed text-ink/85 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink [&_h3]:mt-3 [&_h3]:font-semibold [&_h3]:text-ink [&_ul>li]:ml-5 [&_ul>li]:list-disc [&_ul>li]:pl-1 [&_ul]:space-y-1.5">
            {children}
          </div>
        </article>
      </div>
    </PageShell>
  )
}

function Company() {
  return (
    <>{COMPANY}, a company incorporated in India (CIN <Ph>CIN</Ph>), with its registered office at <Ph>registered address</Ph></>
  )
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <p>These Terms of Service are an agreement between you and <Company /> ("Klygenix", "we", "us"). They cover Klygenix Play on the web at play.klygenix.com, our mobile apps, and Klygenix Studio, together "the Service". By creating an account or using the Service you agree to these terms.</p>
      <p>These policies are part of the terms: the <L to="/legal/privacy">Privacy Policy</L>, the <L to="/legal/guidelines">Community Guidelines</L>, the <L to="/legal/copyright">Copyright policy</L>, the <L to="/legal/monetisation">Creator Monetisation Terms</L> (if you earn money on Klygenix Play) and the <L to="/legal/live">Live Streaming Rules</L> (if you stream or chat live).</p>

      <S title="1. Who can use Klygenix Play">
        <p>Anyone can watch public videos without an account. To open an account you must be at least:</p>
        <ul>
          <li>18 years old if you live in India;</li>
          <li>16 years old in Germany, the Netherlands, Ireland, Luxembourg, Slovakia, Hungary, Romania, Croatia and Poland;</li>
          <li>13 years old everywhere else.</li>
        </ul>
        <p>We ask for your date of birth and country at sign-up and check the minimum age on our servers. Some videos are age-restricted and are only shown to signed-in adults. You must not open an account for someone else or give a false date of birth.</p>
      </S>

      <S title="2. Your account">
        <ul>
          <li>Keep your password safe. You are responsible for what happens under your account until you tell us it has been compromised.</li>
          <li>One person per account. Do not sell, rent, share or transfer accounts or channels.</li>
          <li>Every account gets its own private workspace. If you open a channel, your channel, videos and earnings belong to that workspace.</li>
          <li>You can delete your account at any time under <L to="/account?tab=privacy">Account → Privacy &amp; data</L>. A paid plan must be cancelled first.</li>
        </ul>
      </S>

      <S title="3. What you post and the licence you give us">
        <p>You keep ownership of the videos, reels, thumbnails, comments, danmaku (bullet comments), live chat messages, community posts and other content you post. When you upload a video you confirm that you made it or hold all the rights needed to publish it, including the music in it.</p>
        <p>You give Klygenix a worldwide, non-exclusive, royalty-free licence to host, store, encode, transcode, stream, caption, transcribe, translate, dub (only where you allow it), summarise, index for search, cut into clip suggestions and show your content on the Service, and to show links and thumbnails to it, for as long as it is on the Service. The licence ends when you delete the content, except for copies kept in backups for the period described in the Privacy Policy and copies we must keep by law or for an open dispute.</p>
        <p>If you go live with replays turned on, you also allow us to record the stream and publish the recording as a video on your channel.</p>
      </S>

      <S title="4. Videos from YouTube and Bilibili">
        <p>Creators can show videos from their own YouTube or Bilibili channel on Klygenix Play. Those videos play in the official player of that platform, under its terms. We never draw anything over another platform's player, we always credit and link the source, and you cannot pay for, tip on or boost an embedded video. AI features on embedded videos use only captions the channel owner has imported.</p>
      </S>

      <S title="5. AI features">
        <p>Klygenix Play uses artificial intelligence to make transcripts, chapters, summaries, search inside videos, answers to questions you ask a video ("Ask"), clip suggestions, title and thumbnail ideas, study notes and quizzes, translations of comments, and dubbed audio tracks.</p>
        <ul>
          <li>AI output can be wrong or incomplete. Check anything important against the video itself. AI output is not professional, medical, legal or financial advice.</li>
          <li>Every Ask answer cites the moments in the video it is based on. If the video does not cover your question, Ask says so instead of guessing.</li>
          <li>Dubbed audio is only made when the creator has given consent for that video, and it is labelled "AI-dubbed".</li>
          <li>Creators must label videos that are made or materially changed with AI. AI-made content is shown with an "AI-generated" label.</li>
          <li>We send the text needed for each feature to our AI providers. We do not allow them to use your content to train their own models. <Ph>confirm against the AI provider contracts</Ph></li>
        </ul>
      </S>

      <S title="6. Using the Service fairly">
        <p>Follow the <L to="/legal/guidelines">Community Guidelines</L>. In addition, you must not:</p>
        <ul>
          <li>copy, download or re-host videos except through features we provide, or get around paywalls, members-only locks, age gates or region limits;</li>
          <li>inflate views, likes, follows or comments with bots, scripts, paid schemes or multiple accounts;</li>
          <li>scrape the Service, overload it, probe it for weaknesses or interfere with its security;</li>
          <li>impersonate another person, channel or brand, or mislead people about who is behind a channel;</li>
          <li>use the Service for anything unlawful in India or in the place where you are.</li>
        </ul>
      </S>

      <S title="7. Plans and payments">
        <ul>
          <li>Viewer Premium and creator plans renew every month until you cancel. Cancelling keeps the plan until the end of the period you have paid for.</li>
          <li>Prices are shown before you pay and include the taxes that apply. In India, payments are processed by Razorpay and you get a GST tax invoice from Klygenix. Outside India, a merchant of record sells the plan to you, charges local tax and issues the receipt, and its own terms also apply to the payment.</li>
          <li>We do not see or store your full card, UPI or bank details.</li>
          <li>Plan fees are not refunded for part of a period, except where the law requires it. <Ph>confirm plan refund policy</Ph></li>
          <li>Plans include usage limits (for example AI minutes and clip renders). When a limit is reached, the feature pauses until the next period or an upgrade.</li>
        </ul>
      </S>

      <S title="8. Paying creators">
        <p>You can support creators with tips, boosted danmaku, memberships, paid videos and series, and live super chats and gifts. These payments are only available in India, in rupees, and only on videos hosted on Klygenix Play. You pay the creator; Klygenix collects the payment as an e-commerce operator, keeps a platform commission and passes the rest to the creator. <Ph>confirm legal characterisation of the marketplace with counsel and CA</Ph></p>
        <ul>
          <li>Tips are gifts to the creator and are not refundable.</li>
          <li>If a creator deletes a boost, super chat or gift you paid for, you are refunded in full automatically.</li>
          <li>Memberships last 30 days per payment. Paid videos and series stay available while they remain on the Service. If a payment is refunded, the access it bought ends.</li>
          <li>Klygenix does not pay creators per view.</li>
        </ul>
        <p>Creators who sell must also accept the <L to="/legal/monetisation">Creator Monetisation Terms</L>.</p>
      </S>

      <S title="9. Safety, enforcement and appeals">
        <p>Uploads are scanned automatically before they are published. An upload the scan flags is held until a moderator reviews it. Anyone can report a video, comment, danmaku or channel. We may remove or restrict content, add labels, give a channel a strike, disable features such as live streaming, or suspend accounts that break these terms or the law. Strikes expire after 90 days; a channel with three active strikes is suspended.</p>
        <p>When we act on your content or account, you will see a notice under <L to="/account?tab=notices">Account → Notices</L> with the reason, and you can appeal it there. A person reviews every appeal. We may also act on court orders and lawful government directions and report illegal content, such as child sexual abuse material, to the authorities.</p>
      </S>

      <S title="10. Copyright">
        <p>Rights holders can send a notice on our <L to="/legal/copyright">Copyright page</L>. Channels that repeatedly infringe are closed.</p>
      </S>

      <S title="11. Ending the agreement">
        <p>You can stop using the Service and delete your account at any time. We may suspend or close an account that seriously or repeatedly breaks these terms, puts others at risk, or where the law requires it. Where we can, we will tell you why and give you a chance to appeal and to download your data first. Sections that by their nature should survive (licences for content already shared in a way others relied on, payments due, liability and disputes) survive termination.</p>
      </S>

      <S title="12. Disclaimers and liability">
        <p>The Service is provided "as is" and "as available". We work hard to keep it running and accurate, but we do not promise it will be uninterrupted or error-free, or that AI output will be correct. To the extent the law allows, Klygenix is not liable for indirect or consequential loss, and our total liability to you for any claim is limited to the greater of the amount you paid us in the twelve months before the claim and <Ph>liability cap amount in INR</Ph>. Nothing in these terms limits liability that cannot be limited by law, or your rights as a consumer.</p>
        <p>You are responsible for the content you post. You agree to compensate Klygenix for losses and reasonable costs arising from a third-party claim that your content or conduct broke these terms or the law. <Ph>confirm indemnity scope for consumers</Ph></p>
      </S>

      <S title="13. Changes to these terms">
        <p>We may update these terms as the Service changes or the law requires. For material changes we will tell you in the app or by email at least <Ph>notice period, e.g. 30 days</Ph> before they take effect. If you keep using the Service after that, the new terms apply.</p>
      </S>

      <S title="14. Law and disputes">
        <p>These terms are governed by the laws of India. Subject to the next sentence, the courts at <Ph>jurisdiction city</Ph> have exclusive jurisdiction. If you live outside India, you keep the protection of the mandatory consumer laws of your country. <Ph>decide whether to include an arbitration clause</Ph></p>
      </S>

      <S title="15. Contact">
        <p>{COMPANY}, <Ph>registered address</Ph>. GSTIN <Ph>GSTIN</Ph>. Questions about these terms: <Ph>legal contact email</Ph>. Complaints: see the <L to="/legal/grievance">Grievance Officer</L> page.</p>
      </S>
    </LegalShell>
  )
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <p>This policy explains what personal data <Company /> collects when you use Klygenix Play, why, who we share it with, how long we keep it, and your rights. Klygenix is the data fiduciary under India's Digital Personal Data Protection Act, 2023 ("DPDP Act") and, for people in the European Union, the controller under the GDPR.</p>

      <S title="1. Contact">
        <ul>
          <li>Privacy questions and requests: <Ph>privacy contact email</Ph></li>
          <li>Data Protection Officer: <Ph>DPO name and contact</Ph></li>
          <li>Grievance Officer: see the <L to="/legal/grievance">Grievance Officer</L> page.</li>
          <li>Representative in the European Union: <Ph>EU representative, if required</Ph></li>
        </ul>
      </S>

      <S title="2. What we collect">
        <h3>You give us</h3>
        <ul>
          <li><strong>Account:</strong> name, email, password (stored only as a hash), date of birth, country, language and, if you add one, phone number.</li>
          <li><strong>Profile and channel:</strong> display name, avatar, banner, channel name, handle and description.</li>
          <li><strong>Content:</strong> videos, reels, thumbnails, titles, descriptions, comments, danmaku, live chat messages, community posts, polls, playlists, notes and quiz answers.</li>
          <li><strong>Questions you ask:</strong> questions to Ask (a video, a channel or a series) and the answers.</li>
          <li><strong>Payments:</strong> what you bought, amount, taxes, your state (for GST) and payment status. Card, UPI and bank details stay with the payment provider.</li>
          <li><strong>Creator payouts:</strong> legal name, PAN, GSTIN if you have one, bank account and the KYC details our payout partner (Razorpay Route) needs.</li>
          <li><strong>Reports, notices and appeals</strong> you send us, including takedown notices from people without an account.</li>
          <li><strong>Connected accounts:</strong> if you connect YouTube, the access tokens and the channel and video details we need to list your own videos and import their captions.</li>
        </ul>
        <h3>We collect when you use the Service</h3>
        <ul>
          <li><strong>Activity:</strong> videos watched and how far, likes, follows, history, how you arrived at a video (for creators' traffic reports), live streams joined, and memberships.</li>
          <li><strong>Device and logs:</strong> IP address, browser or app version, push notification tokens, and error reports with personal data removed before they are sent.</li>
        </ul>
        <h3>We make from your content</h3>
        <ul>
          <li>Transcripts, captions, chapters, summaries, search vectors, translations, clip suggestions and dubbed audio. To reframe clips to vertical video we detect where faces are in a frame; we do not identify who they are.</li>
        </ul>
      </S>

      <S title="3. Why we use it">
        <Table
          head={["Purpose", "Legal basis"]}
          rows={[
            ["Run your account, play videos, remember where you stopped, show your Following feed and notifications", "Your consent and the contract with you (GDPR: contract)"],
            ["AI features you use: transcripts, Ask, translation, study tools, clips, dubbing", "Your consent (GDPR: contract)"],
            ["Recommendations and the For you feed, based on what you watch", <>Your consent (GDPR: legitimate interests) <Ph>confirm basis</Ph></>],
            ["Bill plans and creator sales, issue invoices, keep tax records, pay creators", "Legal obligation and contract"],
            ["Safety: scans, moderation, age checks, fraud and abuse prevention, security logs", "Legitimate uses under the DPDP Act and legal obligation (GDPR: legitimate interests)"],
            ["Answer court orders and lawful requests", "Legal obligation"],
          ]}
        />
        <p>You can withdraw consent at any time. Withdrawing does not affect what was done before, and some features stop working without the data they need.</p>
      </S>

      <S title="4. AI processing and automated decisions">
        <ul>
          <li>Speech in hosted videos is sent to a speech-to-text provider. Transcript passages, your question and the video title are sent to a language-model provider to answer Ask; your name and email are not sent.</li>
          <li>Ask history is kept for 365 days. Translations of comments and danmaku are cached for 180 days.</li>
          <li>Uploads are scanned automatically. A scan can hold a video for human review, but a person makes the final decision to remove content or give a strike, and you can appeal any decision.</li>
          <li>We do not make decisions with legal or similarly significant effects about you by automated means alone.</li>
        </ul>
      </S>

      <S title="5. Who sees it and who we share it with">
        <ul>
          <li><strong>Everyone:</strong> your public profile, channel, published videos, comments, danmaku, live chat messages, super chats and gifts (with your display name).</li>
          <li><strong>Creators you pay:</strong> your name, email and state appear on the tax invoice issued for your purchase, which the creator can see. Creators see analytics only as totals.</li>
          <li><strong>Service providers</strong> who process data for us under contract: video hosting and delivery (Bunny.net), AI and speech services (Microsoft Azure), payments (Razorpay in India; a merchant of record abroad), payouts (Razorpay Route), email (Microsoft 365), push notifications (Expo, Apple and Google), error reporting (Sentry), content safety scanning <Ph>safety vendor</Ph>, and encrypted backups <Ph>backup provider and region</Ph>.</li>
          <li><strong>Platforms you connect:</strong> YouTube (Google) when you link your channel or publish a clip there.</li>
          <li><strong>Authorities:</strong> when the law requires it, for example a court order or a lawful request under Indian law.</li>
          <li><strong>A buyer of our business</strong>, under the same protections, if Klygenix is reorganised or sold.</li>
        </ul>
        <p>We do not sell personal data and we do not show third-party advertising. <Ph>confirm advertising plans</Ph></p>
      </S>

      <S title="6. Where your data is stored">
        <p>Our database and servers are in India. Some providers process data in other countries <Ph>list provider regions</Ph>. When data leaves India we do so only where the DPDP Act allows it and, for EU users, under safeguards such as standard contractual clauses.</p>
      </S>

      <S title="7. How long we keep it">
        <Table
          head={["Data", "Kept for"]}
          rows={[
            ["Account, profile and channel", "Until you delete your account"],
            ["Ask questions and answers; quiz attempts", "365 days"],
            ["Push notification log", "90 days"],
            ["Live chat, super chat and gift messages", "90 days after the stream ends"],
            ["Live stream recording segments", "24 hours after the stream ends (a replay, if turned on, becomes an ordinary video)"],
            ["Comment and danmaku translations", "180 days"],
            ["Deleted videos", "Removed from view at once; media purged from the video host within 30 days"],
            ["Invoices, payments, payouts and tax records", <>As long as tax law requires <Ph>confirm period, e.g. 8 years</Ph></>],
            ["Backups", <>Encrypted; a monthly backup is kept for up to 7 years <Ph>confirm backup retention against erasure duties</Ph></>],
            ["Security logs", <Ph>log retention period</Ph>],
          ]}
        />
      </S>

      <S title="8. Your rights">
        <p>You can do most of this yourself under <L to="/account?tab=privacy">Account → Privacy &amp; data</L>, or write to us.</p>
        <ul>
          <li><strong>Access and a copy:</strong> "Download my data" gives you a file with your account, profile, channel, follows, likes, watch history, comments, danmaku, questions, playlists, plans, payments, reports and appeals.</li>
          <li><strong>Correction:</strong> edit your profile, or ask us to correct anything else.</li>
          <li><strong>Erasure:</strong> "Delete my account" erases your email, name, password, phone number, likes, follows, watch history, questions and device tokens, and blanks the text of your comments and danmaku (they show as from a deleted user). If you have a channel, it is closed and its videos are removed. Invoices and payment records are kept because tax law requires it.</li>
          <li><strong>Withdraw consent</strong> and <strong>nominate</strong> someone to exercise your rights if you die or become unable to.</li>
          <li><strong>Grievance:</strong> complain to our Grievance Officer and, if you are not satisfied, to the Data Protection Board of India.</li>
          <li><strong>In the EU:</strong> you also have the rights to restrict or object to processing, to data portability, and to complain to your local supervisory authority.</li>
        </ul>
        <p>We reply within <Ph>response time for rights requests</Ph>.</p>
      </S>

      <S title="9. Children">
        <p>Accounts are not available below the minimum age for your country (18 in India, 16 in some EU countries, 13 elsewhere). We do not knowingly collect data from children below that age, and we do not track or target advertising at children. If you believe a child has an account, report it and we will close it.</p>
      </S>

      <S title="10. Security">
        <p>Data is encrypted in transit. Passwords are hashed and secrets are sealed. Each workspace's data is isolated in the database, staff access is limited by role and recorded in an audit log, and backups are encrypted and kept off the server. If a breach affects your data we will tell you and the Data Protection Board as the law requires.</p>
      </S>

      <S title="11. Cookies and local storage">
        <p>The web app stores your sign-in session and preferences (such as danmaku settings and translation language) in your browser's local storage. We do not use advertising cookies or cross-site trackers. The Razorpay checkout loads its own script only when you pay. <Ph>confirm whether any analytics will be added</Ph></p>
      </S>

      <S title="12. Changes">
        <p>We will post changes here and tell you in the app or by email before material changes take effect.</p>
      </S>
    </LegalShell>
  )
}

const RULES: [string, string][] = [
  ["Child safety: zero tolerance", "Any content that sexualises, endangers or exploits minors is removed, the account is closed, and we report it to the authorities. Report it with the “Child safety” reason and it is reviewed first."],
  ["No adult or sexual content", "No nudity, pornography or sexually explicit material, including in thumbnails, titles, comments, danmaku, live streams and live chat."],
  ["No hate", "No content that attacks or demeans people for religion, caste, race, ethnicity, nationality, gender, sexual orientation, disability or similar traits."],
  ["No harassment or doxxing", "No bullying, threats, sharing someone's private details, or targeting a person with repeated unwanted comments, danmaku or chat messages. Paying for a super chat or boost does not make harassment acceptable."],
  ["No violence, self-harm or dangerous acts", "No graphic violence for shock value, terrorism, or instructions or challenges that could seriously hurt people. Content about self-harm must not encourage it; if someone is at risk, report it with the “Self-harm” reason."],
  ["No scams, spam or fake engagement", "No fake giveaways, phishing, investment or “guaranteed returns” schemes, pyramid schemes, misleading links, buying views or follows, or repetitive and off-topic posting. Links are not allowed in danmaku or live chat."],
  ["No harmful misinformation", "No content that is false and likely to cause real harm, such as fake medical cures, election falsehoods or doctored footage of real events presented as genuine."],
  ["No impersonation", "Do not pretend to be another person, creator, brand or official body."],
  ["Respect copyright and use licensed audio", "Upload only what you made or have permission to use. Music must be yours, licensed to you, or from the Studio music library. Rights holders can file a notice on our copyright page. Repeat infringement closes channels."],
  ["Label AI-generated content", "If a video is made or materially changed with AI, mark it as AI-generated when you upload. Never use synthetic media or cloned voices to impersonate a real person or mislead about real events. Dubbing a video needs the creator's consent and is labelled “AI-dubbed”."],
  ["Danmaku and chat etiquette", "Keep danmaku and live chat short, on topic and kind. No spoiler flooding and no personal attacks. Viewers can block words and hide danmaku at any time; creators and their moderators can remove messages."],
]

export function GuidelinesPage() {
  return (
    <LegalShell title="Community Guidelines">
      <p>Klygenix Play is for learning, making and enjoying videos together. These rules apply to everything on the Service: videos, reels, live streams, thumbnails, titles, descriptions, comments, danmaku, live chat, super chats and gifts, community posts and channels. They apply whether the content is free, members-only or paid.</p>
      <ol className="space-y-3">
        {RULES.map(([title, body], i) => (
          <li key={title} className="flex gap-4 rounded-2xl border border-line bg-panel p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/25 text-sm font-bold text-brand-soft">{i + 1}</span>
            <div>
              <p className="font-semibold text-ink">{title}</p>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <S title="Age-restricted content">
        <p>Content that is allowed but not suitable for younger viewers, for example strong language or mature themes, must be marked as age-restricted. It is only shown to signed-in viewers who meet the age limit. <Ph>confirm the age-restriction standard</Ph></p>
      </S>
      <S title="How we check content">
        <ul>
          <li>Every upload is scanned before it is published. If the scan flags it, a moderator reviews it first; nothing flagged goes public on the scan's word alone.</li>
          <li>Live streams cannot be checked in advance. They are moderated by the creator, their moderators and our team, and we can stop a stream at any time. Live replays are scanned like any other upload.</li>
          <li>Anyone can report a video, comment, danmaku or channel with the Report button.</li>
        </ul>
      </S>
      <S title="What happens when rules are broken">
        <p>Depending on how serious it is, we may hide or remove the content, add a label or age restriction, restrict features such as comments, monetisation or live streaming, give the channel a strike, or suspend the account. Strikes expire after 90 days; three active strikes suspend the channel. The most serious violations, such as child sexual abuse material, close the account at once.</p>
        <p>You will see every action under <L to="/account?tab=notices">Account → Notices</L> and can appeal it there. A person reviews every appeal.</p>
      </S>
    </LegalShell>
  )
}

const KINDS = [
  { key: "copyright", label: "Copyright infringement" },
  { key: "it_rules", label: "Unlawful content (IT Rules, 2021)" },
  { key: "intimate", label: "Non-consensual intimate imagery" },
  { key: "court_order", label: "Court or government order" },
  { key: "other", label: "Something else" },
]

export function CopyrightPage() {
  const [form, setForm] = useState({ kind: "copyright", complainant_name: "", complainant_email: "", target_url: "", details: "", sworn: false })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState<{ reference: string; ack_due_at: string | null; resolve_due_at: string | null } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError("")
    setPending(true)
    try {
      const { data } = await api.post("/api/video/takedowns", { ...form, target_url: form.target_url.trim(), details: form.details.trim() })
      setDone(data)
    } catch (err) {
      setError(errText(err, "The notice could not be filed. Check the fields and try again."))
    } finally {
      setPending(false)
    }
  }

  return (
    <LegalShell title="Copyright & counter-notice">
      <p>Klygenix Play respects copyright and expects its users to do the same. Creators confirm at upload that they hold the rights to what they publish, including the music. This page explains how rights holders can ask us to remove content, and how creators can respond.</p>

      <S title="1. Sending a notice">
        <p>Your notice should include:</p>
        <ul>
          <li>your name and contact details, and whether you are the rights holder or act for them;</li>
          <li>a description of the original work, with a link to it if you can;</li>
          <li>the link to the content on Klygenix Play (for a video, its /watch/ link) and, for long videos, the time where the infringement appears;</li>
          <li>a statement in good faith that the use is not authorised and that the information in the notice is accurate.</li>
        </ul>
        <p>We acknowledge every notice within 24 hours. Non-consensual intimate imagery is held from view as soon as the notice arrives and handled within 24 hours, court and government orders within 36 hours, and other notices within 15 days. <Ph>confirm timelines against Copyright Rules 2013 r.75 (36 hours, 21-day court order window) and the IT Rules 72-hour requirement</Ph></p>
      </S>

      {done ? (
        <div className="rounded-2xl border border-[#166534] bg-[#052e16]/60 p-5">
          <p className="flex items-center gap-2 font-semibold text-[#bbf7d0]"><CheckCircle2 size={18} aria-hidden="true" /> Notice received</p>
          <p className="mt-2 text-sm">Your reference is <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono font-semibold">{done.reference}</span>. Keep it for any follow-up.</p>
          <p className="mt-2 text-sm text-muted">We will acknowledge it by {longDate(done.ack_due_at)} and resolve it by {longDate(done.resolve_due_at)}.</p>
          <Btn tone="soft" size="sm" className="mt-4" onClick={() => { setDone(null); setForm({ ...form, target_url: "", details: "", sworn: false }) }}>File another notice</Btn>
        </div>
      ) : (
        <form onSubmit={submit} aria-label="Takedown notice" className="space-y-4 rounded-2xl border border-line bg-panel p-4 sm:p-6">
          <Field label="Type of notice">
            <select className={INPUT} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your full name">
              <input className={INPUT} value={form.complainant_name} onChange={(e) => setForm({ ...form, complainant_name: e.target.value })} required maxLength={120} autoComplete="name" />
            </Field>
            <Field label="Your email">
              <input className={INPUT} type="email" value={form.complainant_email} onChange={(e) => setForm({ ...form, complainant_email: e.target.value })} required autoComplete="email" />
            </Field>
          </div>
          <Field label="Link to the content on Klygenix Play" hint="For example https://play.klygenix.com/watch/abc123">
            <input className={INPUT} type="url" value={form.target_url} onChange={(e) => setForm({ ...form, target_url: e.target.value })} required placeholder="https://" />
          </Field>
          <Field label="Details" hint="Describe the original work you own and what in the content infringes it, with links to the original if you can.">
            <textarea className={TEXTAREA} rows={6} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} required minLength={20} maxLength={5000} />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={form.sworn} onChange={(e) => setForm({ ...form, sworn: e.target.checked })} required className="mt-1 h-4 w-4 accent-[#A21CAF]" />
            <span>I state in good faith that the information in this notice is accurate and that I am the rights holder or authorised to act for them. I understand that false notices can have legal consequences.</span>
          </label>
          {error && <p role="alert" className="rounded-xl border border-[#7f1d1d] bg-[#450a0a]/60 px-3 py-2 text-sm text-[#fecaca]">{error}</p>}
          <Btn type="submit" tone="brand" disabled={pending || !form.sworn}>{pending ? "Sending…" : "File notice"}</Btn>
        </form>
      )}

      <S title="2. What happens next">
        <ul>
          <li>We review the notice. If it is complete and the claim is plausible, we remove or disable the content and tell the uploader, with the reason and the complainant's name. <Ph>confirm what complainant details are shared with the uploader</Ph></li>
          <li>A valid copyright removal gives the channel a strike. Strikes expire after 90 days; three active strikes suspend the channel.</li>
          <li>Money paid for content that is removed after a valid notice may be refunded to buyers and recovered from the creator under the Creator Monetisation Terms.</li>
          <li>Incomplete or clearly abusive notices are rejected. Sending false notices can make you liable for the harm caused.</li>
        </ul>
      </S>

      <S title="3. Counter-notice">
        <p>If your content was removed and you believe that was a mistake, or that you have the rights or a lawful defence such as fair dealing, you can send a counter-notice. Open <L to="/account/notices">Account → Copyright notices</L>, find the notice and choose File a counter-notice. The form asks for:</p>
        <ul>
          <li>your full name, postal address, phone number and email;</li>
          <li>why you believe the removal was a mistake or that you have the right to use the material;</li>
          <li>a statement under penalty of perjury that you have a good faith belief the material was removed by mistake or misidentification;</li>
          <li>your consent to the jurisdiction of the court for your address, and that you will accept service from the person who sent the notice <Ph>confirm jurisdiction wording</Ph>;</li>
          <li>your signature, which is your full name typed again.</li>
        </ul>
        <p>Other moderation decisions, such as removals for breaking the Community Guidelines, are appealed under <L to="/account?tab=notices">Account → Notices</L> instead.</p>
        <p>We send the counter-notice to the complainant. Unless the complainant tells us within <Ph>counter-notice waiting period, e.g. 21 days</Ph> that they have started court proceedings, we may restore the content and lift the strike. <Ph>decide whether to also follow the US DMCA counter-notice process and appoint a designated agent</Ph></p>
      </S>

      <S title="4. Embedded videos">
        <p>Videos embedded from YouTube or Bilibili are hosted by those platforms. You can ask us to remove the embed here, and you should also send your notice to the platform that hosts the video.</p>
      </S>
    </LegalShell>
  )
}

export function GrievancePage() {
  const rows: [string, ReactNode][] = [
    ["Name", <Ph>grievance officer name</Ph>],
    ["Designation", "Grievance Officer, Klygenix Play"],
    ["Email", <Ph>grievance officer email</Ph>],
    ["Phone", <Ph>grievance officer phone</Ph>],
    ["Address", <><Company /></>],
    ["Working hours", "Monday to Friday, 10:00 to 18:00 IST, except public holidays"],
  ]
  return (
    <LegalShell title="Grievance Officer">
      <p>Under the Information Technology Act, 2000, the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 and the Digital Personal Data Protection Act, 2023, {COMPANY} has appointed a Grievance Officer for Klygenix Play. You can contact the Grievance Officer about content on the Service, about these policies, or about how we handle your personal data.</p>
      <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[160px_1fr]">
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="text-sm font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <S title="How to complain">
        <p>Write to the Grievance Officer with your name and contact details, the link to the content or the account concerned, what the problem is, and what you would like us to do. If you have already reported it, include the report or notice reference.</p>
        <p>For a specific video, comment, danmaku or channel, the fastest route is the Report button next to it. For copyright, use the <L to="/legal/copyright">takedown form</L>. For a decision about your own content, appeal under <L to="/account?tab=notices">Account → Notices</L>.</p>
      </S>
      <S title="Response times">
        <ul>
          <li><strong>Acknowledgement:</strong> within 24 hours.</li>
          <li><strong>Resolution:</strong> within 15 days.</li>
          <li><strong>Removal requests</strong> about content that is unlawful under the IT Rules: within 72 hours. <Ph>confirm the 72-hour category list</Ph></li>
          <li><strong>Non-consensual intimate imagery</strong>, including morphed images: acted on within 24 hours.</li>
        </ul>
      </S>
      <S title="If you are not satisfied">
        <p>You may appeal our Grievance Officer's decision to the Grievance Appellate Committee set up by the Government of India, within 30 days of receiving it. For personal data complaints you may also approach the Data Protection Board of India once you have used our grievance process.</p>
      </S>
    </LegalShell>
  )
}

export function MonetisationPage() {
  return (
    <LegalShell title="Creator Monetisation Terms">
      <p>These terms apply when you earn money on Klygenix Play. They add to the <L to="/legal/terms">Terms of Service</L> and the <L to="/legal/guidelines">Community Guidelines</L>; if they conflict on a money matter, these terms apply.</p>

      <S title="1. Who can earn">
        <ul>
          <li>You need a channel in good standing (not suspended) and an activated payout account. Activation means completing KYC with our payout partner, Razorpay Route: your legal name, PAN, bank account and, if you are registered, your GSTIN.</li>
          <li>Selling is available in India, in rupees, only. <Ph>minimum age for payouts, e.g. 18</Ph></li>
          <li>You can only earn on videos hosted on Klygenix Play. Videos embedded from YouTube or Bilibili cannot be tipped, boosted or sold.</li>
          <li>You cannot buy from your own channel.</li>
        </ul>
      </S>

      <S title="2. Ways to earn">
        <Table
          head={["What", "How it works"]}
          rows={[
            ["Tips", "A viewer chooses an amount (currently ₹10 to ₹10,000) and may add a message, shown as a highlighted comment. Tips are not refundable."],
            ["Boosted danmaku", "A viewer pays a fixed tier price (currently ₹29, ₹99 or ₹199) to pin a short line over your video for 5, 10 or 20 seconds."],
            ["Memberships", "You set monthly tiers, prices and perks. Each payment gives 30 days of access to members-only videos, posts and live streams at that tier and below."],
            ["Paid videos and series", "You set a one-time price. The buyer keeps access while the video or series stays on the Service. Viewers without access see a short preview."],
            ["Super chats", "During a live stream a viewer pays a tier price (currently ₹49, ₹199 or ₹499) to pin a message at the top of the chat for 30 seconds, 2 minutes or 5 minutes."],
            ["Live gifts", "During a live stream a viewer sends a gift (currently Chai ₹19, Rose ₹49 or Trophy ₹199) that shows in the chat."],
          ]}
        />
        <p>Prices for fixed tiers and gifts are set by Klygenix and may change; the price shown at checkout applies. <Ph>confirm launch prices</Ph></p>
        <p>Klygenix does not pay per view and does not share advertising revenue. Your earnings come only from what viewers choose to pay you.</p>
      </S>

      <S title="3. Platform commission">
        <p>Klygenix keeps a commission on each sale, as a percentage of the sale's value before tax. The rate depends on your creator plan:</p>
        <Table
          head={["Creator plan", "Commission"]}
          rows={[
            ["Creator Free", <>20% <Ph>confirm</Ph></>],
            ["Creator Pro", <>10% <Ph>confirm</Ph></>],
            ["Creator Business", <>8% <Ph>confirm</Ph></>],
          ]}
        />
        <p>GST is charged on the commission. The rate in force on the day of the sale applies; we will give notice before raising it. Studio shows your current rate.</p>
      </S>

      <S title="4. Tax">
        <ul>
          <li>Klygenix issues the tax invoice (or bill of supply) to the buyer on your behalf, in your name, for every sale except tips.</li>
          <li>If you gave us a GSTIN, GST is included in the price of boosts, memberships, paid videos and series, super chats and gifts, and shown on the invoice. If you did not, these are sold without GST under a bill of supply. Tips carry no GST.</li>
          <li>As an e-commerce operator, Klygenix may collect tax at source under section 52 of the CGST Act on taxable sales by registered creators, and deduct tax under section 194-O of the Income-tax Act. These amounts are paid to the government in your name and shown in your statements. <Ph>confirm TCS/TDS rates and the treatment of tips with CA</Ph></li>
          <li>You are responsible for your own income tax and GST filings. Studio → Earnings gives you sales, commission invoices and statements for filing.</li>
        </ul>
      </S>

      <S title="5. Holds, reserves and payouts">
        <ul>
          <li>Each sale is split when it is paid: the commission and its GST, any tax withheld, and your share.</li>
          <li>Your share is held for <strong>7 days</strong> (the refund window) and then released to your bank account through Razorpay Route.</li>
          <li>A reserve of <strong>5%</strong> of each sale is held for <strong>30 days</strong> to cover refunds and chargebacks, then released.</li>
          <li>Payout timing after release depends on Razorpay and your bank. <Ph>payout schedule and any minimum payout</Ph></li>
        </ul>
      </S>

      <S title="6. Refunds and removals">
        <ul>
          <li><strong>If you delete a paid boost, super chat or gift</strong>, the viewer is refunded in full automatically.</li>
          <li>Klygenix may refund a buyer for a membership, paid video or series, boost, super chat or gift where the purchase was not delivered, was made in error or by fraud, the content was removed for breaking our rules or the law, or the law requires it. <Ph>buyer refund policy for memberships and paid videos</Ph></li>
          <li>A refund ends the access it paid for and issues a credit note. If your share is still held, the held transfer is cancelled. If it has already been paid out, the amount becomes a recovery that is deducted from your next sales.</li>
          <li>Chargebacks are treated like refunds.</li>
        </ul>
      </S>

      <S title="7. Your obligations">
        <ul>
          <li>Deliver what you promise. Describe membership perks and paid content accurately, and keep members-only content available while memberships are active.</li>
          <li>Do not ask viewers to pay you outside Klygenix Play for things sold on it, or to pay for anything unlawful.</li>
          <li>Do not run lotteries, gambling, “guaranteed returns” or other schemes, and do not offer anything in exchange for super chats or gifts that breaks the Community Guidelines.</li>
          <li>Do not buy from your own channel through other accounts or arrange fake purchases.</li>
          <li>Keep your payout and tax details up to date.</li>
        </ul>
      </S>

      <S title="8. Suspension and withholding">
        <p>We may pause selling or hold payouts while we investigate fraud, chargebacks, a serious breach of these terms, or a legal claim, and may offset amounts you owe us against your earnings. Suspended channels cannot sell. If your channel is closed for a serious breach, amounts linked to that breach may be refunded to buyers.</p>
      </S>

      <S title="9. Relationship">
        <p>You are an independent creator, not an employee, agent or partner of Klygenix. You decide what you publish and what you charge for, within these terms.</p>
      </S>

      <S title="10. Changes">
        <p>We will give at least <Ph>notice period</Ph> notice in Studio or by email before changing commission rates, holds or reserves. Sales made before the change keep the old terms.</p>
      </S>
    </LegalShell>
  )
}

export function LiveRulesPage() {
  return (
    <LegalShell title="Live Streaming Rules">
      <p>These rules apply to everyone who streams, watches or chats live on Klygenix Play. They add to the <L to="/legal/terms">Terms of Service</L> and the <L to="/legal/guidelines">Community Guidelines</L>, which apply to live streams and live chat in full.</p>

      <S title="1. Going live">
        <ul>
          <li>Live streaming is available to channels whose plan includes it and that are not suspended. <Ph>which plans include live streaming</Ph></li>
          <li>A channel can have one scheduled or live stream at a time.</li>
          <li>Your stream key is like a password: do not share it. Anyone with the key can stream to your channel. You can rotate it in Studio when you are not live.</li>
          <li>A stream ends when you end it in Studio, or automatically if no video arrives for about 45 seconds.</li>
          <li>You can make a stream members-only. Only members of the chosen tier and above can watch and chat.</li>
        </ul>
      </S>

      <S title="2. What you can stream">
        <ul>
          <li>Stream only what you have the rights to. Do not restream TV, sports, films, other creators' streams or paid events.</li>
          <li>Use only music you own, have licensed, or have taken from the Studio music library.</li>
          <li>No sexual content, no dangerous stunts or challenges, no gambling, and no showing other people's private details.</li>
          <li>Children under <Ph>minimum age to appear unaccompanied</Ph> must not appear on a stream without an adult present.</li>
          <li>Do not present a pre-recorded video as live in a way that misleads viewers. <Ph>confirm rule on pre-recorded "premieres"</Ph></li>
        </ul>
      </S>

      <S title="3. Live chat">
        <ul>
          <li>Chat messages can be up to 200 characters. Links are not allowed, and messages with blocked words are refused.</li>
          <li>Creators can turn on slow mode (up to 10 minutes between messages per viewer).</li>
          <li>The creator and the channel's moderators can remove messages and pause a viewer's chat for between 10 seconds and 24 hours.</li>
          <li>Live chat is public to everyone watching the stream. Chat messages are kept for 90 days after the stream ends and then deleted.</li>
        </ul>
      </S>

      <S title="4. Super chats and gifts">
        <ul>
          <li>Super chats and gifts are payments to the creator under the <L to="/legal/monetisation">Creator Monetisation Terms</L>. They are only available on Klygenix Play streams, in India, in rupees.</li>
          <li>A super chat stays pinned at the top of the chat for the time of its tier, then stays in the chat history.</li>
          <li>Paid messages must follow the Community Guidelines like any other message. Paying does not entitle anyone to a reply, a shout-out or any other action by the creator.</li>
          <li>If the creator or one of their channel moderators removes a super chat or gift, the viewer is refunded in full automatically.</li>
        </ul>
      </S>

      <S title="5. Safety and enforcement">
        <p>Live streams cannot be checked before they are broadcast. The creator is responsible for their stream and chat, supported by their moderators. Klygenix can stop any stream at any time if it breaks these rules or the law, and the channel will see the reason. Breaking these rules can lead to a strike, losing access to live streaming, or suspension, as described in the Community Guidelines. You can report a live stream by reporting the channel. <Ph>reporting individual live chat messages</Ph></p>
      </S>

      <S title="6. Replays and recordings">
        <ul>
          <li>If replays are on, the stream is recorded and published on your channel as a video labelled "live replay" after it ends. Like every upload, the replay is scanned before it is published.</li>
          <li>The raw live recording is deleted 24 hours after the stream ends.</li>
          <li>Turn replays off before going live if you do not want a recording published.</li>
        </ul>
      </S>
    </LegalShell>
  )
}
