import { useState, type FormEvent, type ReactNode } from "react"
import { Link, NavLink } from "react-router-dom"
import { CheckCircle2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { PageShell } from "../../components/Layout"
import { Btn, Field, INPUT, TEXTAREA } from "../../components/bits"
import { errText } from "../../lib/api"
import { longDate } from "../../lib/format"
import { useTitle } from "../../lib/title"

const NAV = [
  { to: "/legal/terms", label: "Terms of use" },
  { to: "/legal/privacy", label: "Privacy notice" },
  { to: "/legal/guidelines", label: "Community guidelines" },
  { to: "/legal/copyright", label: "Copyright & takedowns" },
  { to: "/legal/grievance", label: "Grievance officer" },
]

const COMPANY = "Klygenix Technologies Private Limited"

function LegalShell({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  useTitle(title)
  return (
    <PageShell className="max-w-6xl">
      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
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
          {updated && <p className="mt-1 text-xs text-faint">Last updated {updated}</p>}
          <div className="mt-6 space-y-6 text-[15px] leading-relaxed text-ink/85 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">
            {children}
          </div>
        </article>
      </div>
    </PageShell>
  )
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of use" updated="3 November 2026">
      <p>These terms are an agreement between you and {COMPANY} ("Klygenix", "we") for using Klygenix Play on the web, in our apps and through Klygenix Studio. By using Klygenix Play you agree to them.</p>
      <section>
        <h2>Who can use Klygenix Play</h2>
        <p>Anyone can watch public videos without an account. To open an account you must be at least 18 in India, 16 in Germany and some other EU countries, and 13 everywhere else, and you must give your real date of birth.</p>
      </section>
      <section>
        <h2>Your account</h2>
        <ul>
          <li>Keep your password safe. You are responsible for what happens under your account.</li>
          <li>One person per account. Do not sell, share or transfer accounts.</li>
          <li>You can close your account at any time from Account settings or by writing to us.</li>
        </ul>
      </section>
      <section>
        <h2>What you post</h2>
        <p>You keep ownership of the videos, comments and danmaku you post. You give Klygenix a worldwide, non-exclusive, royalty-free licence to host, transcode, caption, translate, summarise and show them on Klygenix Play, for as long as they are up. You confirm you hold the rights to what you upload and that it follows our <Link to="/legal/guidelines" className="text-brand-soft underline underline-offset-2">community guidelines</Link>.</p>
      </section>
      <section>
        <h2>AI features</h2>
        <p>Summaries, chapters, transcripts, translations and Ask answers are generated automatically and can be wrong. Check anything important against the video itself. Creators must label AI-generated or synthetic content.</p>
      </section>
      <section>
        <h2>Videos from YouTube and Bilibili</h2>
        <p>Some videos play through the official YouTube or Bilibili players. Those players are run by their owners under their own terms, and we never place anything over them.</p>
      </section>
      <section>
        <h2>Plans and payments</h2>
        <ul>
          <li>Viewer and creator plans renew monthly until you cancel. Cancelling keeps the plan until the end of the period you paid for.</li>
          <li>Prices are shown before you pay; GST or local tax is added where it applies, and you get a tax invoice.</li>
          <li>Payments are processed by our payment partners. We do not store card details.</li>
        </ul>
      </section>
      <section>
        <h2>Enforcement</h2>
        <p>We may remove content, restrict features or suspend accounts that break these terms or the law. You will see a notice in your account and can appeal.</p>
      </section>
      <section>
        <h2>Liability and law</h2>
        <p>Klygenix Play is provided as is. To the extent the law allows, our liability is limited to the amount you paid us in the last twelve months. These terms are governed by the laws of India, and the courts at [to be filled] have jurisdiction.</p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>Questions about these terms: legal@klygenix.com. Complaints: see the <Link to="/legal/grievance" className="text-brand-soft underline underline-offset-2">grievance officer</Link> page.</p>
      </section>
    </LegalShell>
  )
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy notice" updated="3 November 2026">
      <p>This notice explains what personal data {COMPANY} collects when you use Klygenix Play, why, and the rights you have under India's Digital Personal Data Protection Act, 2023 and other laws that apply to you.</p>
      <section>
        <h2>What we collect</h2>
        <ul>
          <li>Account details: name, email, date of birth, country and language.</li>
          <li>What you do: videos watched and how far, likes, follows, comments, danmaku, questions you ask videos, and reports.</li>
          <li>Payments: plan, amount, tax details and payment status. Card and UPI details stay with our payment partner.</li>
          <li>Device and log data: IP address, browser and app version, and error reports, kept briefly for security.</li>
        </ul>
      </section>
      <section>
        <h2>Why we use it</h2>
        <ul>
          <li>To run your account, remember where you stopped, and show your Following feed.</li>
          <li>To answer Ask questions and translate subtitles (questions are sent to our AI providers without your name or email).</li>
          <li>To bill plans and keep tax records the law requires.</li>
          <li>To keep the platform safe: moderation, fraud prevention and age checks.</li>
        </ul>
      </section>
      <section>
        <h2>Who we share it with</h2>
        <p>Service providers that host video, process payments, send email and run AI models, under contracts that limit their use of it. Authorities when the law requires. We do not sell personal data.</p>
      </section>
      <section>
        <h2>Your rights</h2>
        <p>You can access, correct and erase your data, withdraw consent, and nominate someone to act for you. You can do most of this yourself under <Link to="/account?tab=privacy" className="text-brand-soft underline underline-offset-2">Account → Privacy &amp; data</Link>, or write to privacy@klygenix.com or our <Link to="/legal/grievance" className="text-brand-soft underline underline-offset-2">grievance officer</Link>. We reply within the times the law sets.</p>
        <ul>
          <li>Download my data gives you a file with your account, profile, channel, follows, likes, watch history, comments, danmaku, questions, plans, payments, reports and appeals.</li>
          <li>You can remove single videos from your watch history, or clear all of it, at any time.</li>
          <li>Delete my account erases your email, name, password and phone number, your likes, follows, watch history, questions and device tokens, and the text of your comments and danmaku (they show as from a deleted user). If you have a channel, it is closed and its videos are removed.</li>
          <li>Invoices and payment records are not erased: tax law requires us to keep them for the period it sets. A paid plan must be cancelled before the account can be deleted.</li>
        </ul>
      </section>
      <section>
        <h2>Children</h2>
        <p>Accounts are not available below the minimum age for your country. If you believe a child has an account, report it and we will close it.</p>
      </section>
      <section>
        <h2>Storage</h2>
        <p>Data is stored in India where possible. Danmaku display settings are saved only on your device.</p>
      </section>
    </LegalShell>
  )
}

