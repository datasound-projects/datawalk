import base64
import re
import secrets
import threading
import time
import zlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pytest  # noqa: E402
from datawalk_hub import auth  # noqa: E402
from datawalk_hub.app import create_app  # noqa: E402
from datawalk_hub.config import Config, OidcConfig, SamlConfig  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import datawalk as dw  # noqa: E402

BASE = "http://hub.test"
ORIGIN = {"Origin": BASE}


def archive(tmp: Path, revenue: float = 10.0, extra: bool = False) -> bytes:
    r = dw.Report("Quarterly", id="a" * 32)
    fig, ax = plt.subplots()
    ax.plot([1, 2, 3])
    r.add(fig, key="trend", room="Main")
    r.add_kpi("revenue", "Revenue", revenue, unit="EUR", room="Main")
    if extra:
        fig, ax = plt.subplots()
        ax.bar([1, 2], [3, 4])
        r.add(fig, key="bars", room="Main")
    path = tmp / f"r{revenue}{extra}.dwk"
    r.save(path, merge=False)
    plt.close("all")
    return path.read_bytes()


@pytest.fixture
def hub(tmp_path):
    cfg = Config(
        data_dir=tmp_path / "data", base_url=BASE, secret_key="s" * 32,
        encryption_key=b"k" * 32, secure_cookies=False,
    )  # fmt: skip
    cfg.data_dir.mkdir()
    app = create_app(cfg)
    store = app.state.store
    admin = auth.create_user(store, "admin@example.org", "Admin", "admin-password-1", admin=True)
    ana = auth.create_user(store, "ana@example.org", "Ana", "ana-password-123")
    ben = auth.create_user(store, "ben@example.org", "Ben", "ben-password-123")
    return type(
        "Hub",
        (),
        {
            "app": app,
            "cfg": cfg,
            "store": store,
            "ids": {"admin": admin, "ana": ana, "ben": ben},
            "tmp": tmp_path,
        },
    )


def client(hub, who: str | None = None) -> TestClient:
    c = TestClient(hub.app, base_url=BASE)
    if who:
        res = c.post(
            "/login",
            data={
                "email": f"{who}@example.org",
                "password": f"{who}-password-{'1' if who == 'admin' else '123'}",
            },
            headers=ORIGIN,
            follow_redirects=False,
        )
        assert res.status_code == 303 and res.headers["location"] == "/", res.text
    return c


