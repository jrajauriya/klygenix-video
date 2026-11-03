from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _render(report: dict, source: str) -> str:
    lines = ["Klygenix Play — launch readiness", f"Configuration: {source}", ""]
    if report["ready"]:
        verdict = "READY"
    else:
        verdict = f"NOT READY — {report['blocking_failed']} blocking check(s) failed"
    lines.append(f"{verdict}, {report['warnings']} warning(s)")
    for severity, heading in (("block", "Blocking — must pass before launch"), ("warn", "Warnings — launch is allowed, know why")):
        rows = [c for c in report["checks"] if c["severity"] == severity]
        if not rows:
            continue
        lines += ["", heading]
        for c in sorted(rows, key=lambda c: c["ok"]):
            mark = "[ OK ]" if c["ok"] else ("[FAIL]" if severity == "block" else "[WARN]")
            lines.append(f"  {mark} {c['title']} ({c['key']})")
            if not c["ok"]:
                lines.append(f"         {c['detail']}")
                if c["fix"]:
                    lines.append(f"         Fix: {c['fix']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.readiness",
                                 description="Check a configuration is fit for production. Exit 0 ready, 1 not ready, 2 could not check.")
    ap.add_argument("--env-file", help="evaluate this dotenv file alone (the process environment is ignored)")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    ap.add_argument("--db", action="store_true", help="also run the database checks, connecting with DATABASE_URL")
    args = ap.parse_args(argv)

    from app.core.services import readiness

    try:
        if args.env_file:
            path = Path(args.env_file)
            if not path.is_file():
                print(f"No such env file: {path}", file=sys.stderr)
                return 2
            settings, env = readiness.env_file_settings(path)
            source = str(path)
        else:
            from app.config import Settings

            settings, env = Settings(), None
            source = "process environment and backend/.env"
        checks = readiness.evaluate(settings, mode="cli", env=env)
    except Exception as exc:
        print(f"Could not load the configuration: {exc}", file=sys.stderr)
        return 2

    if args.db:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, connect_args={"connect_timeout": 10})
        try:
            with Session(engine) as db:
                db_checks = readiness.evaluate_db(db, settings)
            checks = [c for c in checks if c.key != "email.config"] + db_checks
        except Exception as exc:
            checks.append(readiness.Check("db.reachable", "Database is reachable", "Data", readiness.BLOCK, False,
                                          f"{type(exc).__name__}: {str(exc).splitlines()[0][:200]}",
                                          "Check DATABASE_URL and that PostgreSQL is running."))
        finally:
            engine.dispose()

    report = readiness.summarise(checks)
    if args.json:
        print(json.dumps({"source": source, **report}, indent=2))
    else:
        print(_render(report, source))
    return 0 if report["ready"] else 1


if __name__ == "__main__":
    sys.exit(main())
