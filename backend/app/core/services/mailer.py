from __future__ import annotations

import html
import logging
import re

from sqlalchemy.orm import Session

from app.config import settings
from app.core.models.beta import MailOutbox
from app.video.jobs import job

logger = logging.getLogger(__name__)

T = {
    "waitlist_confirm": {
        "en": ("Confirm your place on the Klygenix Play waitlist",
               "Hi {name},\n\nTap the link to confirm your email and keep your place on the waitlist:\n{link}\n\n"
               "If you did not ask for this, ignore this mail."),
        "hi": ("Klygenix Play की प्रतीक्षा सूची में अपनी जगह पक्की करें",
               "नमस्ते {name},\n\nअपना ईमेल पक्का करने के लिए यह लिंक खोलें:\n{link}\n\nअगर आपने यह नहीं माँगा था, तो इस मेल को अनदेखा करें।"),
    },
    "invite": {
        "en": ("Your invitation to Klygenix Play",
               "Hi {name},\n\nYou are in. Sign up with this invite code: {code}\n{link}\n\nThe code works {uses} time(s) "
               "and expires on {expires}."),
        "hi": ("Klygenix Play का आपका निमंत्रण",
               "नमस्ते {name},\n\nआपका स्वागत है। इस कोड से साइन अप करें: {code}\n{link}\n\nयह कोड {uses} बार चलेगा और "
               "{expires} को समाप्त होगा।"),
    },
    "takedown_received": {
        "en": ("We received your notice {reference}",
               "We received your {kind} notice about {target}.\nWe will acknowledge it by {ack_due} and decide by {resolve_due}."),
        "hi": ("आपकी शिकायत {reference} हमें मिल गई है",
               "{target} के बारे में आपकी {kind} शिकायत मिल गई है।\nहम {ack_due} तक पावती देंगे और {resolve_due} तक निर्णय लेंगे।"),
    },
    "takedown_removed": {
        "en": ("Your video was removed after a notice ({reference})",
               "\"{title}\" was removed after a {kind} notice.\nIf you believe this is a mistake you can file a counter-notice "
               "from your studio: {link}"),
        "hi": ("एक शिकायत के बाद आपका वीडियो हटाया गया ({reference})",
               "\"{title}\" एक {kind} शिकायत के बाद हटाया गया।\nअगर यह गलती है तो आप स्टूडियो से प्रति-सूचना दे सकते हैं: {link}"),
    },
    "counter_notice_claimant": {
        "en": ("A counter-notice was filed against your notice {reference}",
               "The uploader filed a counter-notice:\n\n{statement}\n\nUnless you tell us that you have filed a court action "
               "to stop the infringement, the content will be restored after {restore_due}. Reply to this mail with the "
               "court filing."),
        "hi": ("आपकी शिकायत {reference} पर प्रति-सूचना दी गई है",
               "अपलोड करने वाले ने प्रति-सूचना दी है:\n\n{statement}\n\nजब तक आप हमें अदालत में दायर कार्रवाई की सूचना नहीं देते, "
               "सामग्री {restore_due} के बाद बहाल कर दी जाएगी।"),
    },
    "takedown_restored": {
        "en": ("Content restored ({reference})", "\"{title}\" was restored after the counter-notice period ended."),
        "hi": ("सामग्री बहाल की गई ({reference})", "प्रति-सूचना की अवधि समाप्त होने के बाद \"{title}\" बहाल कर दिया गया।"),
    },
    "deal_event": {
        "en": ("Sponsorship update: {title}", "{message}\n\n{link}"),
        "hi": ("स्पॉन्सरशिप अपडेट: {title}", "{message}\n\n{link}"),
    },
    "campaign_event": {
        "en": ("Ad campaign update: {title}", "{message}\n\n{link}"),
        "hi": ("विज्ञापन अभियान अपडेट: {title}", "{message}\n\n{link}"),
    },
    "digest": {
        "en": ("You have {count} new updates on Klygenix Play", "Here is what happened since your last visit:\n\n{items}\n\nSee them all: {link}\n\n"
               "Change how often you get this mail in Account → Notifications."),
        "hi": ("Klygenix Play पर आपके लिए {count} नए अपडेट", "आपकी पिछली विज़िट के बाद:\n\n{items}\n\nसब देखें: {link}\n\n"
               "यह मेल कितनी बार आए, यह Account → Notifications में बदलें।"),
    },
    "feedback_received": {
        "en": ("Thanks for your feedback", "We read every message. Reference: {reference}."),
        "hi": ("आपकी प्रतिक्रिया के लिए धन्यवाद", "हम हर संदेश पढ़ते हैं। संदर्भ: {reference}।"),
    },
    "account_verify": {
        "en": ("Confirm your email address", "Hi {name},\n\nConfirm this address for your Klygenix Play account. The link works for 48 hours:\n{link}"),
        "hi": ("अपना ईमेल पता पक्का करें", "नमस्ते {name},\n\nअपने Klygenix Play खाते के लिए यह पता पक्का करें। लिंक 48 घंटे चलेगा:\n{link}"),
    },
    "account_reset": {
        "en": ("Reset your password", "Hi {name},\n\nSomebody asked to reset the password on this account. If it was you, the link "
               "works for 30 minutes:\n{link}\n\nIf it was not, ignore this email and nothing changes."),
        "hi": ("अपना पासवर्ड रीसेट करें", "नमस्ते {name},\n\nकिसी ने इस खाते का पासवर्ड रीसेट करने को कहा है। अगर यह आप थे, तो लिंक "
               "30 मिनट चलेगा:\n{link}\n\nअगर नहीं, तो इस मेल को अनदेखा करें, कुछ नहीं बदलेगा।"),
    },
    "account_invite": {
        "en": ("You have been invited to Klygenix Play", "Hi {name},\n\n{inviter} has added you to {tenant}. Choose a password to "
               "sign in. The link works for 7 days:\n{link}"),
        "hi": ("Klygenix Play पर आपको आमंत्रित किया गया है", "नमस्ते {name},\n\n{inviter} ने आपको {tenant} में जोड़ा है। साइन इन के लिए "
               "पासवर्ड चुनें। लिंक 7 दिन चलेगा:\n{link}"),
    },
    "team_invite": {
        "en": ("{inviter} invited you to help run {channel}",
               "Hi {name},\n\n{inviter} invited you to join {channel} on Klygenix Play as {role}.\n\nAccept here:\n{link}\n\n"
               "Sign in with this email address to accept. The invitation expires in {days} days."),
        "hi": ("{inviter} ने आपको {channel} चलाने में मदद के लिए आमंत्रित किया",
               "नमस्ते {name},\n\n{inviter} ने आपको Klygenix Play पर {channel} में {role} के रूप में जुड़ने के लिए आमंत्रित किया है।\n\n"
               "यहाँ स्वीकार करें:\n{link}\n\nस्वीकार करने के लिए इसी ईमेल से साइन इन करें। यह निमंत्रण {days} दिनों में समाप्त होगा।"),
    },
    "onboarding_upload": {
        "en": ("Your channel is ready: upload your first video",
               "Hi {name},\n\n{channel} is open. Upload your first video and Klygenix Play writes the chapters, summary and "
               "transcript for you:\n{link}\n\nDon't want these tips? Turn them off in Studio → Settings."),
        "hi": ("आपका चैनल तैयार है: अपना पहला वीडियो अपलोड करें",
               "नमस्ते {name},\n\n{channel} खुल गया है। अपना पहला वीडियो अपलोड करें और Klygenix Play आपके लिए अध्याय, सारांश और "
               "ट्रांसक्रिप्ट लिखेगा:\n{link}\n\nये सुझाव नहीं चाहिए? Studio → Settings में बंद करें।"),
    },
    "onboarding_clip": {
        "en": ("Turn your best moments into reels",
               "Hi {name},\n\nKlygenix Play has found clip ideas in your videos. Open one, pick a caption style and render a "
               "vertical reel in a minute:\n{link}\n\nDon't want these tips? Turn them off in Studio → Settings."),
        "hi": ("अपने सबसे अच्छे पलों को रील बनाएँ",
               "नमस्ते {name},\n\nKlygenix Play ने आपके वीडियो में क्लिप के सुझाव ढूँढे हैं। एक खोलें, कैप्शन स्टाइल चुनें और एक मिनट में "
               "वर्टिकल रील बनाएँ:\n{link}\n\nये सुझाव नहीं चाहिए? Studio → Settings में बंद करें।"),
    },
    "onboarding_payouts": {
        "en": ("Set up payouts to earn from your channel",
               "Hi {name},\n\nTips, memberships and paid videos need a payout account. It takes five minutes:\n{link}\n\n"
               "Don't want these tips? Turn them off in Studio → Settings."),
        "hi": ("अपने चैनल से कमाई के लिए भुगतान खाता जोड़ें",
               "नमस्ते {name},\n\nटिप, सदस्यता और पेड वीडियो के लिए भुगतान खाता चाहिए। इसमें पाँच मिनट लगते हैं:\n{link}\n\n"
               "ये सुझाव नहीं चाहिए? Studio → Settings में बंद करें।"),
    },
}


