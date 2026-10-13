"""Local viewer and editor server. Binds to 127.0.0.1 only.

Reading is open to the local machine. Writing needs the per-session token that
`serve(edit=True)` puts in the URL fragment (never sent in requests or logs by browsers)."""

from __future__ import annotations

import asyncio
import dataclasses
import secrets
import socket
import threading
import webbrowser
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from ..core.models import ReportModel

if TYPE_CHECKING:
    import uvicorn

    from ..guide import Guide
    from ..reports.report import Report

STATIC = Path(__file__).parent / "static"
MAX_PREVIEW_BYTES = 20 * 2**20

# The viewer loads nothing from other origins. 'wasm-unsafe-eval' is for the Rapier
# physics engine; 'unsafe-eval' is for Plotly.js WebGL traces.
CSP = (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; "
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
    "connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; "
    "base-uri 'none'; frame-ancestors 'self'"
)


class ExportRequest(BaseModel):
    preview_only: list[str] = []  # visualization keys
    datasets: bool = False
    watermark: str = Field("", max_length=200)
    confirmed: bool = False  # the author saw the review of exactly these options


RefId = Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]
Lang = Literal["en", "de"]


class PlanRequest(BaseModel):
    minutes: Literal[3, 5, 10] = 3
    lang: Lang = "en"
    refresh: bool = False


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    current: RefId | None = None  # the tour stop on screen
    inspecting: RefId | None = None  # the chart in the inspector
    stops: list[RefId] = Field(default=[], max_length=1000)  # the tour being presented
    lang: Lang = "en"


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)  # one sentence; a long one too
    lang: Lang = "en"


def same_site_json(request: Request) -> None:
    """Guide requests run a local model: only this page may send them. A cross-site page can
    send a POST without a preflight when it has no JSON content type, so both are checked."""
    if request.headers.get("sec-fetch-site", "same-origin") not in ("same-origin", "none"):
        raise HTTPException(403, "Cross-site requests are not accepted.")
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        raise HTTPException(415, "Send JSON (Content-Type: application/json).")


def create_app(report: Report, token: str | None = None, guide: Guide | None = None) -> FastAPI:
    from ..reports.report import RevisionConflict
    from ..serialization.archive import write

    lock = threading.Lock()
    app = FastAPI(title="DataWalk", docs_url=None, redoc_url=None, openapi_url=None)
    # Rejects DNS-rebinding requests that reach 127.0.0.1 under a foreign host name.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    def editor(request: Request) -> bool:
        given = request.headers.get("authorization", "")
        return token is not None and secrets.compare_digest(given, f"Bearer {token}")

    @app.get("/api/report")
    def get_report() -> Response:
        return Response(report.model_dump_json(), media_type="application/json")

    @app.get("/api/session")
    def get_session(request: Request) -> dict:
        editable = editor(request)
        path = report._path if editable else None  # the file name is for the editor only
        session = {"editable": editable, "saves_to": path.name if path else None}
        if guide is not None:
            session["guide"] = True  # the viewer loads the AI guide (opt-in: --guide)
        if editable:
            from ..policy import labels

            session["labels"] = list(labels())  # classification labels of the organization
        return session

    @app.put("/api/report")
    async def put_report(request: Request) -> Response:
        if not editor(request):
            raise HTTPException(403, "This session is read-only.")
        try:
            incoming = ReportModel.model_validate_json(await request.body())
        except ValidationError as e:
            raise HTTPException(422, str(e)) from None
        with lock:
            try:
                report.apply_presentation(incoming)
            except RevisionConflict as e:
                raise HTTPException(409, str(e)) from None
            except ValueError as e:
                raise HTTPException(422, str(e)) from None
            if report._path is not None:
                write(report, report._path)
            body = report.model_dump_json()
        return Response(body, media_type="application/json")

    @app.put("/api/visualizations/{vid}/preview.png")
    async def put_preview(vid: str, request: Request) -> Response:
        """Store a preview that the editor rendered in the browser (Plotly charts)."""
        if not editor(request):
            raise HTTPException(403, "This session is read-only.")
        viz = next((v for v in report.visualizations if v.id == vid), None)
        if viz is None:
            raise HTTPException(404)
        png = await request.body()
        if len(png) > MAX_PREVIEW_BYTES or not png.startswith(b"\x89PNG\r\n\x1a\n"):
            raise HTTPException(422, "Expected a PNG image of at most 20 MB.")
        with lock:
            report._previews[vid] = png
            viz.source.has_preview = True
            if report._path is not None:
                write(report, report._path)
        return Response(status_code=204)

    def export_options(body: ExportRequest, request: Request):
        from .. import export as ex

        if not editor(request):
            raise HTTPException(403, "Exports need an editing session.")
        return ex, ex.ExportOptions(set(body.preview_only), body.datasets, body.watermark.strip())

    def export_plan(ex, options):
        from ..policy import PolicyError

        try:
            return ex.plan_export(report, [("html", Path("report.html"))], options), None
        except (ex.ExportError, PolicyError) as e:
            return None, str(e)

    @app.post("/api/export/review")
    def export_review(body: ExportRequest, request: Request) -> dict:
        """What an export with these options releases: per chart, and in total."""
        ex, options = export_options(body, request)
        with lock:
            plan, error = export_plan(ex, options)
            rows = ex.review(report, plan.options if plan else options)
            previews = [v.key for v in report.visualizations if v.id in report._previews]
        return {
            "rows": [dataclasses.asdict(r) for r in rows],
            "total_bytes": plan.total if plan else None,
            "budget_bytes": ex.HTML_BUDGET_BYTES,
            "error": error,
            "notes": plan.notes if plan else [],
            "has_preview": previews,
        }

    @app.post("/api/export/html")
    def export_html(body: ExportRequest, request: Request) -> Response:
        ex, options = export_options(body, request)
        if not body.confirmed:
            raise HTTPException(422, "Confirm the export review first.")
        with lock:
            plan, error = export_plan(ex, options)
            if plan is None:
                raise HTTPException(422, error)
            html = ex.render_html(plan.bundle)
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in report.name)[:80] or "report"
        return Response(
            html,
            media_type="text/html",
            headers={"Content-Disposition": f'attachment; filename="{safe}.html"'},
        )

    @app.get("/api/brand/logo.png")
    def get_logo() -> Response:
        if not report._brand_logo:
            raise HTTPException(404)
        return Response(report._brand_logo, media_type="image/png")

    @app.get("/api/vendor/bokeh/{version}/{name}.min.js")
    def get_bokeh(version: str, name: str) -> Response:
        """BokehJS from the installed bokeh package, for Bokeh charts in this report."""
        from ..vendor import BOKEH_FILES, bokeh_js

        if name not in BOKEH_FILES:
            raise HTTPException(404)
        try:
            path = bokeh_js(version)[name]
        except LookupError as e:
            raise HTTPException(404, str(e)) from None
        return Response(path.read_bytes(), media_type="text/javascript")

    @app.get("/api/visualizations/{vid}/payload")
    def get_payload(vid: str) -> JSONResponse:
        if vid not in report._payloads:
            raise HTTPException(404)
        return JSONResponse(report._payloads[vid])

    @app.get("/api/datasets/{did}.csv")
    def get_dataset(did: str) -> Response:
        if did not in report._datasets:
            raise HTTPException(404)
        name = next(d.key for d in report.datasets if d.id == did)
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
        return Response(
            report._datasets[did],
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{safe}.csv"'},
        )

    @app.get("/api/visualizations/{vid}/preview.png")
    def get_preview(vid: str) -> Response:
        if vid not in report._previews:
            raise HTTPException(404)
        return Response(report._previews[vid], media_type="image/png")

    if guide is not None:
        _guide_routes(app, report, guide)

    if (STATIC / "index.html").exists():
        app.mount("/", StaticFiles(directory=STATIC, html=True), name="viewer")
    else:

        @app.get("/")
        def not_built() -> HTMLResponse:
            return HTMLResponse(
                "<h1>DataWalk viewer is not built</h1>"
                "<p>Run <code>npm run build</code> in apps/web, or start the Vite dev server.</p>"
            )

    return app