def publish(hub, who: str, data: bytes) -> dict:
    token = auth.new_api_token(hub.store, hub.ids[who], "t")
    res = TestClient(hub.app, base_url=BASE).post(
        "/api/publish", content=data, headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_sign_in_publish_revisions_and_kpi_deltas(hub):
    bad = TestClient(hub.app, base_url=BASE).post(
        "/login",
        data={"email": "ana@example.org", "password": "wrong"},
        headers=ORIGIN,
        follow_redirects=False,
    )
    assert "error=1" in bad.headers["location"]
    first = publish(hub, "ana", archive(hub.tmp))
    assert (first["revision"], first["report_id"]) == (1, "a" * 32)
    second = publish(hub, "ana", archive(hub.tmp, revenue=12.5, extra=True))
    assert second["revision"] == 2
    c = second["changes"]
    assert [x["key"] for x in c["added"]] == ["bars"]
    assert c["kpis"] == [
        {
            "key": "revenue",
            "name": "Revenue",
            "before": "10",
            "after": "12.5",
            "delta": 2.5,
            "unit": "EUR",
        }
    ]
    ana = client(hub, "ana")
    page = ana.get(f"/reports/{'a' * 32}")
    assert (
        "Revenue: 10 → 12.5 (+2.5 EUR)" in page.text
        and "Added: Bars" in page.text
        or "Added:" in page.text
    )
    assert ana.get(f"/r/{'a' * 32}/api/report").json()["name"] == "Quarterly"
    assert ana.get(f"/r/{'a' * 32}/v/1/api/report").status_code == 200  # an earlier revision
    # Others publish new revisions only as editors or owners.
    token = auth.new_api_token(hub.store, hub.ids["ben"], "t")
    res = TestClient(hub.app, base_url=BASE).post(
        "/api/publish", content=archive(hub.tmp), headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 403
    actions = [r["action"] for r in hub.store.all("SELECT action FROM audit")]
    assert {"user.sign_in_failed", "report.published", "user.signed_in"} <= set(actions)


def test_encryption_at_rest(hub):
    publish(hub, "ana", archive(hub.tmp))
    raw = (hub.cfg.data_dir / "archives" / f"{'a' * 32}-1.dwk.enc").read_bytes()
    assert b"report.json" not in raw and not raw.startswith(b"PK")
    ana = client(hub, "ana")
    ana.post(
        f"/r/{'a' * 32}/api/comments",
        json={"key": "trend", "body": "Secret remark"},
        headers=ORIGIN,
    )
    body = hub.store.one("SELECT body FROM comments")["body"]
    assert b"Secret remark" not in body
    db = (hub.cfg.data_dir / "hub.db").read_bytes() + (hub.cfg.data_dir / "hub.db-wal").read_bytes()
    assert b"Secret remark" not in db


def test_permissions_groups_and_links(hub):
    rid = publish(hub, "ana", archive(hub.tmp))["report_id"]
    ana, ben = client(hub, "ana"), client(hub, "ben")
    assert ben.get(f"/r/{rid}/api/report").status_code == 403
    assert (
        ben.post(
            f"/reports/{rid}/share",
            data={"who": "ben@example.org", "role": "viewer"},
            headers=ORIGIN,
        ).status_code
        == 403
    )
    # A group grant.
    admin = client(hub, "admin")
    admin.post(
        "/admin/groups", data={"group": "Finance", "email": "ben@example.org"}, headers=ORIGIN
    )
    ana.post(f"/reports/{rid}/share", data={"who": "Finance", "role": "viewer"}, headers=ORIGIN)
    assert ben.get(f"/r/{rid}/api/report").status_code == 200
    assert ben.get(f"/r/{rid}/api/session").json()["hub"]["role"] == "viewer"
    # Public links are off by default; sign-in links work for signed-in users only.
    assert (
        ana.post(
            f"/reports/{rid}/links", data={"public": "1", "days": "3"}, headers=ORIGIN
        ).status_code
        == 403
    )
    res = ana.post(
        f"/reports/{rid}/links", data={"days": "3"}, headers=ORIGIN, follow_redirects=False
    )
    token = parse_qs(urlparse(res.headers["location"]).query)["token"][0]
    anon = TestClient(hub.app, base_url=BASE)
    assert anon.get(f"/l/{token}", follow_redirects=False).headers["location"].startswith("/login")
    admin.post(
        "/admin/settings", data={"public_links": "1", "public_link_max_days": "7"}, headers=ORIGIN
    )
    res = ana.post(
        f"/reports/{rid}/links",
        data={"public": "1", "days": "30"},
        headers=ORIGIN,
        follow_redirects=False,
    )
    public = parse_qs(urlparse(res.headers["location"]).query)["token"][0]
    row = hub.store.one("SELECT expires_at FROM links WHERE public = 1")
    assert row["expires_at"] < time.time() + 7.1 * 86400  # capped by the admin setting
    opened = anon.get(f"/l/{public}", follow_redirects=False)  # no sign-in needed
    assert opened.status_code == 303 and opened.headers["location"] == f"/r/{rid}/"
    assert anon.get(f"/r/{rid}/api/report").status_code == 200
    with hub.store.tx() as db:
        db.execute("UPDATE links SET expires_at = ?", (time.time() - 1,))
    assert anon.get(f"/r/{rid}/api/report").status_code == 401


def test_comments_mentions_resolve(hub):
    rid = publish(hub, "ana", archive(hub.tmp))["report_id"]
    ana, ben = client(hub, "ana"), client(hub, "ben")
    ana.post(
        f"/reports/{rid}/share", data={"who": "ben@example.org", "role": "viewer"}, headers=ORIGIN
    )
    res = ana.post(
        f"/r/{rid}/api/comments",
        json={"key": "trend", "body": "@ben@example.org please check"},
        headers=ORIGIN,
    )
    cid = res.json()["id"]
    assert ben.get("/api/mentions").json()[0]["viz_key"] == "trend"
    comments = ben.get(f"/r/{rid}/api/comments").json()
    assert comments[0]["body"].startswith("@ben") and not comments[0]["resolved"]
    assert ben.get("/api/mentions").json() == []  # seen
    assert (
        ben.post(
            f"/r/{rid}/api/comments/{cid}/resolve", json={"resolved": True}, headers=ORIGIN
        ).status_code
        == 403
    )
    assert ana.post(
        f"/r/{rid}/api/comments/{cid}/resolve", json={"resolved": True}, headers=ORIGIN
    ).json() == {"resolved": True}
    q = ben.post(
        f"/r/{rid}/api/comments",
        json={"key": "trend", "body": "Why the dip?", "kind": "question"},
        headers=ORIGIN,
    )
    assert q.status_code == 201
    assert (
        ben.post(
            f"/r/{rid}/api/comments", json={"key": "nope", "body": "x"}, headers=ORIGIN
        ).status_code
        == 422
    )


def test_csrf_retention_deletion_audit_embedding_analytics(hub):
    rid = publish(hub, "ana", archive(hub.tmp))["report_id"]
    ana, admin = client(hub, "ana"), client(hub, "admin")
    assert (
        ana.post(f"/reports/{rid}/share", data={"who": "ben@example.org"}).status_code == 403
    )  # no Origin
    assert (
        ana.post(
            f"/reports/{rid}/share",
            data={"who": "ben@example.org"},
            headers={"Origin": "https://evil.example"},
        ).status_code
        == 403
    )
    # Analytics: off by default, on with a notice.
    ana.post(f"/r/{rid}/api/view", json={"key": "trend"}, headers=ORIGIN)
    assert hub.store.one("SELECT COUNT(*) AS n FROM views")["n"] == 0
    admin.post(
        "/admin/settings",
        data={
            "analytics": "1",
            "keep_revisions": "1",
            "frame_ancestors": "https://contoso.sharepoint.com http://bad",
        },
        headers=ORIGIN,
    )
    assert ana.get(f"/r/{rid}/api/session").json()["hub"]["analytics"] is True
    ana.post(f"/r/{rid}/api/view", json={"key": "trend"}, headers=ORIGIN)
    assert hub.store.one("SELECT count FROM views")["count"] == 1
    assert ana.post(f"/r/{rid}/api/view", json={"key": "trend"}).status_code == 403  # CSRF
    csp = ana.get("/").headers["content-security-policy"]
    assert (
        csp.endswith("frame-ancestors 'self' https://contoso.sharepoint.com")
        and "http://bad" not in csp
    )
    # Retention: keep one revision.
    publish(hub, "ana", archive(hub.tmp, revenue=11))
    assert not (hub.cfg.data_dir / "archives" / f"{rid}-1.dwk.enc").exists()
    assert [r["number"] for r in hub.store.all("SELECT number FROM revisions")] == [2]
    odd = auth.create_user(hub.store, "=HYPERLINK(1)@example.org", "Odd", None)
    hub.store.audit("user.signed_in", odd)
    audit = admin.get("/admin/audit.csv").text
    assert "revision.pruned" in audit and "setting.changed" in audit
    assert ",'=hyperlink(1)@example.org," in audit  # stays text in spreadsheet programs
    # Deletion on request.
    assert (
        ana.post(f"/reports/{rid}/delete", headers=ORIGIN, follow_redirects=False).status_code
        == 303
    )
    assert not list((hub.cfg.data_dir / "archives").iterdir())
    assert hub.store.one("SELECT COUNT(*) AS n FROM reports")["n"] == 0
    assert any(r["action"] == "report.deleted" for r in admin.get("/api/audit").json())


def test_viewer_pages_need_access(hub):
    rid = publish(hub, "ana", archive(hub.tmp))["report_id"]
    anon = TestClient(hub.app, base_url=BASE)
    assert (
        anon.get(f"/r/{rid}/", follow_redirects=False)
        .headers["location"]
        .startswith("/login?next=")
    )
    assert client(hub, "ana").get(f"/r/{rid}/").status_code in (200, 404)  # 404 without a web build
    assert anon.get(f"/r/{rid}/api/report").status_code == 401


# -- SAML ---------------------------------------------------------------------------------


def _key_and_cert():
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "idp.test")])
    now = datetime.now(UTC)
    cert = (
        x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(1).not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=1))
        .sign(key, hashes.SHA256())
    )  # fmt: skip
    pem_key = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    return pem_key, cert.public_bytes(serialization.Encoding.PEM)