class _Safe(dict):
    def __missing__(self, key: str) -> str:
        return ""


def render(template: str, lang: str, data: dict) -> tuple[str, str, str]:
    pack = T[template].get(lang) or T[template]["en"]
    subject = pack[0].format_map(_Safe({k: str(v) for k, v in data.items()}))
    text = pack[1].format_map(_Safe({k: str(v) for k, v in data.items()}))
    esc = html.escape(text)
    linked = re.sub(r"(https?://[^\s<]+)", r'<a href="\1">\1</a>', esc)
    body = ("<div style=\"font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1d1d1f\">"
            + linked.replace("\n", "<br>") + "<p style=\"color:#86868b;font-size:12px\">Klygenix Play</p></div>")
    return subject[:200], body, text


def provider() -> str:
    return settings.EMAIL_PROVIDER if settings.EMAIL_PROVIDER in ("smtp", "graph") else "sandbox"


def send(db: Session, template: str, to: str, data: dict | None = None, lang: str = "en",
         tenant_id: int | None = None) -> MailOutbox:
    subject, body, text = render(template, lang, data or {})
    row = MailOutbox(template=template, language=lang if lang in T[template] else "en", to_email=to.strip().lower()[:200],
                     subject=subject, body_html=body, body_text=text, data={k: str(v)[:300] for k, v in (data or {}).items()},
                     provider=provider(), status="captured", tenant_id=tenant_id)
    db.add(row)
    db.flush()
    if row.provider != "sandbox":
        from app.video.after_commit import later

        later(db, deliver, row.id)
    return row


@job
def deliver(outbox_id: int) -> None:
    from app.core.services import email_service
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        row = db.get(MailOutbox, outbox_id)
        if row is None or row.status != "captured":
            return
        try:
            ok = email_service.send_email(db, row.to_email, row.subject, row.body_html, tenant_id=row.tenant_id)
            row.status, row.error = ("sent", None) if ok else ("failed", "the mail server refused or is not configured")
        except Exception as exc:
            row.status, row.error = "failed", f"{type(exc).__name__}: {exc}"[:300]
        db.commit()
    finally:
        db.close()