def _guide_routes(app: FastAPI, report: Report, guide: Guide) -> None:
    """The AI guide: status, plan, questions, speech. Plain `def`: the model calls block, so
    FastAPI runs them in its thread pool."""
    from ..guide import GuideError

    checked = [Depends(same_site_json)]

    @app.get("/api/guide/status")
    def guide_status() -> dict:
        return guide.status()

    @app.post("/api/guide/plan", dependencies=checked)
    def guide_plan(body: PlanRequest) -> dict:
        try:
            return guide.plan(report, body.minutes, body.lang, body.refresh).to_json()
        except GuideError as e:
            raise HTTPException(503, str(e)) from None

    @app.post("/api/guide/ask", dependencies=checked)
    def guide_ask(body: AskRequest) -> dict:
        context = body.model_dump(exclude={"question"})
        try:
            return guide.ask(report, body.question, **context)
        except GuideError as e:
            raise HTTPException(503, str(e)) from None

    @app.post("/api/guide/speech", dependencies=checked)
    def guide_speech(body: SpeechRequest) -> dict:
        try:
            return guide.speech(body.text, body.lang)
        except GuideError as e:
            raise HTTPException(503, str(e)) from None


def _in_event_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


_running: dict[int, uvicorn.Server] = {}  # report object id -> its background server


def serve(
    report: Report,
    port: int | None = None,
    open_browser: bool = True,
    block: bool | None = None,
    edit: bool = False,
    guide: bool = False,
) -> str:
    import uvicorn

    helper = None
    if guide:  # first: a configuration error stops before the port is taken
        from ..guide import Guide

        helper = Guide()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("127.0.0.1", port or 0))  # port 0: the OS picks a free port
    except OSError:
        sock.close()
        raise OSError(f"port {port} is in use. Choose another port, or give none.") from None
    sock.listen(128)  # accept early connections (the browser) before uvicorn starts
    token = secrets.token_urlsafe(24) if edit else None
    url = f"http://127.0.0.1:{sock.getsockname()[1]}/" + (f"#edit={token}" if token else "")
    if helper is not None:
        print(f"AI guide: {helper.llm.model} (local)", flush=True)
        threading.Thread(target=helper.warm, daemon=True).start()
    server = uvicorn.Server(uvicorn.Config(create_app(report, token, helper), log_level="warning"))
    if not (STATIC / "index.html").exists():
        print("warning: the viewer is not built (npm run build in apps/web).", flush=True)
    print(f"DataWalk {'editor' if edit else 'viewer'}: {url}", flush=True)
    if open_browser:
        webbrowser.open(url)
    if block is None:
        block = not _in_event_loop()
    if not block:
        # Jupyter: one server per report object; showing it again replaces the earlier one.
        if (earlier := _running.pop(id(report), None)) is not None:
            earlier.should_exit = True
        _running[id(report)] = server
        threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True).start()
        return url
    print("Press Ctrl+C to stop.", flush=True)
    try:
        server.run(sockets=[sock])
    except KeyboardInterrupt:
        pass
    print("Stopped.")
    if edit and report._path is None:
        print("note: editor changes were not saved. Call report.save('name.dwk') before show().")
    return url