def _saml_response(
    key, cert, request_id, email="saml.user@example.org", audience=f"{BASE}/saml/metadata"
):
    from lxml import etree
    from signxml import XMLSigner

    now = datetime.now(UTC)
    t = lambda d: (now + d).strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    answers = f' InResponseTo="{request_id}"' if request_id else ""  # else IdP-initiated
    xml = f"""<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r{secrets.token_hex(8)}" Version="2.0" IssueInstant="{t(timedelta())}"{answers} Destination="{BASE}/saml/acs">
<saml:Issuer>https://idp.test</saml:Issuer>
<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
<saml:Assertion ID="_a{secrets.token_hex(8)}" Version="2.0" IssueInstant="{t(timedelta())}">
<saml:Issuer>https://idp.test</saml:Issuer>
<saml:Subject><saml:NameID>u-123</saml:NameID>
<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData{answers} Recipient="{BASE}/saml/acs" NotOnOrAfter="{t(timedelta(minutes=5))}"/></saml:SubjectConfirmation></saml:Subject>
<saml:Conditions NotBefore="{t(timedelta(minutes=-1))}" NotOnOrAfter="{t(timedelta(minutes=5))}"><saml:AudienceRestriction><saml:Audience>{audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>
<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>{email}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="name"><saml:AttributeValue>Saml User</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>
</saml:Assertion></samlp:Response>"""
    signed = XMLSigner().sign(etree.fromstring(xml.encode()), key=key, cert=cert)
    return base64.b64encode(etree.tostring(signed)).decode()


