"""The hub web application."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import mimetypes
import re
import secrets
import time
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

import datawalk
from datawalk import Report
from datawalk.policy import PolicyError, policy
from datawalk.serialization.archive import ArchiveError, read

from . import auth, i18n
from .config import Config
from .diff import changes as diff_changes
from .live import Live, Member
from .store import Store, token_hash

VIEWER = Path(datawalk.__file__).parent / "server" / "static"
TEMPLATES = Jinja2Templates(
    directory=str(Path(__file__).parent / "templates"), context_processors=[i18n.template_context]
)
TEMPLATES.env.filters["datetime"] = lambda t: datetime.fromtimestamp(t, UTC).strftime(
    "%Y-%m-%d %H:%M UTC"
)
HUB_STATIC = Path(__file__).parent / "static"
ROLES = {"viewer": 1, "editor": 2, "owner": 3}
MAX_ARCHIVE = 512 * 2**20
COOKIE = "dw_session"
MENTION = re.compile(r"@([\w.+-]+@[\w-]+(?:\.[\w-]+)+)")


def create_app(cfg: Config) -> FastAPI:
    store = Store(cfg.data_dir, cfg.encryption_key)
    live = Live()
    used_assertions: dict[str, float] = {}  # SAML assertion ids: no replay
    app = FastAPI(title="DataWalk Hub", docs_url=None, redoc_url=None, openapi_url=None)
    # Only the SSO round trip (OIDC state and nonce, SAML request id) uses this cookie.
    app.add_middleware(
        SessionMiddleware,
        secret_key=cfg.secret_key,
        session_cookie="dw_sso",
        https_only=cfg.secure_cookies,
        same_site="lax",
    )
    app.state.store, app.state.cfg, app.state.live = store, cfg, live

    oauth = None
    if cfg.oidc:
        from authlib.integrations.starlette_client import OAuth

        oauth = OAuth()
        oauth.register(
            "oidc",
            client_id=cfg.oidc.client_id,
            client_secret=cfg.oidc.client_secret,
            server_metadata_url=f"{cfg.oidc.issuer}/.well-known/openid-configuration",
            client_kwargs={"scope": cfg.oidc.scopes, "code_challenge_method": "S256"},
        )

    def embedding() -> list[str]:
        return [
            o
            for o in str(store.setting("frame_ancestors")).split()
            if re.fullmatch(r"https://[\w.-]+(:\d+)?", o)
        ]

    @app.middleware("http")
    async def headers(request: Request, call_next):
        response = await call_next(request)
        ancestors = " ".join(["'self'", *embedding()])
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
            "connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; "
            f"base-uri 'none'; frame-ancestors {ancestors}"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        lang = request.query_params.get("lang")
        if lang in i18n.CATALOGS:  # the language switch: remember the choice
            response.set_cookie(
                i18n.COOKIE, lang, max_age=365 * 86400, secure=cfg.secure_cookies, samesite="lax"
            )
        return response

    # -- helpers ------------------------------------------------------------------------

    def tr(request: Request, key: str, **params: Any) -> str:
        return i18n.t(key, i18n.pick_language(request), **params)

    def ip(request: Request) -> str:
        return request.client.host if request.client else ""

    def user_of(request: Request):
        bearer = request.headers.get("authorization", "")
        if bearer.lower().startswith("bearer "):
            return auth.token_user(store, bearer[7:].strip())
        return auth.session_user(store, request.cookies.get(COOKIE))

    def check_origin(request: Request) -> None:
        """Cookie-authenticated changes must come from the hub's own pages (CSRF)."""
        if request.headers.get("authorization"):
            return
        origin = request.headers.get("origin") or request.headers.get("referer") or ""
        want = urlparse(cfg.base_url)
        got = urlparse(origin)
        if (got.scheme, got.netloc) != (want.scheme, want.netloc):
            raise HTTPException(403, tr(request, "error.other_site"))

    def require_user(request: Request):
        user = user_of(request)
        if user is None:
            raise HTTPException(401, tr(request, "error.sign_in_first"))
        return user

    def role(user, report_id: str) -> str | None:
        if user is None:
            return None
        rep = store.one("SELECT owner_id FROM reports WHERE id = ?", report_id)
        if rep is None:
            return None
        if user["is_admin"] or rep["owner_id"] == user["id"]:
            return "owner"
        rows = store.all(
            "SELECT role FROM grants WHERE report_id = ? AND ((principal = 'user' AND principal_id = ?) OR "
            "(principal = 'group' AND principal_id IN (SELECT group_id FROM group_members WHERE user_id = ?)))",
            report_id, user["id"], user["id"],
        )  # fmt: skip
        return max((r["role"] for r in rows), key=ROLES.get, default=None)

    def link_role(request: Request, report_id: str, user) -> str | None:
        token = request.cookies.get(f"dw_link_{report_id}")
        if not token:
            return None
        row = store.one(
            "SELECT * FROM links WHERE token_hash = ? AND report_id = ? AND revoked = 0",
            token_hash(token),
            report_id,
        )
        if row is None or (row["expires_at"] and row["expires_at"] < time.time()):
            return None
        if row["public"] and not public_allowed(report_id):
            return None  # an admin turned public links off, or the label forbids them
        return "viewer" if row["public"] or user is not None else None

    def public_allowed(report_id: str) -> bool:
        rep = store.one("SELECT classification FROM reports WHERE id = ?", report_id)
        rule = policy(rep["classification"]) if rep else None
        return bool(store.setting("public_links")) and (rule is None or rule.public_links)

    def access(request: Request, report_id: str, need: str = "viewer"):
        user = user_of(request)
        r = role(user, report_id)
        if r is None:
            r = link_role(request, report_id, user)
        if r is None or ROLES[r] < ROLES[need]:
            raise HTTPException(401 if user is None else 403, tr(request, "error.no_access"))
        return user, r

    def latest(report_id: str) -> int:
        row = store.one("SELECT MAX(number) AS n FROM revisions WHERE report_id = ?", report_id)
        if row is None or row["n"] is None:
            raise HTTPException(404)
        return row["n"]

    @lru_cache(maxsize=16)  # ponytail: decrypted reports in memory; size by RAM if needed
    def load(report_id: str, number: int) -> Report:
        return read(io.BytesIO(store.read_archive(report_id, number)))

    def page(request: Request, name: str, **ctx: Any) -> HTMLResponse:
        user = user_of(request)
        return TEMPLATES.TemplateResponse(request, name, {"user": user, "cfg": cfg, **ctx})

    def login_cookie(response: Response, token: str) -> None:
        cross_site = bool(embedding()) and cfg.secure_cookies  # embedded in SharePoint, Teams, ...
        response.set_cookie(
            COOKIE, token, max_age=auth.SESSION_SECONDS, httponly=True, secure=cfg.secure_cookies,
            samesite="none" if cross_site else "lax",
        )  # fmt: skip

    def safe_next(target: str | None) -> str:
        return target if target and target.startswith("/") and not target.startswith("//") else "/"

    def signed_in(request: Request, user_id: int, method: str, nxt: str, popup: bool) -> Response:
        store.audit("user.signed_in", user_id, ip=ip(request), method=method)
        response = (
            TEMPLATES.TemplateResponse(request, "popup_done.html", {"user": None, "cfg": cfg})
            if popup
            else RedirectResponse(safe_next(nxt), 303)
        )
        login_cookie(response, auth.new_session(store, user_id))
        return response

    # -- sign-in --------------------------------------------------------------------------

    @app.get("/login", response_class=HTMLResponse)
    def login_page(request: Request, next: str = "/", popup: int = 0, error: str = ""):
        return page(request, "login.html", next=safe_next(next), popup=popup, error=error)

    @app.post("/login")
    async def login(request: Request):
        check_origin(request)
        if not cfg.local_accounts:
            raise HTTPException(404)
        form = await request.form()
        email = str(form.get("email", "")).strip().lower()
        row = store.one("SELECT * FROM users WHERE email = ?", email)
        if not auth.check_password(
            str(form.get("password", "")), row["password_hash"] if row else None
        ):
            store.audit("user.sign_in_failed", None, ip=ip(request), email=email)
            nxt = quote(safe_next(str(form.get("next", "/"))))
            return RedirectResponse(f"/login?next={nxt}&popup={form.get('popup', 0)}&error=1", 303)
        return signed_in(
            request, row["id"], "password", str(form.get("next", "/")), form.get("popup") == "1"
        )

    @app.post("/logout")
    def logout(request: Request):
        check_origin(request)
        auth.end_session(store, request.cookies.get(COOKIE))
        response = RedirectResponse("/login", 303)
        response.delete_cookie(COOKIE)
        return response

    def start_sso(request: Request, nxt: str, popup: int, link: int) -> None:
        """Remember where to go after sign-in, and (from the Account page) which signed-in
        user connects this SSO identity."""
        user = user_of(request) if link else None
        request.session.update(next=safe_next(nxt), popup=popup, link=user["id"] if user else None)

    def sso_signed_in(request: Request, method: str, identity: tuple, verified: bool) -> Response:
        link = request.session.pop("link", None)
        user = user_of(request)
        link = link if user is not None and user["id"] == link else None
        try:
            uid = auth.sso_user(store, *identity, verified=verified, link_to=link)
        except auth.AuthError as e:
            store.audit(
                "user.sign_in_failed", None, ip=ip(request), method=method, error=str(e)[:200]
            )
            raise HTTPException(403, str(e)) from None
        if link:
            store.audit("user.sso_connected", uid, ip=ip(request), method=method)
        return signed_in(
            request,
            uid,
            method,
            request.session.pop("next", "/"),
            request.session.pop("popup", 0) == 1,
        )

    @app.get("/sso/oidc")
    async def oidc_start(request: Request, next: str = "/", popup: int = 0, link: int = 0):
        if oauth is None:
            raise HTTPException(404)
        start_sso(request, next, popup, link)
        return await oauth.oidc.authorize_redirect(request, f"{cfg.base_url}/sso/oidc/callback")

    @app.get("/sso/oidc/callback")
    async def oidc_callback(request: Request):
        if oauth is None:
            raise HTTPException(404)
        try:
            token = await oauth.oidc.authorize_access_token(
                request
            )  # checks state, nonce, id_token
        except Exception as e:
            store.audit(
                "user.sign_in_failed", None, ip=ip(request), method="oidc", error=str(e)[:200]
            )
            raise HTTPException(400, tr(request, "error.sso_failed")) from None
        claims = token.get("userinfo") or {}
        identity = (
            f"oidc:{claims['iss']}:{claims['sub']}",
            claims.get("email", ""),
            claims.get("name", ""),
        )
        # Some providers (Microsoft Entra ID) send no email_verified claim; only an explicit
        # "not verified" refuses the address.
        return sso_signed_in(request, "oidc", identity, claims.get("email_verified") is not False)

    @app.get("/saml/login")
    def saml_start(request: Request, next: str = "/", popup: int = 0, link: int = 0):
        if cfg.saml is None:
            raise HTTPException(404)
        url, request_id = auth.saml_request(
            cfg.saml, f"{cfg.base_url}/saml/acs", secrets.token_urlsafe(8)
        )
        start_sso(request, next, popup, link)
        request.session["saml_request"] = request_id
        return RedirectResponse(url, 303)

    @app.post("/saml/acs")
    async def saml_acs(request: Request):
        if cfg.saml is None:
            raise HTTPException(404)
        form = await request.form()
        try:
            identity = auth.saml_identity(
                cfg.saml,
                str(form.get("SAMLResponse", "")),
                f"{cfg.base_url}/saml/acs",
                request.session.pop("saml_request", None),
            )
            # One assertion signs in once (keyed on the signed assertion ID, not on the
            # encoding of the response). ponytail: per process; one hub process only.
            now = time.time()
            for k in [k for k, t in used_assertions.items() if t < now]:
                del used_assertions[k]
            if identity.assertion in used_assertions:
                raise auth.AuthError(tr(request, "error.saml_replay"))
            used_assertions[identity.assertion] = identity.until
        except auth.AuthError as e:
            store.audit(
                "user.sign_in_failed", None, ip=ip(request), method="saml", error=str(e)[:200]
            )
            raise HTTPException(403, str(e)) from None
        return sso_signed_in(request, "saml", identity[:3], True)

    @app.get("/saml/metadata")
    def saml_meta():
        if cfg.saml is None:
            raise HTTPException(404)
        return Response(
            auth.saml_metadata(cfg.saml, f"{cfg.base_url}/saml/acs"),
            media_type="application/samlmetadata+xml",
        )

    # -- pages --------------------------------------------------------------------------

    def reports_for(user) -> list[dict]:
        rows = store.all(
            "SELECT r.*, (SELECT MAX(number) FROM revisions v WHERE v.report_id = r.id) AS latest, "
            "(SELECT MAX(created_at) FROM revisions v WHERE v.report_id = r.id) AS updated FROM reports r ORDER BY updated DESC"
        )
        return [dict(r) | {"role": rl} for r in rows if (rl := role(user, r["id"]))]

    @app.get("/", response_class=HTMLResponse)
    def home(request: Request):
        user = user_of(request)
        if user is None:
            return RedirectResponse("/login", 303)
        mentions = store.all(
            "SELECT c.id, c.report_id, c.viz_key, r.name AS report FROM mentions m JOIN comments c ON c.id = m.comment_id "
            "JOIN reports r ON r.id = c.report_id WHERE m.user_id = ? AND m.seen = 0 ORDER BY c.created_at DESC",
            user["id"],
        )
        return page(request, "index.html", reports=reports_for(user), mentions=mentions)

    @app.get("/reports/{rid}", response_class=HTMLResponse)
    def report_page(request: Request, rid: str, token: str = ""):
        user, r = access(request, rid)
        rep = store.one("SELECT * FROM reports WHERE id = ?", rid)
        revisions = [
            dict(v)
            | {
                "changes": json.loads(v["changes"]),
                "author": (
                    store.one("SELECT name FROM users WHERE id = ?", v["author_id"])
                    or {"name": "?"}
                )["name"],
            }
            for v in store.all(
                "SELECT * FROM revisions WHERE report_id = ? ORDER BY number DESC", rid
            )
        ]
        grants = store.all(
            "SELECT g.*, COALESCE(u.email, gr.name) AS who FROM grants g LEFT JOIN users u ON g.principal = 'user' AND u.id = g.principal_id "
            "LEFT JOIN groups gr ON g.principal = 'group' AND gr.id = g.principal_id WHERE g.report_id = ?",
            rid,
        )
        links = (
            store.all("SELECT * FROM links WHERE report_id = ? ORDER BY created_at DESC", rid)
            if r == "owner"
            else []
        )
        views = (
            store.all(
                "SELECT viz_key, SUM(count) AS n FROM views WHERE report_id = ? GROUP BY viz_key ORDER BY n DESC",
                rid,
            )
            if store.setting("analytics") and ROLES[r] >= ROLES["editor"]
            else []
        )
        return page(
            request, "report.html", report=rep, role=r, revisions=revisions, grants=grants, links=links, views=views,
            new_token=token, public_links=store.setting("public_links"), max_days=store.setting("public_link_max_days"),
            now=time.time(),
        )  # fmt: skip

    @app.post("/reports/{rid}/share")
    async def share(request: Request, rid: str):
        check_origin(request)
        user, _ = access(request, rid, "owner")
        form = await request.form()
        who, new_role = str(form.get("who", "")).strip(), str(form.get("role", "viewer"))
        if new_role not in ROLES:
            raise HTTPException(422)
        target = store.one("SELECT id FROM users WHERE email = ?", who.lower())
        kind = "user"
        if target is None:
            target, kind = store.one("SELECT id FROM groups WHERE name = ?", who), "group"
        if target is None:
            raise HTTPException(422, tr(request, "error.no_user_or_group", who=who))
        with store.tx() as db:
            db.execute(
                "INSERT INTO grants (report_id, principal, principal_id, role) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(report_id, principal, principal_id) DO UPDATE SET role = excluded.role",
                (rid, kind, target["id"], new_role),
            )
        store.audit(
            "permission.granted",
            user["id"],
            rid,
            ip(request),
            principal=kind,
            who=who,
            role=new_role,
        )
        return RedirectResponse(f"/reports/{rid}", 303)

    @app.post("/reports/{rid}/unshare")
    async def unshare(request: Request, rid: str):
        check_origin(request)
        user, _ = access(request, rid, "owner")
        form = await request.form()
        kind, pid = str(form.get("principal")), int(form.get("principal_id", 0))
        with store.tx() as db:
            db.execute(
                "DELETE FROM grants WHERE report_id = ? AND principal = ? AND principal_id = ?",
                (rid, kind, pid),
            )
        store.audit(
            "permission.revoked", user["id"], rid, ip(request), principal=kind, principal_id=pid
        )
        return RedirectResponse(f"/reports/{rid}", 303)

    @app.post("/reports/{rid}/links")
    async def new_link(request: Request, rid: str):
        check_origin(request)
        user, _ = access(request, rid, "owner")
        form = await request.form()
        public = form.get("public") == "1"
        days = float(form.get("days") or 0)
        if public:
            if not store.setting("public_links"):
                raise HTTPException(403, tr(request, "error.public_links_off"))
            rule = policy(
                store.one("SELECT classification FROM reports WHERE id = ?", rid)["classification"]
            )
            if rule and not rule.public_links:
                raise HTTPException(403, f"{rule.describe()}.")
            days = min(
                days or store.setting("public_link_max_days"), store.setting("public_link_max_days")
            )
        token = secrets.token_urlsafe(24)
        with store.tx() as db:
            db.execute(
                "INSERT INTO links (token_hash, report_id, public, created_by, created_at, expires_at, label) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    token_hash(token),
                    rid,
                    int(public),
                    user["id"],
                    time.time(),
                    time.time() + days * 86400 if days else None,
                    str(form.get("label", ""))[:100],
                ),
            )
        store.audit("link.created", user["id"], rid, ip(request), public=public, days=days)
        return RedirectResponse(f"/reports/{rid}?token={token}", 303)

    @app.post("/reports/{rid}/links/{h}/revoke")
    def revoke_link(request: Request, rid: str, h: str):
        check_origin(request)
        user, _ = access(request, rid, "owner")
        with store.tx() as db:
            db.execute(
                "UPDATE links SET revoked = 1 WHERE token_hash = ? AND report_id = ?", (h, rid)
            )
        store.audit("link.revoked", user["id"], rid, ip(request))
        return RedirectResponse(f"/reports/{rid}", 303)

    @app.get("/l/{token}")
    def open_link(request: Request, token: str):
        row = store.one(
            "SELECT * FROM links WHERE token_hash = ? AND revoked = 0", token_hash(token)
        )
        if row is None or (row["expires_at"] and row["expires_at"] < time.time()):
            raise HTTPException(404, tr(request, "error.link_gone"))
        if row["public"] and not public_allowed(row["report_id"]):
            raise HTTPException(404, tr(request, "error.link_gone"))
        user = user_of(request)
        if not row["public"] and user is None:
            return RedirectResponse(f"/login?next={quote(f'/l/{token}')}", 303)
        store.audit(
            "link.used",
            user["id"] if user else None,
            row["report_id"],
            ip(request),
            public=bool(row["public"]),
        )
        response = RedirectResponse(f"/r/{row['report_id']}/", 303)
        max_age = int(row["expires_at"] - time.time()) if row["expires_at"] else 30 * 86400
        response.set_cookie(
            f"dw_link_{row['report_id']}", token, max_age=max_age, path=f"/r/{row['report_id']}/",
            httponly=True, secure=cfg.secure_cookies,
            samesite="none" if embedding() and cfg.secure_cookies else "lax",
        )  # fmt: skip
        return response

    @app.post("/reports/{rid}/delete")
    def delete_report(request: Request, rid: str):
        check_origin(request)
        user, _ = access(request, rid, "owner")
        delete(rid, user["id"], ip(request))
        return RedirectResponse("/", 303)

    def delete(rid: str, user_id: int, addr: str) -> None:
        """Deletion on request: archives, revisions, comments, links, and grants."""
        rep = store.one("SELECT name FROM reports WHERE id = ?", rid)
        numbers = [
            r["number"] for r in store.all("SELECT number FROM revisions WHERE report_id = ?", rid)
        ]
        with store.tx() as db:
            db.execute("DELETE FROM reports WHERE id = ?", (rid,))
        for n in numbers:
            store.delete_archive(rid, n)
        load.cache_clear()
        store.audit(
            "report.deleted",
            user_id,
            rid,
            addr,
            name=rep["name"] if rep else "",
            revisions=len(numbers),
        )

    @app.get("/reports/{rid}/audit.csv")
    def report_audit(request: Request, rid: str):
        user, _ = access(request, rid, "owner")
        return audit_csv(store.all("SELECT * FROM audit WHERE report_id = ? ORDER BY id", rid))

    def audit_csv(rows) -> Response:
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["time (UTC)", "user", "action", "report", "detail", "ip"])
        emails = {u["id"]: u["email"] for u in store.all("SELECT id, email FROM users")}
        text = lambda v: "'" + v if v[:1] in ("=", "+", "-", "@", "\t", "\r") else v  # noqa: E731
        for r in rows:
            at = datetime.fromtimestamp(r["at"], UTC).isoformat(timespec="seconds")
            w.writerow(
                [
                    at,
                    text(emails.get(r["user_id"], "")),
                    r["action"],
                    r["report_id"] or "",
                    text(r["detail"] or ""),
                    r["ip"],
                ]
            )
        return Response(
            out.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="audit.csv"'},
        )

    def export_options(form) -> Any:
        from datawalk import export as ex

        preview = {k[8:] for k in form if k.startswith("preview:")}
        return ex.ExportOptions(
            preview, form.get("datasets") == "1", str(form.get("watermark", ""))[:200]
        )

    def export_plan(report, options):
        """The shared export plan: classification policy, preview images, review."""
        from datawalk import export as ex

        try:
            return ex.plan_export(report, [("html", Path("report.html"))], options), None
        except (ex.ExportError, PolicyError) as e:
            return None, str(e)

    @app.get("/reports/{rid}/export", response_class=HTMLResponse)
    def export_page(request: Request, rid: str):
        """Export review: what an offline copy releases, chart by chart."""
        from datawalk import export as ex

        access(request, rid, "editor")
        report = load(rid, latest(rid))
        plan, error = export_plan(report, export_options(request.query_params))
        options = plan.options if plan else export_options(request.query_params)
        rep = store.one("SELECT * FROM reports WHERE id = ?", rid)
        has_preview = {v.key for v in report.visualizations if v.id in report._previews}
        return page(
            request,
            "export.html",
            report=rep,
            rows=ex.review(report, options),
            total=plan.total if plan else None,
            error=error,
            notes=plan.notes if plan else [],
            options=options,
            has_preview=has_preview,
            budget=ex.HTML_BUDGET_BYTES,
            datasets=bool(report.datasets),
        )

    @app.post("/reports/{rid}/export")
    async def export_download(request: Request, rid: str):
        from datawalk import export as ex

        check_origin(request)
        user, _ = access(request, rid, "editor")
        form = await request.form()
        if form.get("confirmed") != "1":
            raise HTTPException(422, tr(request, "error.confirm_export"))
        report = load(rid, latest(rid))
        plan, error = export_plan(report, export_options(form))
        if plan is None:
            raise HTTPException(422, error)
        html = ex.render_html(plan.bundle)
        options = plan.options
        store.audit(
            "report.exported", user["id"], rid, ip(request), format="html",
            preview_only=sorted(options.preview_only), datasets=options.include_datasets, watermark=options.watermark,
        )  # fmt: skip
        name = re.sub(r"[^\w-]+", "_", report.name)[:80] or "report"
        return Response(
            html,
            media_type="text/html",
            headers={"Content-Disposition": f'attachment; filename="{name}.html"'},
        )

    @app.get("/account", response_class=HTMLResponse)
    def account(request: Request, token: str = ""):
        user = require_user(request)
        tokens = store.all(
            "SELECT name, created_at, last_used FROM api_tokens WHERE user_id = ?", user["id"]
        )
        return page(request, "account.html", tokens=tokens, new_token=token)

    @app.post("/account/tokens")
    async def account_token(request: Request):
        check_origin(request)
        user = require_user(request)
        form = await request.form()
        token = auth.new_api_token(store, user["id"], str(form.get("name", "publish"))[:60])
        store.audit("token.created", user["id"], ip=ip(request))
        return RedirectResponse(f"/account?token={token}", 303)

    # -- administration -------------------------------------------------------------------

    def require_admin(request: Request):
        user = require_user(request)
        if not user["is_admin"]:
            raise HTTPException(403, tr(request, "error.admins_only"))
        return user

    @app.get("/admin", response_class=HTMLResponse)
    def admin(request: Request):
        require_admin(request)
        settings = {
            k: store.setting(k)
            for k in (
                "public_links",
                "public_link_max_days",
                "analytics",
                "retention_days",
                "keep_revisions",
                "frame_ancestors",
            )
        }
        groups = [
            dict(g)
            | {
                "members": [
                    m["email"]
                    for m in store.all(
                        "SELECT u.email FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?",
                        g["id"],
                    )
                ]
            }
            for g in store.all("SELECT * FROM groups ORDER BY name")
        ]
        users = store.all(
            "SELECT id, email, name, is_admin, sso_subject IS NOT NULL AS sso FROM users ORDER BY email"
        )
        return page(request, "admin.html", settings=settings, groups=groups, users=users)

    @app.post("/admin/settings")
    async def admin_settings(request: Request):
        check_origin(request)
        user = require_admin(request)
        form = await request.form()
        new = {
            "public_links": form.get("public_links") == "1",
            "public_link_max_days": max(1, min(365, int(form.get("public_link_max_days") or 30))),
            "analytics": form.get("analytics") == "1",
            "retention_days": max(0, int(form.get("retention_days") or 0)),
            "keep_revisions": max(0, int(form.get("keep_revisions") or 0)),
            "frame_ancestors": " ".join(
                o
                for o in str(form.get("frame_ancestors", "")).split()
                if re.fullmatch(r"https://[\w.-]+(:\d+)?", o)
            ),
        }
        for k, v in new.items():
            if store.setting(k) != v:
                store.set_setting(k, v)
                store.audit("setting.changed", user["id"], ip=ip(request), key=k, value=v)
        for (rid,) in store.all("SELECT id FROM reports"):
            prune(rid)
        return RedirectResponse("/admin", 303)

    @app.post("/admin/users")
    async def admin_users(request: Request):
        check_origin(request)
        admin_user = require_admin(request)
        form = await request.form()
        try:
            uid = auth.create_user(
                store,
                str(form["email"]),
                str(form.get("name", "")),
                str(form.get("password") or "") or None,
                form.get("admin") == "1",
            )
        except (auth.AuthError, Exception) as e:
            raise HTTPException(422, str(e)) from None
        store.audit("user.created", admin_user["id"], ip=ip(request), new_user=uid)
        return RedirectResponse("/admin", 303)

    @app.post("/admin/groups")
    async def admin_groups(request: Request):
        check_origin(request)
        admin_user = require_admin(request)
        form = await request.form()
        name, email = str(form.get("group", "")).strip(), str(form.get("email", "")).strip().lower()
        if not name:
            raise HTTPException(422)
        with store.tx() as db:
            db.execute("INSERT OR IGNORE INTO groups (name) VALUES (?)", (name,))
            gid = db.execute("SELECT id FROM groups WHERE name = ?", (name,)).fetchone()["id"]
            if email:
                u = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
                if u is None:
                    raise HTTPException(422, tr(request, "error.no_user", email=email))
                db.execute(
                    "INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)",
                    (gid, u["id"]),
                )
        store.audit("group.changed", admin_user["id"], ip=ip(request), group=name, added=email)
        return RedirectResponse("/admin", 303)

    @app.get("/admin/audit.csv")
    def admin_audit(request: Request):
        require_admin(request)
        return audit_csv(store.all("SELECT * FROM audit ORDER BY id"))

    @app.get("/api/audit")
    def api_audit(request: Request):
        require_admin(request)
        return [
            dict(r) | {"detail": json.loads(r["detail"])}
            for r in store.all("SELECT * FROM audit ORDER BY id")
        ]

    # -- publish --------------------------------------------------------------------------

    def prune(rid: str) -> None:
        """Retention: delete old revisions; the latest revision always stays."""
        keep, days = store.setting("keep_revisions"), store.setting("retention_days")
        rows = store.all(
            "SELECT number, created_at FROM revisions WHERE report_id = ? ORDER BY number DESC", rid
        )
        drop = [
            r["number"]
            for i, r in enumerate(rows)
            if i > 0
            and ((keep and i >= keep) or (days and r["created_at"] < time.time() - days * 86400))
        ]
        if not drop:
            return
        with store.tx() as db:
            db.executemany(
                "DELETE FROM revisions WHERE report_id = ? AND number = ?", [(rid, n) for n in drop]
            )
        for n in drop:
            store.delete_archive(rid, n)
        store.audit("revision.pruned", None, rid, revisions=drop)

    @app.post("/api/publish")
    async def publish(request: Request):
        user = require_user(request)
        if not request.headers.get("authorization"):
            raise HTTPException(401, tr(request, "error.publish_token"))
        if int(request.headers.get("content-length") or 0) > MAX_ARCHIVE:
            raise HTTPException(413, tr(request, "error.too_large"))
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_ARCHIVE:
                raise HTTPException(413, tr(request, "error.too_large"))
            chunks.append(chunk)
        data = b"".join(chunks)
        try:
            report = read(io.BytesIO(data))
            policy(report.classification)  # the hub knows the label
        except (ArchiveError, ValueError) as e:
            raise HTTPException(422, tr(request, "error.bad_archive", error=e)) from None
        rid = report.id
        existing = store.one("SELECT * FROM reports WHERE id = ?", rid)
        if existing and ROLES.get(role(user, rid) or "", 0) < ROLES["editor"]:
            raise HTTPException(403, tr(request, "error.editors_only"))
        previous = load(rid, latest(rid)) if existing else None
        number = (latest(rid) + 1) if existing else 1
        change = diff_changes(previous, report)
        store.write_archive(rid, number, data)
        with store.tx() as db:
            if not existing:
                db.execute(
                    "INSERT INTO reports (id, name, owner_id, created_at, classification) VALUES (?, ?, ?, ?, ?)",
                    (rid, report.name, user["id"], time.time(), report.classification),
                )
            else:
                db.execute(
                    "UPDATE reports SET name = ?, classification = ? WHERE id = ?",
                    (report.name, report.classification, rid),
                )
            db.execute(
                "INSERT INTO revisions (report_id, number, created_at, author_id, size, sha256, changes) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    rid,
                    number,
                    time.time(),
                    user["id"],
                    len(data),
                    hashlib.sha256(data).hexdigest(),
                    json.dumps(change),
                ),
            )
        store.audit(
            "report.published", user["id"], rid, ip(request), revision=number, name=report.name
        )
        prune(rid)
        return {
            "report_id": rid,
            "revision": number,
            "url": f"{cfg.base_url}/reports/{rid}",
            "changes": change,
        }

    @app.get("/api/reports/{rid}/archive")
    def api_archive(request: Request, rid: str):
        """The latest revision as a .dwk file, with its presentation edits (report as code)."""
        user, _ = access(request, rid, "editor")
        n = latest(rid)
        store.audit("report.downloaded", user["id"], rid, ip(request), revision=n)
        return Response(
            store.read_archive(rid, n),
            media_type="application/octet-stream",
            headers={"X-Revision": str(n)},
        )

    @app.get("/api/reports")
    def api_reports(request: Request):
        user = require_user(request)
        return [
            {k: r[k] for k in ("id", "name", "role", "latest", "updated")}
            for r in reports_for(user)
        ]

    @app.delete("/api/reports/{rid}")
    def api_delete(request: Request, rid: str):
        check_origin(request)
        user, _ = access(request, rid, "owner")
        delete(rid, user["id"], ip(request))
        return {"deleted": rid}

    @app.get("/api/mentions")
    def api_mentions(request: Request):
        user = require_user(request)
        return [
            dict(r)
            for r in store.all(
                "SELECT c.id, c.report_id, c.viz_key FROM mentions m JOIN comments c ON c.id = m.comment_id WHERE m.user_id = ? AND m.seen = 0",
                user["id"],
            )
        ]

    @app.get("/static-hub/{name}")
    def hub_static(name: str):
        if not re.fullmatch(r"[\w-]+\.js", name) or not (HUB_STATIC / name).is_file():
            raise HTTPException(404)
        return FileResponse(HUB_STATIC / name, media_type="text/javascript")

    # -- the viewer ----------------------------------------------------------------------

    def viewer_file(path: str) -> Response:
        target = (VIEWER / (path or "index.html")).resolve()
        if not target.is_relative_to(VIEWER.resolve()) or not target.is_file():
            raise HTTPException(404)
        return FileResponse(
            target, media_type=mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        )

    def comment_json(row, users: dict[int, str]) -> dict:
        return {
            "id": row["id"], "key": row["viz_key"], "parent": row["parent_id"], "author": users.get(row["author_id"], "?"),
            "body": store.open(row["body"], f"comment:{row['report_id']}").decode(), "kind": row["kind"],
            "created_at": row["created_at"], "resolved": row["resolved_at"] is not None,
        }  # fmt: skip

    async def viewer_api(request: Request, rid: str, number: int, rest: str) -> Response:
        user, r = access(request, rid)
        report = load(rid, number)
        if rest == "report":
            return Response(report.model_dump_json(), media_type="application/json")
        if rest == "session":
            rep = store.one("SELECT classification FROM reports WHERE id = ?", rid)
            return JSONResponse({
                "editable": False, "saves_to": None,
                "hub": {
                    "user": user["name"] if user else None, "role": r, "report_id": rid, "revision": number,
                    "latest": latest(rid), "analytics": bool(store.setting("analytics")),
                    "classification": rep["classification"] if rep else "",
                },
            })  # fmt: skip
        m = re.fullmatch(r"visualizations/([0-9a-f]{32})/(payload|preview\.png)", rest)
        if m:
            vid, what = m.groups()
            if what == "payload" and vid in report._payloads:
                return JSONResponse(report._payloads[vid])
            if what == "preview.png" and vid in report._previews:
                return Response(report._previews[vid], media_type="image/png")
            raise HTTPException(404)
        if rest == "brand/logo.png" and report._brand_logo:
            return Response(report._brand_logo, media_type="image/png")
        m = re.fullmatch(r"datasets/([0-9a-f]{32})\.csv", rest)
        if m and m.group(1) in report._datasets:
            store.audit(
                "dataset.downloaded",
                user["id"] if user else None,
                rid,
                ip(request),
                dataset=m.group(1),
            )
            return Response(report._datasets[m.group(1)], media_type="text/csv")
        m = re.fullmatch(r"vendor/bokeh/(\d+\.\d+\.\d+)/([\w-]+)\.min\.js", rest)
        if m:
            from datawalk.vendor import BOKEH_FILES, bokeh_js

            if m.group(2) not in BOKEH_FILES:
                raise HTTPException(404)
            try:
                return FileResponse(bokeh_js(m.group(1))[m.group(2)], media_type="text/javascript")
            except LookupError as e:
                raise HTTPException(404, str(e)) from None
        if rest == "comments":
            if request.method == "POST":
                check_origin(request)
                if user is None:
                    raise HTTPException(401, tr(request, "error.sign_in_to_comment"))
                body = await request.json()
                text = str(body.get("body", "")).strip()[:5000]
                key = str(body.get("key", ""))
                kind = "question" if body.get("kind") == "question" else "comment"
                if not text or report.get(key) is None:
                    raise HTTPException(422)
                parent = body.get("parent")
                with store.tx() as db:
                    cur = db.execute(
                        "INSERT INTO comments (report_id, viz_key, parent_id, author_id, body, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (
                            rid,
                            key,
                            parent,
                            user["id"],
                            store.seal(text.encode(), f"comment:{rid}"),
                            kind,
                            time.time(),
                        ),
                    )
                    cid = cur.lastrowid
                    for email in set(MENTION.findall(text)):
                        target = db.execute(
                            "SELECT * FROM users WHERE email = ?", (email.lower(),)
                        ).fetchone()
                        if target and role(target, rid):
                            db.execute(
                                "INSERT OR IGNORE INTO mentions (comment_id, user_id) VALUES (?, ?)",
                                (cid, target["id"]),
                            )
                store.audit("comment.created", user["id"], rid, ip(request), key=key, kind=kind)
                return JSONResponse({"id": cid}, 201)
            users = {u["id"]: u["name"] for u in store.all("SELECT id, name FROM users")}
            rows = store.all("SELECT * FROM comments WHERE report_id = ? ORDER BY created_at", rid)
            if user:
                with store.tx() as db:
                    db.execute(
                        "UPDATE mentions SET seen = 1 WHERE user_id = ? AND comment_id IN (SELECT id FROM comments WHERE report_id = ?)",
                        (user["id"], rid),
                    )
            return JSONResponse([comment_json(c, users) for c in rows])
        m = re.fullmatch(r"comments/(\d+)/resolve", rest)
        if m and request.method == "POST":
            check_origin(request)
            c = store.one(
                "SELECT * FROM comments WHERE id = ? AND report_id = ?", int(m.group(1)), rid
            )
            if (
                c is None
                or user is None
                or (c["author_id"] != user["id"] and ROLES[r] < ROLES["editor"])
            ):
                raise HTTPException(403)
            resolved = (await request.json()).get("resolved", True)
            with store.tx() as db:
                db.execute(
                    "UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?",
                    (time.time() if resolved else None, user["id"] if resolved else None, c["id"]),
                )
            return JSONResponse({"resolved": bool(resolved)})
        if rest == "view" and request.method == "POST":
            check_origin(request)
            if store.setting("analytics"):
                key = str((await request.json()).get("key", ""))[:200]
                if report.get(key):
                    day = datetime.now(UTC).date().isoformat()
                    with store.tx() as db:
                        db.execute(
                            "INSERT INTO views (report_id, viz_key, day, count) VALUES (?, ?, ?, 1) "
                            "ON CONFLICT(report_id, viz_key, day) DO UPDATE SET count = count + 1",
                            (rid, key, day),
                        )
            return Response(status_code=204)
        raise HTTPException(404)

    async def viewer(request: Request, rid: str, number: int | None, rest: str) -> Response:
        if not store.one("SELECT 1 FROM reports WHERE id = ?", rid):
            raise HTTPException(404)
        n = number if number is not None else latest(rid)
        if not store.one("SELECT 1 FROM revisions WHERE report_id = ? AND number = ?", rid, n):
            raise HTTPException(404, tr(request, "error.no_revision"))
        if rest.startswith("api/"):
            return await viewer_api(request, rid, n, rest[4:])
        if rest in ("", "index.html"):
            try:
                user, _ = access(request, rid)
            except HTTPException as e:
                if e.status_code == 401:
                    return RedirectResponse(f"/login?next={quote(str(request.url.path))}", 303)
                raise
            store.audit("report.viewed", user["id"] if user else None, rid, ip(request), revision=n)
        return viewer_file(rest)

    @app.api_route("/r/{rid}/v/{number}/{rest:path}", methods=["GET", "POST"])
    async def viewer_revision(request: Request, rid: str, number: int, rest: str):
        return await viewer(request, rid, number, rest)

    @app.api_route("/r/{rid}/{rest:path}", methods=["GET", "POST"])
    async def viewer_latest(request: Request, rid: str, rest: str):
        return await viewer(request, rid, None, rest)

    @app.websocket("/r/{rid}/api/live")
    async def live_socket(ws: WebSocket, rid: str):
        # Same access rules as the viewer: session or link cookie.
        user = auth.session_user(store, ws.cookies.get(COOKIE))
        r = role(user, rid)
        if r is None and ws.cookies.get(f"dw_link_{rid}"):
            row = store.one(
                "SELECT * FROM links WHERE token_hash = ? AND report_id = ? AND revoked = 0",
                token_hash(ws.cookies[f"dw_link_{rid}"]),
                rid,
            )
            if (
                row
                and (not row["expires_at"] or row["expires_at"] > time.time())
                and (user or (row["public"] and public_allowed(rid)))
            ):
                r = "viewer"
        origin = urlparse(ws.headers.get("origin", ""))
        want = urlparse(cfg.base_url)
        if r is None or (origin.scheme, origin.netloc) != (want.scheme, want.netloc):
            await ws.close(code=4403)
            return
        await ws.accept()
        presenter = ws.query_params.get("role") == "presenter" and ROLES[r] >= ROLES["editor"]
        member = Member(ws, user["id"] if user else 0, user["name"] if user else "Guest")
        await live.join(rid, member, presenter)
        if presenter:
            store.audit("live.started", member.user_id or None, rid)
        try:
            while True:
                data = await ws.receive_json()
                if isinstance(data, dict):
                    await live.message(rid, member, data)
        except (WebSocketDisconnect, ValueError):
            pass
        finally:
            await live.leave(rid, member)

    return app