export function GuidelinesPage() {
  const rules: [string, string][] = [
    ["No adult or sexual content", "No nudity, pornography or sexually explicit material, including in thumbnails, titles, comments and danmaku."],
    ["Child safety: zero tolerance", "Any content that sexualises, endangers or exploits minors is removed, the account is closed, and we report it to the authorities. Report it with the “Child safety” reason and it is reviewed first."],
    ["No hate", "No content that attacks or demeans people for religion, caste, race, ethnicity, nationality, gender, sexual orientation, disability or similar traits."],
    ["No harassment", "No bullying, threats, doxxing, or targeting a person with repeated unwanted comments or danmaku."],
    ["No scams or spam", "No fake giveaways, phishing, misleading links, pyramid schemes, or repetitive and off-topic posting. Links in comments are held for review."],
    ["No violence or dangerous acts", "No graphic violence for shock value, terrorism, or instructions that could seriously hurt people."],
    ["Respect copyright", "Upload only what you made or have permission to use. Rights holders can file a notice on our copyright page. Repeated infringement closes channels."],
    ["Label AI-generated content", "If a video is made or materially changed with AI, mark it as AI-generated when you upload. Never use synthetic media to impersonate a real person or mislead about real events."],
    ["Danmaku etiquette", "Keep danmaku short, on topic and kind. No spoilers flooding, no personal attacks. Viewers can block words and hide danmaku at any time."],
  ]
  return (
    <LegalShell title="Community guidelines" updated="3 November 2026">
      <p>Klygenix Play is for learning, making and enjoying videos together. These rules apply to videos, reels, thumbnails, titles, descriptions, comments, danmaku and channels.</p>
      <ol className="space-y-3">
        {rules.map(([title, body], i) => (
          <li key={title} className="flex gap-4 rounded-2xl border border-line bg-panel p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/25 text-sm font-bold text-brand-soft">{i + 1}</span>
            <div>
              <p className="font-semibold text-ink">{title}</p>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <section>
        <h2>What happens when rules are broken</h2>
        <p>Depending on how serious it is, we may hide or remove the content, add a label, restrict features, give a strike, or suspend the channel. Strikes expire after 90 days. You can appeal any decision from the Notices tab in your account.</p>
      </section>
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
    <LegalShell title="Copyright & takedown notices">
      <p>If something on Klygenix Play infringes your copyright or is unlawful, send us a notice here. We acknowledge every notice within 24 hours and act within 15 days, sooner where the law requires (non-consensual intimate imagery is handled within 24 hours).</p>
      {done ? (
        <div className="rounded-2xl border border-[#166534] bg-[#052e16]/60 p-5">
          <p className="flex items-center gap-2 font-semibold text-[#bbf7d0]"><CheckCircle2 size={18} /> Notice received</p>
          <p className="mt-2 text-sm">Your reference is <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono font-semibold">{done.reference}</span>. Keep it for any follow-up.</p>
          <p className="mt-2 text-sm text-muted">We will acknowledge it by {longDate(done.ack_due_at)} and resolve it by {longDate(done.resolve_due_at)}.</p>
          <Btn tone="soft" size="sm" className="mt-4" onClick={() => { setDone(null); setForm({ ...form, target_url: "", details: "", sworn: false }) }}>File another notice</Btn>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-panel p-4 sm:p-6">
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
    </LegalShell>
  )
}

export function GrievancePage() {
  const rows: [string, string][] = [
    ["Name", "[to be filled]"],
    ["Designation", "Grievance Officer, Klygenix Play"],
    ["Email", "[to be filled]"],
    ["Phone", "[to be filled]"],
    ["Address", "[to be filled]"],
    ["Working hours", "Monday to Friday, 10:00 to 18:00 IST"],
  ]
  return (
    <LegalShell title="Grievance officer">
      <p>Under the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 and the Digital Personal Data Protection Act, 2023, {COMPANY} has appointed a Grievance Officer for Klygenix Play.</p>
      <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[160px_1fr]">
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="text-sm font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <section>
        <h2>Response times</h2>
        <ul>
          <li><strong>Acknowledgement:</strong> within 24 hours of receiving your complaint.</li>
          <li><strong>Resolution:</strong> within 15 days.</li>
          <li>Complaints about non-consensual intimate imagery are acted on within 24 hours.</li>
        </ul>
      </section>
      <section>
        <h2>Before you write</h2>
        <p>For a specific video, comment or danmaku, the fastest route is the Report button next to it. For copyright, use the <Link to="/legal/copyright" className="text-brand-soft underline underline-offset-2">takedown form</Link>. If you are not satisfied with our decision, you may appeal to the Grievance Appellate Committee set up by the Government of India.</p>
      </section>
    </LegalShell>
  )
}