def test_saml_sign_in(hub):
    key, cert = _key_and_cert()
    hub.cfg.saml = SamlConfig(
        "https://idp.test", "https://idp.test/sso", cert.decode(), f"{BASE}/saml/metadata"
    )
    c = TestClient(hub.app, base_url=BASE)
    res = c.get("/saml/login", follow_redirects=False)
    q = parse_qs(urlparse(res.headers["location"]).query)
    request_xml = zlib.decompress(base64.b64decode(q["SAMLRequest"][0]), -15).decode()
    request_id = re.search(r'ID="([^"]+)"', request_xml).group(1)
    good = _saml_response(key, cert, request_id)
    res = c.post("/saml/acs", data={"SAMLResponse": good}, follow_redirects=False)
    assert res.status_code == 303 and c.get("/").status_code == 200
    assert (
        hub.store.one("SELECT sso_subject FROM users WHERE email = 'saml.user@example.org'")[
            "sso_subject"
        ]
        == "saml:https://idp.test:u-123"
    )
    # Replay, tampering, another audience, and an unknown signer are refused.
    assert c.post("/saml/acs", data={"SAMLResponse": good}).status_code == 403
    tampered = base64.b64encode(
        base64.b64decode(good).replace(b"saml.user@example.org", b"admin@example.org")
    ).decode()
    c2 = TestClient(hub.app, base_url=BASE)
    c2.get("/saml/login", follow_redirects=False)
    assert c2.post("/saml/acs", data={"SAMLResponse": tampered}).status_code == 403
    other_key, other_cert = _key_and_cert()
    assert (
        c2.post(
            "/saml/acs", data={"SAMLResponse": _saml_response(other_key, other_cert, request_id)}
        ).status_code
        == 403
    )
    assert (
        c2.post(
            "/saml/acs",
            data={"SAMLResponse": _saml_response(key, cert, request_id, audience="https://other")},
        ).status_code
        == 403
    )
    assert "AssertionConsumerService" in c.get("/saml/metadata").text
    # An IdP-initiated response signs in once, also when its encoding changes.
    unsolicited = _saml_response(key, cert, None, email="idp.user@example.org")
    fresh = lambda: TestClient(hub.app, base_url=BASE)  # noqa: E731
    ok = fresh().post("/saml/acs", data={"SAMLResponse": unsolicited}, follow_redirects=False)
    assert ok.status_code == 303
    again = unsolicited[:8] + "\n" + unsolicited[8:]  # the same signed bytes
    assert fresh().post("/saml/acs", data={"SAMLResponse": again}).status_code == 403


