from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT_DIR = Path(__file__).resolve().parent.parent
WORK_DIR = ROOT_DIR / "work"
CONFIG_DIR = WORK_DIR / "config"
DATA_DIR = WORK_DIR / "data"
OUTPUTS_DIR = ROOT_DIR / "outputs"
NETLIFY_DATA_DIR = ROOT_DIR / "netlify" / "data"
ADMIN_DATASET_PATH = NETLIFY_DATA_DIR / "admin-dataset.json"
ACCESS_CONTROL_PATH = Path(
    os.getenv("YELLOW_DASHBOARD_ACCESS_CONTROL_JSON", str(CONFIG_DIR / "dashboard-access.local.json"))
).resolve()
DB_PATH = Path(
    os.getenv("YELLOW_DASHBOARD_AUTH_DB_PATH", str(DATA_DIR / "dashboard-auth.sqlite3"))
).resolve()
SESSION_COOKIE_NAME = "yellow_dashboard_admin_session"
SESSION_DURATION_HOURS = 24 * 30
PASSWORD_ITERATIONS = 200_000
DEFAULT_MANAGER_EMAILS = [
    "noamfrostig@gmail.com",
    "themoti@gmail.com",
    "Moranmta@gmail.com",
    "4337579@gmail.com",
    "rasherov@gmail.com",
    "ranbo7@gmail.com",
    "shaywolf251996@gmail.com",
    "Dinofek@gmail.com",
    "Yafit.neveshalev@gmail.com",
    "Yovelk11@gmail.com",
    "Lalobenny@gmail.com",
    "aharonayal@gmail.com",
]
ALLOWED_ORIGINS = {
    "http://127.0.0.1:8766",
    "http://127.0.0.1:8767",
    "http://127.0.0.1:8791",
    "http://localhost:8766",
    "http://localhost:8767",
    "http://localhost:8791",
}
SECURITY_HEADERS = (
    ("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:8767 http://localhost:8767 http://127.0.0.1:8791 http://localhost:8791; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("Cross-Origin-Resource-Policy", "same-origin"),
    ("Permissions-Policy", "camera=(), microphone=(), geolocation=()"),
)


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def load_manager_emails() -> list[str]:
    emails = [normalize_email(email) for email in DEFAULT_MANAGER_EMAILS if normalize_email(email)]

    if ACCESS_CONTROL_PATH.exists():
        try:
            payload = json.loads(ACCESS_CONTROL_PATH.read_text(encoding="utf-8"))
            file_emails = payload.get("managerEmails")
            if isinstance(file_emails, list) and file_emails:
                normalized = [normalize_email(str(item)) for item in file_emails if normalize_email(str(item))]
                if normalized:
                    emails = normalized
        except json.JSONDecodeError:
            pass

    env_emails = os.getenv("YELLOW_DASHBOARD_MANAGER_EMAILS", "").strip()
    if env_emails:
        try:
            parsed = json.loads(env_emails)
            if isinstance(parsed, list) and parsed:
                normalized = [normalize_email(str(item)) for item in parsed if normalize_email(str(item))]
                if normalized:
                    emails = normalized
        except json.JSONDecodeError:
            normalized = [normalize_email(item) for item in env_emails.split(",") if normalize_email(item)]
            if normalized:
                emails = normalized

    unique_emails: list[str] = []
    seen: set[str] = set()
    for email in emails:
        if email and email not in seen:
            unique_emails.append(email)
            seen.add(email)
    return unique_emails


def ensure_data_dir() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    ensure_data_dir()
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            password_set_at TEXT,
            last_login_at TEXT
        );

        CREATE TABLE IF NOT EXISTS admin_sessions (
            token TEXT PRIMARY KEY,
            admin_email TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY(admin_email) REFERENCES admins(email) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_admin_sessions_email
        ON admin_sessions(admin_email);

        CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires
        ON admin_sessions(expires_at);
        """
    )
    connection.commit()


def seed_admins(connection: sqlite3.Connection) -> None:
    created_at = isoformat_utc(utc_now())
    for email in load_manager_emails():
        connection.execute(
            """
            INSERT INTO admins (email, created_at)
            VALUES (?, ?)
            ON CONFLICT(email) DO NOTHING
            """,
            (email, created_at),
        )
    connection.commit()


def initialize_database() -> None:
    with get_connection() as connection:
        ensure_schema(connection)
        seed_admins(connection)


def cleanup_expired_sessions(connection: sqlite3.Connection) -> None:
    connection.execute(
        "DELETE FROM admin_sessions WHERE expires_at <= ?",
        (isoformat_utc(utc_now()),),
    )
    connection.commit()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )
    return "pbkdf2_sha256${iterations}${salt}${digest}".format(
        iterations=PASSWORD_ITERATIONS,
        salt=base64.urlsafe_b64encode(salt).decode("ascii"),
        digest=base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations_text, salt_b64, digest_b64 = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_text)
        salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
        expected_digest = base64.urlsafe_b64decode(digest_b64.encode("ascii"))
    except (ValueError, TypeError):
        return False

    candidate_digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(candidate_digest, expected_digest)


def get_admin(connection: sqlite3.Connection, email: str) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT email, password_hash, is_active, password_set_at, last_login_at FROM admins WHERE lower(email) = ?",
        (normalize_email(email),),
    ).fetchone()


def update_admin_password(connection: sqlite3.Connection, email: str, password: str) -> None:
    connection.execute(
        """
        UPDATE admins
        SET password_hash = ?, password_set_at = ?
        WHERE lower(email) = ?
        """,
        (
            hash_password(password),
            isoformat_utc(utc_now()),
            normalize_email(email),
        ),
    )
    connection.commit()


def create_session(connection: sqlite3.Connection, email: str) -> str:
    cleanup_expired_sessions(connection)
    token = secrets.token_urlsafe(32)
    created_at = utc_now()
    expires_at = created_at + timedelta(hours=SESSION_DURATION_HOURS)
    connection.execute(
        """
        INSERT INTO admin_sessions (token, admin_email, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        """,
        (
            token,
            normalize_email(email),
            isoformat_utc(created_at),
            isoformat_utc(expires_at),
        ),
    )
    connection.execute(
        """
        UPDATE admins
        SET last_login_at = ?
        WHERE lower(email) = ?
        """,
        (isoformat_utc(created_at), normalize_email(email)),
    )
    connection.commit()
    return token


def delete_session(connection: sqlite3.Connection, token: str) -> None:
    connection.execute("DELETE FROM admin_sessions WHERE token = ?", (token,))
    connection.commit()


def get_authenticated_email(connection: sqlite3.Connection, token: str) -> str | None:
    cleanup_expired_sessions(connection)
    record = connection.execute(
        """
        SELECT admin_sessions.admin_email
        FROM admin_sessions
        JOIN admins ON lower(admins.email) = lower(admin_sessions.admin_email)
        WHERE admin_sessions.token = ? AND admins.is_active = 1
        """,
        (token,),
    ).fetchone()
    return normalize_email(record["admin_email"]) if record else None


def build_set_cookie(token: str | None, max_age: int) -> str:
    cookie = SimpleCookie()
    cookie[SESSION_COOKIE_NAME] = token or ""
    morsel = cookie[SESSION_COOKIE_NAME]
    morsel["path"] = "/"
    morsel["httponly"] = True
    morsel["samesite"] = "Lax"
    morsel["max-age"] = max_age
    if os.getenv("YELLOW_DASHBOARD_SECURE_COOKIES", "").strip().lower() in {"1", "true", "yes", "on"}:
        morsel["secure"] = True
    return cookie.output(header="").strip()


def load_admin_dataset_payload() -> dict[str, Any] | None:
    if not ADMIN_DATASET_PATH.exists():
        return None
    try:
        payload = json.loads(ADMIN_DATASET_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


class DashboardServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, server_address: tuple[str, int], handler_class: type[BaseHTTPRequestHandler]) -> None:
        super().__init__(server_address, handler_class)
        self.browser_output = OUTPUTS_DIR / "yellow-project-dashboard-browser.html"
        self.shell_output = OUTPUTS_DIR / "yellow-project-dashboard.html"


class DashboardRequestHandler(BaseHTTPRequestHandler):
    server_version = "YellowDashboardBackend/1.0"

    @property
    def dashboard_server(self) -> DashboardServer:
        return self.server  # type: ignore[return-value]

    def log_message(self, format: str, *args: Any) -> None:
        super().log_message(format, *args)

    def send_security_headers(self) -> None:
        for key, value in SECURITY_HEADERS:
            self.send_header(key, value)

    def is_request_origin_allowed(self) -> bool:
        origin = (self.headers.get("Origin") or "").strip()
        return not origin or origin in ALLOWED_ORIGINS

    def get_cors_headers(self) -> list[tuple[str, str]]:
        origin = (self.headers.get("Origin") or "").strip()
        if origin and origin in ALLOWED_ORIGINS:
            return [
                ("Access-Control-Allow-Origin", origin),
                ("Access-Control-Allow-Credentials", "true"),
                ("Access-Control-Allow-Headers", "Content-Type"),
                ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
                ("Vary", "Origin"),
            ]
        return []

    def do_OPTIONS(self) -> None:
        if not self.is_request_origin_allowed():
            self.send_response(HTTPStatus.FORBIDDEN)
            self.send_security_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_security_headers()
        for key, value in self.get_cors_headers():
            self.send_header(key, value)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.respond_json(HTTPStatus.OK, {"ok": True, "service": "yellow-dashboard-backend"})
            return
        if parsed.path == "/api/auth/status":
            self.handle_auth_status()
            return
        if parsed.path == "/api/admin/dataset":
            self.handle_admin_dataset()
            return
        if parsed.path in {"/", "/index.html", "/yellow-project-dashboard-browser.html"}:
            self.serve_file(self.dashboard_server.browser_output, "text/html; charset=utf-8")
            return
        if parsed.path == "/yellow-project-dashboard.html":
            self.serve_file(self.dashboard_server.shell_output, "text/html; charset=utf-8")
            return
        self.respond_json(HTTPStatus.NOT_FOUND, {"message": "הנתיב המבוקש לא נמצא."})

    def do_POST(self) -> None:
        if not self.is_request_origin_allowed():
            self.respond_json(HTTPStatus.FORBIDDEN, {"message": "מקור הבקשה אינו מורשה."})
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/auth/login":
            self.handle_auth_login()
            return
        if parsed.path == "/api/auth/setup":
            self.handle_auth_setup()
            return
        if parsed.path == "/api/auth/logout":
            self.handle_auth_logout()
            return
        if parsed.path == "/api/auth/reset-local":
            self.handle_auth_reset_local()
            return
        self.respond_json(HTTPStatus.NOT_FOUND, {"message": "הנתיב המבוקש לא נמצא."})

    def read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            parsed = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            parsed = {}
        return parsed if isinstance(parsed, dict) else {}

    def respond_json(
        self,
        status: HTTPStatus,
        payload: dict[str, Any],
        extra_headers: list[tuple[str, str]] | None = None,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_security_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        for key, value in self.get_cors_headers():
            self.send_header(key, value)
        if extra_headers:
            for key, value in extra_headers:
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, path: Path, content_type: str) -> None:
        if not path.exists():
            self.respond_json(
                HTTPStatus.NOT_FOUND,
                {"message": f"הקובץ {path.name} עדיין לא נבנה. הריצו קודם את build הדשבורד."},
            )
            return
        content = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_security_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        for key, value in self.get_cors_headers():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(content)

    def get_session_token(self) -> str:
        cookie_header = self.headers.get("Cookie", "")
        cookie = SimpleCookie()
        cookie.load(cookie_header)
        morsel = cookie.get(SESSION_COOKIE_NAME)
        return morsel.value if morsel else ""

    def handle_auth_status(self) -> None:
        token = self.get_session_token()
        authenticated_email = None
        if token:
            with get_connection() as connection:
                ensure_schema(connection)
                seed_admins(connection)
                authenticated_email = get_authenticated_email(connection, token)

        self.respond_json(
            HTTPStatus.OK,
            {
                "mode": "backend",
                "authenticated": bool(authenticated_email),
                "email": authenticated_email or "",
                "setupSupported": True,
            },
        )

    def handle_admin_dataset(self) -> None:
        token = self.get_session_token()
        authenticated_email = None
        if token:
            with get_connection() as connection:
                ensure_schema(connection)
                seed_admins(connection)
                authenticated_email = get_authenticated_email(connection, token)

        if not authenticated_email:
            self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "נדרשת התחברות מנהל כדי לטעון את הנתונים הניהוליים."})
            return

        payload = load_admin_dataset_payload()
        if not payload:
            self.respond_json(
                HTTPStatus.NOT_FOUND,
                {"message": "מאגר הנתונים הניהולי לא זמין כרגע. אפשר להעלות קובץ עסקאות ידנית לאחר הכניסה."},
            )
            return

        self.respond_json(
            HTTPStatus.OK,
            {
                "rows": payload.get("rows", []),
                "meta": payload.get("meta", {}),
                "sourceLabel": payload.get("sourceLabel", "קובץ בסיס מאובטח"),
                "generatedAt": payload.get("generatedAt", ""),
            },
        )

    def handle_auth_login(self) -> None:
        payload = self.read_json_body()
        email = normalize_email(str(payload.get("email", "")))
        password = str(payload.get("password", ""))
        if not email or not password:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "יש למלא גם מייל וגם סיסמה."})
            return

        with get_connection() as connection:
            ensure_schema(connection)
            seed_admins(connection)
            admin = get_admin(connection, email)
            if not admin or not bool(admin["is_active"]):
                self.respond_json(
                    HTTPStatus.FORBIDDEN,
                    {"message": "המייל שהוזן אינו מורשה לגישה לפאנל הניהול."},
                )
                return
            if not admin["password_hash"]:
                self.respond_json(
                    HTTPStatus.CONFLICT,
                    {
                        "message": "זו כניסה ראשונה עבור המייל הזה. יש להגדיר סיסמה אישית לפני כניסה.",
                        "code": "setup_required",
                        "setupRequired": True,
                    },
                )
                return
            if not verify_password(password, str(admin["password_hash"])):
                self.respond_json(HTTPStatus.UNAUTHORIZED, {"message": "הסיסמה שגויה. נסו שוב."})
                return

            token = create_session(connection, email)

        self.respond_json(
            HTTPStatus.OK,
            {
                "authenticated": True,
                "email": email,
                "message": "הכניסה הצליחה. הדשבורד הניהולי נפתח.",
            },
            extra_headers=[("Set-Cookie", build_set_cookie(token, SESSION_DURATION_HOURS * 60 * 60))],
        )

    def handle_auth_setup(self) -> None:
        payload = self.read_json_body()
        email = normalize_email(str(payload.get("email", "")))
        password = str(payload.get("password", ""))
        confirm_password = str(payload.get("confirmPassword", ""))
        if not email or not password or not confirm_password:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "יש למלא מייל, סיסמה ואימות סיסמה."})
            return
        if password != confirm_password:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "אימות הסיסמה לא תואם."})
            return
        if len(password) < 8:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "יש לבחור סיסמה באורך 8 תווים לפחות."})
            return

        with get_connection() as connection:
            ensure_schema(connection)
            seed_admins(connection)
            admin = get_admin(connection, email)
            if not admin or not bool(admin["is_active"]):
                self.respond_json(
                    HTTPStatus.FORBIDDEN,
                    {"message": "המייל שהוזן אינו מורשה להגדיר גישת מנהל."},
                )
                return
            if admin["password_hash"]:
                self.respond_json(
                    HTTPStatus.CONFLICT,
                    {"message": "כבר הוגדרה סיסמה עבור המייל הזה. ניתן לעבור למסך הכניסה הרגיל."},
                )
                return

            update_admin_password(connection, email, password)
            token = create_session(connection, email)

        self.respond_json(
            HTTPStatus.OK,
            {
                "authenticated": True,
                "email": email,
                "message": "הסיסמה נשמרה והגישה לפאנל הניהול נפתחה.",
            },
            extra_headers=[("Set-Cookie", build_set_cookie(token, SESSION_DURATION_HOURS * 60 * 60))],
        )

    def handle_auth_logout(self) -> None:
        token = self.get_session_token()
        if token:
            with get_connection() as connection:
                ensure_schema(connection)
                delete_session(connection, token)

        self.respond_json(
            HTTPStatus.OK,
            {"loggedOut": True},
            extra_headers=[("Set-Cookie", build_set_cookie(None, 0))],
        )

    def handle_auth_reset_local(self) -> None:
        payload = self.read_json_body()
        email = normalize_email(str(payload.get("email", "")))
        if not email:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"message": "יש להזין מייל מנהל/ת כדי לאפס סיסמה."})
            return

        with get_connection() as connection:
            ensure_schema(connection)
            seed_admins(connection)
            admin = get_admin(connection, email)
            if not admin or not bool(admin["is_active"]):
                self.respond_json(
                    HTTPStatus.FORBIDDEN,
                    {"message": "המייל שהוזן אינו מורשה לאיפוס במערכת הניהול המקומית."},
                )
                return
            connection.execute(
                """
                UPDATE admins
                SET password_hash = NULL, password_set_at = NULL, last_login_at = NULL
                WHERE lower(email) = ?
                """,
                (normalize_email(email),),
            )
            connection.execute(
                "DELETE FROM admin_sessions WHERE lower(admin_email) = ?",
                (normalize_email(email),),
            )
            connection.commit()

        self.respond_json(
            HTTPStatus.OK,
            {
                "reset": True,
                "email": email,
                "message": "הסיסמה אופסה במערכת המקומית. בכניסה הבאה יש להגדיר סיסמה חדשה.",
            },
            extra_headers=[("Set-Cookie", build_set_cookie(None, 0))],
        )


def serve(host: str = "127.0.0.1", port: int = 8767) -> None:
    initialize_database()
    server = DashboardServer((host, port), DashboardRequestHandler)
    print(f"Yellow dashboard backend listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
