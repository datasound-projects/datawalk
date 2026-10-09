"""Accounts and sign-in: local passwords (scrypt), browser sessions, API tokens for publishing,
OIDC (Authlib), and SAML 2.0 Web SSO (signxml verifies the signatures). Multi-factor
authentication is the identity provider's task."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
import zlib
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, NamedTuple
from urllib.parse import urlencode

from .i18n import t
from .store import Store, token_hash

if TYPE_CHECKING:
    from .config import SamlConfig

SESSION_SECONDS = 7 * 24 * 3600
SCRYPT = {"n": 2**14, "r": 8, "p": 1}


class AuthError(ValueError):
    pass


# -- local accounts ---------------------------------------------------------------------


def hash_password(password: str) -> str:
    if len(password) < 12:
        raise AuthError(t("auth.short_password"))
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **SCRYPT)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def check_password(password: str, stored: str | None) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        hashlib.scrypt(b"x", salt=b"0" * 16, dklen=32, **SCRYPT)  # same work for unknown users
        return False
    _, salt, digest = stored.split("$")
    got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), dklen=32, **SCRYPT)
    return hmac.compare_digest(got, base64.b64decode(digest))


def create_user(
    store: Store,
    email: str,
    name: str,
    password: str | None = None,
    admin: bool = False,
    sso_subject: str | None = None,
) -> int:
    email = email.strip().lower()
    if "@" not in email:
        raise AuthError(t("auth.no_email"))
    with store.tx() as db:
        cur = db.execute(
            "INSERT INTO users (email, name, password_hash, sso_subject, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (
                email,
                name or email,
                hash_password(password) if password else None,
                sso_subject,
                int(admin),
                time.time(),
            ),
        )
    return cur.lastrowid


def sso_user(
    store: Store,
    subject: str,
    email: str,
    name: str,
    *,
    verified: bool = True,
    link_to: int | None = None,
) -> int:
    """The user for an SSO identity: by subject; else the signed-in user who connects SSO
    (`link_to`); else an account that waits for its first SSO sign-in; else a new account.

    E-mail alone never opens an account that has a password (account takeover): its owner
    signs in with the password and connects SSO on the Account page. An e-mail that the
    identity provider did not verify (`verified=False`) is not used at all."""
    row = store.one("SELECT id FROM users WHERE sso_subject = ?", subject)
    if row:
        if link_to is not None and row["id"] != link_to:
            raise AuthError(t("auth.sso_taken"))
        return row["id"]
    if link_to is not None:
        with store.tx() as db:
            cur = db.execute(
                "UPDATE users SET sso_subject = ? WHERE id = ? AND sso_subject IS NULL",
                (subject, link_to),
            )
        if cur.rowcount != 1:
            raise AuthError(t("auth.sso_taken"))
        return link_to
    email = (email or "").strip().lower()
    if not email:
        raise AuthError(t("auth.idp_no_email"))
    if not verified:
        raise AuthError(t("auth.email_unverified"))
    row = store.one("SELECT id, sso_subject, password_hash FROM users WHERE email = ?", email)
    if row is None:
        return create_user(store, email, name or email, sso_subject=subject)
    if row["sso_subject"] is None and row["password_hash"] is None:  # created with --sso-only
        with store.tx() as db:
            db.execute("UPDATE users SET sso_subject = ? WHERE id = ?", (subject, row["id"]))
        return row["id"]
    raise AuthError(t("auth.email_taken"))


# -- sessions and tokens ------------------------------------------------------------------


def new_session(store: Store, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = time.time()
    with store.tx() as db:
        db.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        db.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token_hash(token), user_id, now, now + SESSION_SECONDS),
        )
    return token


def session_user(store: Store, token: str | None):
    if not token:
        return None
    return store.one(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
        token_hash(token),
        time.time(),
    )


def end_session(store: Store, token: str | None) -> None:
    if token:
        with store.tx() as db:
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))


def new_api_token(store: Store, user_id: int, name: str) -> str:
    token = "dwh_" + secrets.token_urlsafe(32)
    with store.tx() as db:
        db.execute(
            "INSERT INTO api_tokens (token_hash, user_id, name, created_at) VALUES (?, ?, ?, ?)",
            (token_hash(token), user_id, name, time.time()),
        )
    return token


def token_user(store: Store, token: str | None):
    if not token:
        return None
    row = store.one(
        "SELECT u.* FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?",
        token_hash(token),
    )
    if row:
        with store.tx() as db:
            db.execute(
                "UPDATE api_tokens SET last_used = ? WHERE token_hash = ?",
                (time.time(), token_hash(token)),
            )
    return row


# -- SAML 2.0 (service provider, HTTP-Redirect request, HTTP-POST response) ----------------

NS = {
    "samlp": "urn:oasis:names:tc:SAML:2.0:protocol",
    "saml": "urn:oasis:names:tc:SAML:2.0:assertion",
}
SKEW = timedelta(minutes=2)


def saml_request(cfg: SamlConfig, acs_url: str, relay_state: str) -> tuple[str, str]:
    """Redirect URL to the identity provider, and the request id (to check InResponseTo)."""
    request_id = "_" + secrets.token_hex(16)
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    xml = (
        f'<samlp:AuthnRequest xmlns:samlp="{NS["samlp"]}" xmlns:saml="{NS["saml"]}" ID="{request_id}" '
        f'Version="2.0" IssueInstant="{now}" Destination="{cfg.idp_sso_url}" '
        f'AssertionConsumerServiceURL="{acs_url}" '
        f'ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">'
        f"<saml:Issuer>{cfg.sp_entity_id}</saml:Issuer></samlp:AuthnRequest>"
    )
    deflated = zlib.compress(xml.encode())[2:-4]  # raw DEFLATE
    query = urlencode(
        {"SAMLRequest": base64.b64encode(deflated).decode(), "RelayState": relay_state}
    )
    sep = "&" if "?" in cfg.idp_sso_url else "?"
    return f"{cfg.idp_sso_url}{sep}{query}", request_id


def _time(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class SamlIdentity(NamedTuple):
    subject: str
    email: str
    name: str
    assertion: str  # issuer and assertion ID: one assertion signs in once
    until: float  # after this time, the assertion is refused anyway


def saml_identity(
    cfg: SamlConfig, saml_response_b64: str, acs_url: str, request_id: str | None
) -> SamlIdentity:
    """Check a SAML response. Only the part that the identity provider signed is read (no
    signature wrapping)."""
    from lxml import etree
    from signxml import XMLVerifier

    try:
        xml = base64.b64decode(saml_response_b64)
        verified = XMLVerifier().verify(xml, x509_cert=cfg.idp_cert).signed_xml
    except Exception as e:  # malformed, unsigned, wrong key, weak algorithm
        raise AuthError(t("auth.saml_invalid", error=e)) from None
    root = verified
    if etree.QName(root).localname == "Response":
        status = root.find("samlp:Status/samlp:StatusCode", NS)
        if status is None or not status.get("Value", "").endswith(":Success"):
            raise AuthError(t("auth.saml_refused"))
        if root.get("InResponseTo") and root.get("InResponseTo") != request_id:
            raise AuthError(t("auth.saml_other_request"))
        assertions = root.findall("saml:Assertion", NS)
        if len(assertions) != 1:
            raise AuthError(t("auth.one_assertion"))
        assertion = assertions[0]
    elif etree.QName(root).localname == "Assertion":
        assertion = root
    else:
        raise AuthError(t("auth.not_saml"))
    issuer = assertion.findtext("saml:Issuer", namespaces=NS)
    if issuer != cfg.idp_entity_id:
        raise AuthError(t("auth.other_idp"))
    now = datetime.now(UTC)
    cond = assertion.find("saml:Conditions", NS)
    if cond is None:
        raise AuthError(t("auth.no_conditions"))
    nb, noa = _time(cond.get("NotBefore")), _time(cond.get("NotOnOrAfter"))
    if (nb and now + SKEW < nb) or (noa and now - SKEW >= noa):
        raise AuthError(t("auth.not_valid_now"))
    audiences = [a.text for a in cond.findall("saml:AudienceRestriction/saml:Audience", NS)]
    if cfg.sp_entity_id not in audiences:
        raise AuthError(t("auth.other_service"))
    assertion_id = assertion.get("ID")
    if not assertion_id:
        raise AuthError(t("auth.no_subject"))
    confirmed, until = False, noa
    for data in assertion.findall(
        "saml:Subject/saml:SubjectConfirmation/saml:SubjectConfirmationData", NS
    ):
        until = _time(data.get("NotOnOrAfter"))
        valid = _time(data.get("NotOnOrAfter"))
        if data.get("Recipient") == acs_url and valid and now - SKEW < valid:
            if data.get("InResponseTo") in (None, request_id):
                confirmed, until = True, max(until or valid, valid)
    if not confirmed:
        raise AuthError(t("auth.not_confirmed"))
    name_id = assertion.findtext("saml:Subject/saml:NameID", namespaces=NS)
    if not name_id:
        raise AuthError(t("auth.no_subject"))
    attrs: dict[str, str] = {}
    for a in assertion.findall("saml:AttributeStatement/saml:Attribute", NS):
        value = a.findtext("saml:AttributeValue", namespaces=NS)
        if value:
            attrs[a.get("Name", "").rsplit("/", 1)[-1].lower()] = value
    email = (
        attrs.get("email")
        or attrs.get("emailaddress")
        or attrs.get("mail")
        or (name_id if "@" in name_id else "")
    )
    name = attrs.get("name") or attrs.get("displayname") or attrs.get("givenname") or email
    return SamlIdentity(
        f"saml:{issuer}:{name_id}",
        email,
        name,
        f"{issuer} {assertion_id}",
        ((until or now) + SKEW).timestamp(),
    )


def saml_metadata(cfg: SamlConfig, acs_url: str) -> str:
    return (
        '<?xml version="1.0"?>'
        f'<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="{cfg.sp_entity_id}">'
        '<md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" '
        'protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">'
        '<md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" '
        f'Location="{acs_url}" index="0"/></md:SPSSODescriptor></md:EntityDescriptor>'
    )