def test_sso_never_takes_over_an_account_by_e_mail(hub):
    key, cert = _key_and_cert()
    hub.cfg.saml = SamlConfig(
        "https://idp.test", "https://idp.test/sso", cert.decode(), f"{BASE}/saml/metadata"
    )

    def saml_sign_in(c, email, link=0):
        res = c.get(f"/saml/login?link={link}&next=/account", follow_redirects=False)
        q = parse_qs(urlparse(res.headers["location"]).query)
        xml = zlib.decompress(base64.b64decode(q["SAMLRequest"][0]), -15).decode()
        request_id = re.search(r'ID="([^"]+)"', xml).group(1)
        response = _saml_response(key, cert, request_id, email=email)
        return c.post("/saml/acs", data={"SAMLResponse": response}, follow_redirects=False)

    def subject(email):
        return hub.store.one("SELECT sso_subject FROM users WHERE email = ?", email)["sso_subject"]

    # The administrator has a password: an assertion with that e-mail does not open it.
    res = saml_sign_in(TestClient(hub.app, base_url=BASE), "admin@example.org")
    assert res.status_code == 403 and "Account page" in res.text
    assert subject("admin@example.org") is None
    # The owner signs in with the password and connects SSO on the Account page.
    ana = client(hub, "ana")
    assert "Connect SAML sign-on" in ana.get("/account").text
    res = saml_sign_in(ana, "anything@example.org", link=1)
    assert res.status_code == 303 and res.headers["location"] == "/account"
    assert subject("ana@example.org") == "saml:https://idp.test:u-123"
    assert "is connected" in ana.get("/account").text
    # The same identity cannot connect to a second account.
    assert saml_sign_in(client(hub, "ben"), "ben@example.org", link=1).status_code == 403
    # An account created for SSO (no password) waits for its first sign-in.
    with hub.store.tx() as db:
        db.execute("UPDATE users SET sso_subject = NULL WHERE email = 'ana@example.org'")
    auth.create_user(hub.store, "new@example.org", "New", None)
    assert saml_sign_in(TestClient(hub.app, base_url=BASE), "new@example.org").status_code == 303
    assert subject("new@example.org") == "saml:https://idp.test:u-123"
    # An e-mail that the identity provider did not verify is not used.
    with pytest.raises(auth.AuthError, match="did not verify"):
        auth.sso_user(hub.store, "oidc:x:1", "other@example.org", "", verified=False)


# -- OIDC (a fake identity provider on a local port) ---------------------------------------


