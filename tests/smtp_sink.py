import email
import socketserver
import threading

from sqlalchemy import text


class Sink:
    def __init__(self, port: int):
        self.messages: list[bytes] = []
        sink = self

        class Handler(socketserver.StreamRequestHandler):
            def reply(self, line: bytes) -> None:
                self.wfile.write(line + b"\r\n")

            def handle(self):
                self.reply(b"220 test ESMTP")
                collecting = False
                buffer: list[bytes] = []
                while True:
                    line = self.rfile.readline()
                    if not line:
                        return
                    if collecting:
                        if line in (b".\r\n", b".\n"):
                            sink.messages.append(b"".join(buffer))
                            buffer = []
                            collecting = False
                            self.reply(b"250 OK")
                            continue
                        buffer.append(line[1:] if line.startswith(b"..") else line)
                        continue
                    command = line.strip().upper()
                    if command.startswith(b"EHLO"):
                        self.wfile.write(b"250-test\r\n250 AUTH PLAIN LOGIN\r\n")
                    elif command.startswith(b"AUTH PLAIN"):
                        if len(command.split()) == 2:
                            self.reply(b"334 ")
                            self.rfile.readline()
                        self.reply(b"235 OK")
                    elif command.startswith(b"AUTH LOGIN"):
                        if len(command.split()) == 2:
                            self.reply(b"334 VXNlcm5hbWU6")
                            self.rfile.readline()
                        self.reply(b"334 UGFzc3dvcmQ6")
                        self.rfile.readline()
                        self.reply(b"235 OK")
                    elif command.startswith(b"DATA"):
                        self.reply(b"354 go on")
                        collecting = True
                    elif command.startswith(b"QUIT"):
                        self.reply(b"221 bye")
                        return
                    else:
                        self.reply(b"250 OK")

        socketserver.TCPServer.allow_reuse_address = True
        self.port = port
        self.server = socketserver.ThreadingTCPServer(("127.0.0.1", port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.config_id = None
        self.held: list[int] = []

    def to(self, address: str) -> list[bytes]:
        return [m for m in self.messages if address.encode() in m]

    def point(self, session_factory, tenant_id: int) -> None:
        with session_factory() as s:
            self.held = [r[0] for r in s.execute(
                text("SELECT id FROM kv_admin.email_configs WHERE tenant_id = :t AND is_active"), {"t": tenant_id}
            )]
            s.execute(text("UPDATE kv_admin.email_configs SET is_active = FALSE WHERE id = ANY(:i)"), {"i": self.held})
            self.config_id = s.execute(
                text("INSERT INTO kv_admin.email_configs (config_type, tenant_id, smtp_host, smtp_port, "
                     "smtp_username, smtp_password, from_email, from_name, use_tls, is_active) "
                     "VALUES ('tenant', :t, '127.0.0.1', :p, 'suite', 'suite', 'books@cooltech.example', "
                     "'Cool Tech', FALSE, TRUE) RETURNING id"),
                {"t": tenant_id, "p": self.port},
            ).scalar_one()
            s.commit()

    def point_global(self, session_factory) -> None:
        with session_factory() as s:
            self.config_id = s.execute(
                text("INSERT INTO kv_admin.email_configs (config_type, tenant_id, smtp_host, smtp_port, "
                     "smtp_username, smtp_password, from_email, from_name, use_tls, is_active) "
                     "VALUES ('global', NULL, '127.0.0.1', :p, 'suite', 'suite', 'no-reply@klygenix.example', "
                     "'Klygenix Play', FALSE, TRUE) RETURNING id"),
                {"p": self.port},
            ).scalar_one()
            s.commit()

    def active(self, session_factory, on: bool) -> None:
        with session_factory() as s:
            s.execute(text("UPDATE kv_admin.email_configs SET is_active = :a WHERE id = :i"),
                      {"a": on, "i": self.config_id})
            s.commit()

    def restore(self, session_factory) -> None:
        with session_factory() as s:
            if self.config_id:
                s.execute(text("DELETE FROM kv_admin.email_configs WHERE id = :i"), {"i": self.config_id})
            if self.held:
                s.execute(text("UPDATE kv_admin.email_configs SET is_active = TRUE WHERE id = ANY(:i)"), {"i": self.held})
            s.commit()
        self.server.shutdown()


def attachments_of(message: bytes) -> dict[str, bytes]:
    parsed = email.message_from_bytes(message)
    found = {}
    for part in parsed.walk():
        name = part.get_filename()
        if name:
            found[name] = part.get_payload(decode=True)
    return found
