"""Storage: SQLite for metadata, encrypted files for report archives.

Archives and comment text are encrypted at rest with AES-256-GCM. The database holds names,
permissions, and the audit log in clear text (put it on an encrypted volume as well).
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT, sso_subject TEXT UNIQUE, is_admin INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id));
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at REAL NOT NULL, classification TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS revisions (
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE, number INTEGER NOT NULL,
  created_at REAL NOT NULL, author_id INTEGER REFERENCES users(id), size INTEGER NOT NULL,
  sha256 TEXT NOT NULL, changes TEXT NOT NULL, PRIMARY KEY (report_id, number));
CREATE TABLE IF NOT EXISTS grants (
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  principal TEXT NOT NULL CHECK (principal IN ('user', 'group')), principal_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (report_id, principal, principal_id));
CREATE TABLE IF NOT EXISTS links (
  token_hash TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  public INTEGER NOT NULL, created_by INTEGER NOT NULL, created_at REAL NOT NULL,
  expires_at REAL, revoked INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  viz_key TEXT NOT NULL, parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id), body BLOB NOT NULL, kind TEXT NOT NULL,
  created_at REAL NOT NULL, resolved_at REAL, resolved_by INTEGER);
CREATE TABLE IF NOT EXISTS mentions (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, seen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (comment_id, user_id));
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, at REAL NOT NULL, user_id INTEGER, action TEXT NOT NULL,
  report_id TEXT, detail TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at REAL NOT NULL, expires_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at REAL NOT NULL, last_used REAL);
CREATE TABLE IF NOT EXISTS views (
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE, viz_key TEXT NOT NULL,
  day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (report_id, viz_key, day));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

# Admin settings with their defaults. Public links and analytics are off by default.
DEFAULT_SETTINGS: dict[str, Any] = {
    "public_links": False,  # links that need no sign-in (they always expire)
    "public_link_max_days": 30,
    "analytics": False,  # aggregate views per chart; viewers see a notice
    "retention_days": 0,  # delete revisions older than this (0: keep); the latest stays
    "keep_revisions": 0,  # keep at most this many revisions (0: all)
    "frame_ancestors": "",  # sites that may embed reports in an iframe (SharePoint, ...)
}


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Store:
    def __init__(self, data_dir: Path, key: bytes):
        self.dir = data_dir
        (data_dir / "archives").mkdir(parents=True, exist_ok=True)
        self.aead = AESGCM(key)
        self._lock = threading.Lock()
        self.db = sqlite3.connect(
            data_dir / "hub.db", check_same_thread=False, isolation_level=None
        )
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SCHEMA)

    # -- database -----------------------------------------------------------------------

    @contextmanager
    def tx(self):
        # ponytail: one lock for all writes; SQLite allows one writer anyway. A server
        # database (PostgreSQL) is the upgrade for many concurrent publishers.
        with self._lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield self.db
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def one(self, sql: str, *args: Any) -> sqlite3.Row | None:
        return self.db.execute(sql, args).fetchone()

    def all(self, sql: str, *args: Any) -> list[sqlite3.Row]:
        return self.db.execute(sql, args).fetchall()

    def setting(self, key: str) -> Any:
        row = self.one("SELECT value FROM settings WHERE key = ?", key)
        return json.loads(row["value"]) if row else DEFAULT_SETTINGS[key]

    def set_setting(self, key: str, value: Any) -> None:
        if key not in DEFAULT_SETTINGS:
            raise KeyError(key)
        with self.tx() as db:
            db.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )

    def audit(
        self,
        action: str,
        user_id: int | None,
        report_id: str | None = None,
        ip: str = "",
        **detail: Any,
    ) -> None:
        with self.tx() as db:
            db.execute(
                "INSERT INTO audit (at, user_id, action, report_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?)",
                (time.time(), user_id, action, report_id, json.dumps(detail), ip),
            )

    # -- encryption ---------------------------------------------------------------------

    def seal(self, data: bytes, context: str) -> bytes:
        """AES-256-GCM. `context` (for example the file name) is authenticated, so that a
        sealed value cannot be moved to another record."""
        nonce = secrets.token_bytes(12)
        return nonce + self.aead.encrypt(nonce, data, context.encode())

    def open(self, sealed: bytes, context: str) -> bytes:
        return self.aead.decrypt(sealed[:12], sealed[12:], context.encode())

    # -- archives -----------------------------------------------------------------------

    def archive_path(self, report_id: str, number: int) -> Path:
        return self.dir / "archives" / f"{report_id}-{number}.dwk.enc"

    def write_archive(self, report_id: str, number: int, data: bytes) -> None:
        path = self.archive_path(report_id, number)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(self.seal(data, path.name))
        os.replace(tmp, path)

    def read_archive(self, report_id: str, number: int) -> bytes:
        path = self.archive_path(report_id, number)
        return self.open(path.read_bytes(), path.name)

    def delete_archive(self, report_id: str, number: int) -> None:
        self.archive_path(report_id, number).unlink(missing_ok=True)