def test_oidc_sign_in(hub, unused_tcp_port_factory=None):
    import socket

    import uvicorn
    from authlib.jose import JsonWebKey, jwt
    from fastapi import FastAPI, Form

    sock = socket.socket()  # stays open: the server gets it, so no other process takes the port
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    issuer = f"http://127.0.0.1:{port}"
    key = JsonWebKey.generate_key("RSA", 2048, is_private=True)
    key_dict = key.as_dict(is_private=True) | {"kid": "k1", "alg": "RS256", "use": "sig"}
    codes: dict[str, str] = {}
    idp = FastAPI()

    @idp.get("/.well-known/openid-configuration")
    def discovery():
        return {
            "issuer": issuer, "authorization_endpoint": f"{issuer}/authorize", "token_endpoint": f"{issuer}/token",
            "jwks_uri": f"{issuer}/jwks", "response_types_supported": ["code"], "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256"],
        }  # fmt: skip

    @idp.get("/jwks")
    def jwks():
        return {
            "keys": [
                {k: v for k, v in key_dict.items() if k in ("kty", "n", "e", "kid", "alg", "use")}
            ]
        }

    @idp.post("/token")
    def token(code: str = Form(...)):
        nonce = codes.pop(code)
        claims = {
            "iss": issuer,
            "sub": "o-42",
            "aud": "hub",
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "nonce": nonce,
            "email": "oidc.user@example.org",
            "name": "Oidc User",
        }
        id_token = jwt.encode({"alg": "RS256", "kid": "k1"}, claims, key_dict).decode()
        return {
            "access_token": "at",
            "token_type": "Bearer",
            "id_token": id_token,
            "expires_in": 300,
        }

    server = uvicorn.Server(uvicorn.Config(idp, log_level="warning"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    for _ in range(200):  # 10 s at most: a server that fails to start must not hang the tests
        if server.started or not thread.is_alive():
            break
        time.sleep(0.05)
    assert server.started, "the test identity provider did not start"
    try:
        hub.cfg.oidc = OidcConfig(issuer, "hub", "secret")
        app = create_app(hub.cfg)
        c = TestClient(app, base_url=BASE)
        res = c.get("/sso/oidc", follow_redirects=False)
        q = parse_qs(urlparse(res.headers["location"]).query)
        assert q["code_challenge_method"] == ["S256"] and q["redirect_uri"] == [
            f"{BASE}/sso/oidc/callback"
        ]
        codes["c1"] = q["nonce"][0]
        res = c.get(f"/sso/oidc/callback?code=c1&state={q['state'][0]}", follow_redirects=False)
        assert res.status_code == 303, res.text
        assert c.get("/").status_code == 200
        assert (
            app.state.store.one(
                "SELECT name FROM users WHERE sso_subject = ?", f"oidc:{issuer}:o-42"
            )["name"]
            == "Oidc User"
        )
        assert (
            TestClient(app, base_url=BASE).get("/sso/oidc/callback?code=x&state=forged").status_code
            == 400
        )
    finally:
        server.should_exit = True
        thread.join(5)


# -- live follow ------------------------------------------------------------------------------


def test_live_follow_socket(hub):
    rid = publish(hub, "ana", archive(hub.tmp))["report_id"]
    ana, ben = client(hub, "ana"), client(hub, "ben")
    ana.post(
        f"/reports/{rid}/share", data={"who": "ben@example.org", "role": "viewer"}, headers=ORIGIN
    )

    # Browsers send cookies with the WebSocket handshake; the test client needs them explicitly.
    def ws_headers(c):
        return {**ORIGIN, "cookie": f"dw_session={c.cookies['dw_session']}"}

    with ana.websocket_connect(f"/r/{rid}/api/live?role=presenter", headers=ws_headers(ana)) as p:
        assert p.receive_json() == {"type": "followers", "list": []}
        with ben.websocket_connect(
            f"/r/{rid}/api/live?role=presenter", headers=ws_headers(ben)
        ) as a:  # a viewer cannot present
            assert a.receive_json() == {"type": "presenter", "name": "Ana", "state": None}
            assert p.receive_json()["list"] == [{"name": "Ben", "following": True}]
            p.send_json({"type": "state", "state": {"index": 3}})
            assert a.receive_json() == {"type": "state", "state": {"index": 3}}
            a.send_json({"type": "follow", "following": False})
            assert p.receive_json()["list"] == [{"name": "Ben", "following": False}]
        assert p.receive_json()["list"] == []
    anon = TestClient(hub.app, base_url=BASE)
    from starlette.websockets import WebSocketDisconnect

    with (
        pytest.raises(WebSocketDisconnect),
        anon.websocket_connect(f"/r/{rid}/api/live", headers=ORIGIN) as s,
    ):
        s.receive_json()


def test_export_needs_review_and_is_audited(hub):
    from datawalk import export as ex

    rid = publish(hub, "ana", archive(hub.tmp))["report_id"]
    ana = client(hub, "ana")
    ana.post(
        f"/reports/{rid}/share", data={"who": "ben@example.org", "role": "viewer"}, headers=ORIGIN
    )
    assert (
        client(hub, "ben").get(f"/reports/{rid}/export").status_code == 403
    )  # viewers do not export
    if (
        not (ex.VIEWER / "viewer.js").exists()
        or not (ex.STATIC / "library" / "index.json").exists()
    ):
        pytest.skip("needs the web build")
    review = ana.get(f"/reports/{rid}/export?watermark=Board")
    assert "Revenue" in review.text and "chart data" in review.text
    assert (
        ana.post(f"/reports/{rid}/export", data={"watermark": "Board"}, headers=ORIGIN).status_code
        == 422
    )
    res = ana.post(
        f"/reports/{rid}/export", data={"watermark": "Board", "confirmed": "1"}, headers=ORIGIN
    )
    assert res.status_code == 200 and '"watermark":"Board"' in res.text
    row = hub.store.one("SELECT detail FROM audit WHERE action = 'report.exported'")
    assert '"watermark": "Board"' in row["detail"]


def test_classification_policy(hub, tmp_path):
    r = dw.Report("Secret plan", id="b" * 32)
    fig, ax = plt.subplots()
    ax.plot([1, 2])
    r.add(fig, key="trend", room="Main")
    r.classify("Confidential")
    r.save(tmp_path / "c.dwk", merge=False)
    plt.close("all")
    rid = publish(hub, "ana", (tmp_path / "c.dwk").read_bytes())["report_id"]
    ana, admin = client(hub, "ana"), client(hub, "admin")
    admin.post("/admin/settings", data={"public_links": "1"}, headers=ORIGIN)
    res = ana.post(f"/reports/{rid}/links", data={"public": "1", "days": "2"}, headers=ORIGIN)
    assert res.status_code == 403 and "Confidential: no public links" in res.text
    assert "Confidential" in ana.get("/").text
    assert ana.get(f"/r/{rid}/api/session").json()["hub"]["classification"] == "Confidential"
    res = ana.post(f"/reports/{rid}/export", data={"confirmed": "1"}, headers=ORIGIN)
    assert res.status_code == 422 and "watermark required" in res.text
