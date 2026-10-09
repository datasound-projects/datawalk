"""Hub settings from environment variables. Admin settings that change at run time
(public links, analytics, retention, embedding) are in the database (store.settings)."""

from __future__ import annotations

import base64
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass
class OidcConfig:
    issuer: str  # discovery: <issuer>/.well-known/openid-configuration
    client_id: str
    client_secret: str
    name: str = "Single sign-on"
    scopes: str = "openid email profile"


@dataclass
class SamlConfig:
    idp_entity_id: str
    idp_sso_url: str  # HTTP-Redirect binding
    idp_cert: str  # PEM: the certificate that signs responses
    sp_entity_id: str
    name: str = "SAML sign-on"


@dataclass
class Config:
    data_dir: Path
    base_url: str  # https://hub.example.internal (links, OIDC and SAML callbacks)
    secret_key: str  # signs session state for SSO round trips
    encryption_key: bytes  # AES-256-GCM, 32 bytes: archives and comment text at rest
    secure_cookies: bool
    oidc: OidcConfig | None = None
    saml: SamlConfig | None = None
    local_accounts: bool = True
    notes: list[str] = field(default_factory=list)  # warnings for the operator

    @classmethod
    def from_env(cls) -> Config:
        data = Path(_env("HUB_DATA_DIR", "hub-data")).resolve()
        data.mkdir(parents=True, exist_ok=True)
        notes = []
        key = _env("HUB_ENCRYPTION_KEY")
        if key:
            raw = base64.b64decode(key)
        else:
            # Development only: a key file next to the data. Production sets the variable from
            # a secret store, so that the key is not on the same volume as the data.
            path = data / "encryption.key"
            if not path.exists():
                path.write_bytes(base64.b64encode(secrets.token_bytes(32)))
                path.chmod(0o600)
            raw = base64.b64decode(path.read_bytes())
            notes.append("HUB_ENCRYPTION_KEY is not set: the key is in the data directory.")
        if len(raw) != 32:
            raise ValueError("HUB_ENCRYPTION_KEY must be 32 bytes, base64-encoded")
        secret = _env("HUB_SECRET_KEY") or secrets.token_urlsafe(32)
        base = _env("HUB_BASE_URL", "http://127.0.0.1:8800").rstrip("/")
        oidc = (
            OidcConfig(
                _env("OIDC_ISSUER").rstrip("/"),
                _env("OIDC_CLIENT_ID"),
                _env("OIDC_CLIENT_SECRET"),
                _env("OIDC_NAME", "Single sign-on"),
            )
            if _env("OIDC_ISSUER")
            else None
        )
        saml = (
            SamlConfig(
                _env("SAML_IDP_ENTITY_ID"),
                _env("SAML_IDP_SSO_URL"),
                Path(_env("SAML_IDP_CERT_FILE")).read_text(),
                _env("SAML_SP_ENTITY_ID", base + "/saml/metadata"),
                _env("SAML_NAME", "SAML sign-on"),
            )
            if _env("SAML_IDP_SSO_URL")
            else None
        )
        return cls(
            data_dir=data,
            base_url=base,
            secret_key=secret,
            encryption_key=raw,
            secure_cookies=base.startswith("https://"),
            oidc=oidc,
            saml=saml,
            local_accounts=_env("HUB_LOCAL_ACCOUNTS", "1") != "0",
            notes=notes,
        )
