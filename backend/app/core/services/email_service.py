import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

from sqlalchemy.orm import Session

from app.core import breaker
from app.core.services import secrets
from app.core.models.email_config import EmailConfig

log = logging.getLogger(__name__)
RESERVED_DOMAINS = ("example.com", "example.org", "example.net")
RESERVED_TLDS = ("test", "invalid", "local", "localhost", "example")


def is_undeliverable(address: str | None) -> bool:
    domain = (address or "").strip().rsplit("@", 1)[-1].lower().rstrip(".")
    if not domain or "@" not in (address or ""):
        return True
    return (domain in RESERVED_DOMAINS or domain.endswith(tuple("." + d for d in RESERVED_DOMAINS))
            or domain.rsplit(".", 1)[-1] in RESERVED_TLDS)

SMTP_ANSWERS = (
    smtplib.SMTPAuthenticationError,
    smtplib.SMTPRecipientsRefused,
    smtplib.SMTPSenderRefused,
    smtplib.SMTPDataError,
)


def _deliver(config: EmailConfig, sender: str, recipients, message: str) -> None:
    with breaker.guard("smtp", f"{config.smtp_host}:{config.smtp_port}", answers=SMTP_ANSWERS):
        server = _create_smtp_connection(config)
        try:
            server.sendmail(sender, recipients, message)
        finally:
            server.quit()


def get_active_email_config(db: Session, tenant_id: int | None = None) -> EmailConfig | None:
    """Load email config — tenant-specific first, fallback to global."""
    if tenant_id:
        config = db.query(EmailConfig).filter(
            EmailConfig.tenant_id == tenant_id,
            EmailConfig.is_active == True,
        ).first()
        if config:
            return config
    # Fallback to global config (newest first)
    config = db.query(EmailConfig).filter(
        EmailConfig.config_type == "global",
        EmailConfig.is_active == True,
    ).order_by(EmailConfig.id.desc()).first()
    if config is not None:
        return config
    return _graph_config() or _env_config()


def _graph_config() -> EmailConfig | None:
    from app.config import settings
    from app.core.services import graph_mail

    if not graph_mail.configured():
        return None
    return EmailConfig(config_type="graph", smtp_host="graph.microsoft.com", smtp_port=443, smtp_username="",
                       smtp_password="", from_email=graph_mail.sender(), from_name=settings.SMTP_FROM_NAME,
                       use_tls=True, is_active=True)


def _env_config() -> EmailConfig | None:
    from app.config import settings

    if not (settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD):
        return None
    return EmailConfig(config_type="env", smtp_host=settings.SMTP_HOST, smtp_port=settings.SMTP_PORT,
                       smtp_username=settings.SMTP_USER, smtp_password=settings.SMTP_PASSWORD,
                       from_email=settings.SMTP_FROM_EMAIL, from_name=settings.SMTP_FROM_NAME,
                       use_tls=True, is_active=True)


def _create_smtp_connection(config: EmailConfig):
    """Create and authenticate an SMTP connection."""
    if config.smtp_port == 465:
        server = smtplib.SMTP_SSL(config.smtp_host, config.smtp_port, timeout=15)
    elif config.use_tls:
        server = smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=15)
        server.starttls()
    else:
        server = smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=15)
    server.login(config.smtp_username, secrets.resolve(config.smtp_password))
    return server


def send_email(
    db: Session,
    to_email: str,
    subject: str,
    body_html: str,
    attachments: list[tuple[str, bytes]] | None = None,
    tenant_id: int | None = None,
    tenant_name: str | None = None,
    cc_emails: list[str] | None = None,
    reply_to: str | None = None,
) -> bool:
    """Send email via SMTP. Returns True on success."""
    if is_undeliverable(to_email):
        log.info("email to a reserved test address skipped: %s", subject)
        return False
    cc_emails = [e for e in (cc_emails or []) if not is_undeliverable(e)]
    config = get_active_email_config(db, tenant_id)
    if not config:
        raise ValueError("No active email configuration found")

    # Prepend tenant name to subject
    if tenant_name:
        subject = f"{tenant_name} | {subject}"

    # Append tenant footer
    if tenant_name:
        body_html += (
            '<br/>'
            f'<p style="color:#555;font-size:13px;">Regards,<br/><strong>{tenant_name}</strong></p>'
            '<p style="color:#999;font-size:11px;">System generated email, do not reply.</p>'
        )

    msg = MIMEMultipart()
    msg["From"] = f"{config.from_name} <{config.from_email}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    if reply_to:
        msg["Reply-To"] = reply_to

    # Add CC recipients
    all_recipients = [to_email]
    unique_cc = list(dict.fromkeys(e.strip() for e in cc_emails if e.strip() and e.strip() != to_email))
    if unique_cc:
        msg["Cc"] = ", ".join(unique_cc)
        all_recipients.extend(unique_cc)

    if getattr(config, "config_type", None) == "graph":
        from app.core.services import graph_mail

        graph_mail.send(to_email, unique_cc, subject, body_html, attachments or [], reply_to, config.from_name)
        return True

    msg.attach(MIMEText(body_html, "html"))

    if attachments:
        for filename, data in attachments:
            subtype = "pdf" if filename.lower().endswith(".pdf") else "octet-stream"
            part = MIMEBase("application", subtype)
            part.set_payload(data)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", "attachment", filename=("utf-8", "", filename))
            msg.attach(part)

    _deliver(config, config.from_email, all_recipients, msg.as_string())
    return True


def test_smtp_connection(config: EmailConfig, recipient: str) -> bool:
    """Send a test email to verify SMTP settings."""
    msg = MIMEMultipart()
    msg["From"] = f"{config.from_name} <{config.from_email}>"
    msg["To"] = recipient
    msg["Subject"] = "Klygenix - SMTP Test"
    msg.attach(MIMEText(
        "<h2>SMTP Test Successful</h2>"
        "<p>Your email configuration is working correctly.</p>"
        "<p style='color:#888;font-size:12px;'>— Klygenix Technologies Private Limited</p>",
        "html",
    ))

    _deliver(config, config.from_email, recipient, msg.as_string())
    return True
