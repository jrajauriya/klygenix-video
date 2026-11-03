import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.database import SessionLocal  # noqa: E402
from app.core.services.email_service import get_active_email_config, send_email  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Send one real test email through the active email configuration.")
    ap.add_argument("--to", required=True)
    args = ap.parse_args()
    with SessionLocal() as db:
        config = get_active_email_config(db)
        if config is None:
            sys.exit("No email configuration: set MS_GRAPH_* or SMTP_* in backend/.env, or save one in Admin → Email Config.")
        print(f"Sending through {config.config_type} ({config.smtp_host}) as {config.from_name} <{config.from_email}> to {args.to}")
        sent = send_email(db, args.to, "Klygenix Play — test email",
                          "<p>This is a test from Klygenix Play. If you can read it, outgoing email works.</p>")
        print("Sent." if sent else "Not sent: the address is a reserved test domain.")


if __name__ == "__main__":
    main()
