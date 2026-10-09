"""Exports for people without Python: a static site and a single HTML file.

Every export is a data release. `review()` lists what would leave the machine; the author
confirms it (CLI prompt or editor dialog) and may reduce any chart to its preview image.
"""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import shutil
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from ..reports.report import Report

PACKAGE = Path(__file__).resolve().parents[1]
STATIC = PACKAGE / "server" / "static"  # full app build: theme assets live here
VIEWER = PACKAGE / "server" / "viewer"  # viewer-only build (no editor code)
HTML_BUDGET_BYTES = 20 * 2**20  # Outlook accepts 20 MB attachments, Gmail 25 MB

Level = Literal["preview", "data", "datasets"]
LEVEL_LABEL = {"preview": "preview only", "data": "chart data", "datasets": "chart data + datasets"}


class ExportError(ValueError):
    pass


@dataclass
class ReviewRow:
    id: str
    key: str
    name: str
    kind: str  # chart type
    level: Level
    points: int  # data points that leave the machine with this level
    bytes: int
    datasets: list[str] = field(default_factory=list)  # dataset keys included


@dataclass
class ExportOptions:
    preview_only: set[str] = field(default_factory=set)  # visualization keys
    include_datasets: bool = False
    watermark: str = ""


def _array_len(v: Any) -> int:
    """Number of values in a Plotly data array: plain list, nested list or typed array."""
    if isinstance(v, list):
        return sum(_array_len(x) if isinstance(x, list) else 1 for x in v)
    if isinstance(v, dict) and "bdata" in v:
        size = {"i1": 1, "u1": 1, "u1c": 1, "i2": 2, "u2": 2, "i4": 4, "u4": 4, "f4": 4, "f8": 8}
        return len(base64.b64decode(v["bdata"])) // size.get(v.get("dtype", "f8"), 8)
    return 0


def point_count(payload: dict[str, Any] | None) -> int:
    """Data values that a payload releases (an image or a text releases none)."""
    if not payload:
        return 0
    kind = payload["kind"]
    if kind == "series":
        return sum(len(s["x"]) for s in payload["series"])
    if kind == "table":
        return len(payload["rows"])
    if kind == "kpi":
        return 1
    if kind == "plotly":
        keys = ("x", "y", "z", "values", "r", "lat", "open", "a", "labels")
        return sum(
            max((_array_len(t.get(k)) for k in keys), default=0)
            for t in payload["figure"].get("data", [])
        )
    if kind == "vegalite":
        return _vega_rows(payload["spec"])
    if kind == "bokeh":
        return _bokeh_rows(payload["item"])
    return 0  # text, svg


def _bokeh_rows(node: Any) -> int:
    """Rows in the ColumnDataSources of a Bokeh json_item (longest column per source)."""
    if isinstance(node, list):
        return sum(_bokeh_rows(v) for v in node)
    if not isinstance(node, dict):
        return 0
    if node.get("name") == "ColumnDataSource":
        entries = ((node.get("attributes") or {}).get("data") or {}).get("entries") or []
        lengths = [
            len(v) if isinstance(v, list) else (v.get("shape") or [0])[0]
            for _, v in entries
            if isinstance(v, list | dict)
        ]
        return max(lengths, default=0)
    return sum(_bokeh_rows(v) for v in node.values())


def _vega_rows(node: Any) -> int:
    """Inline data rows in a Vega-Lite spec (data.values and top-level datasets)."""
    if isinstance(node, list):
        return sum(_vega_rows(v) for v in node)
    if not isinstance(node, dict):
        return 0
    n = sum(len(v) for v in (node.get("datasets") or {}).values() if isinstance(v, list))
    data = node.get("data")
    if isinstance(data, dict) and isinstance(data.get("values"), list):
        n += len(data["values"])
    return n + sum(_vega_rows(v) for k, v in node.items() if k not in ("data", "datasets"))


def review(report: Report, options: ExportOptions | None = None) -> list[ReviewRow]:
    o = options or ExportOptions()
    rows = []
    for v in report.visualizations:
        if v.status != "active":
            continue
        payload = report._payloads.get(v.id)
        preview = report._previews.get(v.id, b"")
        level: Level = "data" if payload and v.key not in o.preview_only else "preview"
        # A preview-only chart takes no datasets with it (as in `prepare`).
        attach = o.include_datasets and level == "data"
        ds = [d for d in report.datasets if v.id in d.visualizations] if attach else []
        if ds and level == "data":
            level = "datasets"
        size = len(preview) + (len(json.dumps(payload)) if level != "preview" else 0)
        size += sum(len(report._datasets.get(d.id, b"")) for d in ds)
        points = (point_count(payload) if level != "preview" else 0) + sum(d.rows for d in ds)
        rows.append(
            ReviewRow(
                v.id, v.key, v.name, v.source.chart_type, level, points, size, [d.key for d in ds]
            )
        )
    return rows


def format_review(rows: list[ReviewRow], total_bytes: int | None = None) -> str:
    short = lambda name: name if len(name) <= 48 else name[:47] + "…"  # noqa: E731
    w = max([len(short(r.name)) for r in rows] + [4])
    lines = [f"{'Chart':{w}}  {'Data in the export':22}  {'Points':>9}  {'Size':>9}"]
    for r in rows:
        extra = f" ({', '.join(r.datasets)})" if r.datasets else ""
        level = LEVEL_LABEL[r.level] + extra
        size = f"{r.bytes / 1024:,.0f} K" if r.bytes >= 1024 else "< 1 K"
        lines.append(f"{short(r.name):{w}}  {level:22}  {r.points:>9,}  {size:>9}")
    if total_bytes is not None:
        lines.append(f"Total export size: {total_bytes / 2**20:.1f} MB")
    return "\n".join(lines)


# -- export bundle --------------------------------------------------------


@dataclass
class Bundle:
    data: dict[str, Any]  # report, payloads, previews (bytes), datasets (bytes), export
    assets: dict[str, Path]  # published path -> file on disk


def _themes_used(report: Report) -> set[str]:
    return {r.theme or report.theme for r in report.rooms} or {report.theme}


def theme_assets(themes: set[str]) -> dict[str, Path]:
    """Files that the viewer loads for these themes."""
    if not (STATIC / "library" / "index.json").exists():
        raise ExportError("The viewer is not built: run `npm run build` in apps/web.")
    files: dict[str, Path] = {"library/index.json": STATIC / "library" / "index.json"}
    for f in (STATIC / "vendor" / "basis").glob("*"):
        files[f"vendor/basis/{f.name}"] = f
    for tid in sorted(themes):
        theme = json.loads((STATIC / "themes" / tid / "theme.json").read_text())
        room = json.loads((STATIC / "themes" / tid / "room.json").read_text())
        for name in ("theme.json", "room.json"):
            files[f"themes/{tid}/{name}"] = STATIC / "themes" / tid / name
        light = theme["lighting"]
        files[f"library/hdri/{light['environment']}.hdr"] = (
            STATIC / "library" / "hdri" / f"{light['environment']}.hdr"
        )
        if light.get("view"):
            files[f"library/views/{light['view']}.jpg"] = (
                STATIC / "library" / "views" / f"{light['view']}.jpg"
            )
        for surface in theme["surfaces"].values():
            if isinstance(surface, dict) and surface.get("material"):
                for m in ("color", "normal", "arm"):
                    rel = f"library/materials/{surface['material']}/{m}.ktx2"
                    files[rel] = STATIC / rel
        models = {f["model"] for f in room.get("furniture", [])}
        if room.get("pendants"):
            models.add(room["pendants"]["model"])
        for m in models:
            files[f"library/models/{m}.glb"] = STATIC / "library" / "models" / f"{m}.glb"
    missing = [k for k, p in files.items() if not p.exists()]
    if missing:
        raise ExportError(f"Theme assets are missing: {missing[:5]}")
    return files


def prepare(report: Report, options: ExportOptions | None = None) -> Bundle:
    o = options or ExportOptions()
    rows = review(report, o)
    levels = {r.id: r.level for r in rows}
    unknown = o.preview_only - {v.key for v in report.visualizations}
    if unknown:
        raise ExportError(f"Unknown keys for --preview-only: {sorted(unknown)}")
    missing = [
        v.key
        for v in report.visualizations
        if v.id in levels and levels[v.id] == "preview" and v.id not in report._previews
    ]
    if missing:
        raise ExportError(
            "These charts have no preview image, so they cannot be exported as preview only: "
            f"{missing}. Open the report in the editor once (it stores Plotly previews), or "
            "export them with chart data."
        )
    # Only active visualizations leave the machine; removed ones stay in the .dwk file.
    doc = json.loads(report.model_dump_json())
    keep = {r.id for r in rows}
    doc["visualizations"] = [v for v in doc["visualizations"] if v["id"] in keep]
    for room in doc["rooms"]:
        room["items"] = [
            i for i in room["items"] if i in keep or i in {d["id"] for d in doc["dashboards"]}
        ]
        room["placements"] = {k: p for k, p in room["placements"].items() if k in room["items"]}
    for d in doc["dashboards"]:
        d["items"] = [i for i in d["items"] if i in keep]
    doc["links"] = [
        x for x in doc["links"] if all(i in keep and levels[i] != "preview" for i in x["items"])
    ]
    shared = {
        d.id for d in report.datasets if any(levels.get(v) == "datasets" for v in d.visualizations)
    }
    doc["datasets"] = [d for d in doc["datasets"] if d["id"] in shared]
    for v in doc["visualizations"]:
        if levels[v["id"]] == "preview":
            v["source"]["has_payload"] = False
            v["source"]["mode"] = "static"
            v["source"]["limitations"] = v["source"]["limitations"] + [
                "Exported as a preview image only: the data values are not included."
            ]
        if v["id"] in report._previews:
            v["source"]["has_preview"] = True

    payloads = {
        vid: p for vid, p in report._payloads.items() if levels.get(vid) in ("data", "datasets")
    }
    previews = {vid: report._previews[vid] for vid in keep if vid in report._previews}
    datasets = {did: report._datasets[did] for did in shared}
    canonical = json.dumps(
        {
            "report": doc,
            "payloads": payloads,
            "previews": {k: hashlib.sha256(v).hexdigest() for k, v in previews.items()},
            "datasets": {k: hashlib.sha256(v).hexdigest() for k, v in datasets.items()},
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    export = {
        "revision": report.revision,
        "exported_at": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "hash": "sha256:" + hashlib.sha256(canonical.encode()).hexdigest(),
        "watermark": o.watermark,
        "levels": levels,
        "generator": "datawalk",
        "classification": report.classification,
    }
    data = {
        "report": doc,
        "payloads": payloads,
        "previews": previews,
        "datasets": datasets,
        "export": export,
        "brand_logo": report._brand_logo,
    }
    assets = theme_assets(_themes_used(report))
    # Bokeh charts need BokehJS of their version, from the installed bokeh package.
    from ..vendor import bokeh_js

    for version in sorted({p["version"] for p in payloads.values() if p["kind"] == "bokeh"}):
        try:
            files = bokeh_js(version)
        except LookupError as e:
            raise ExportError(str(e)) from None
        for name, path in files.items():
            assets[f"vendor/bokeh/{version}/{name}.min.js"] = path
    return Bundle(data, assets)


def estimate_size(bundle: Bundle, single_file: bool) -> int:
    """Approximate export size in bytes; a single file stores binary data as base64 (+33 %)."""
    d = bundle.data
    raw = sum(len(v) for v in d["previews"].values()) + sum(len(v) for v in d["datasets"].values())
    raw += sum(p.stat().st_size for p in bundle.assets.values())
    text = len(json.dumps(d["report"])) + sum(len(json.dumps(p)) for p in d["payloads"].values())
    name = "viewer.js" if needs_chart_libraries(bundle) else "viewer-lite.js"
    viewer = (VIEWER / name).stat().st_size if (VIEWER / name).exists() else 0
    return int(raw * (4 / 3 if single_file else 1)) + text + viewer


def needs_chart_libraries(bundle: Bundle) -> bool:
    """Plotly and Vega are for Plotly and Vega-Lite charts and linked views only."""
    kinds = {p["kind"] for p in bundle.data["payloads"].values()}
    return bool(kinds & {"plotly", "vegalite"}) or bool(bundle.data["report"]["links"])


def _viewer_files(bundle: Bundle) -> tuple[str, str]:
    """The export viewer: the lite one (no Plotly, no Vega: 5 MB less) when the report allows."""
    js = VIEWER / ("viewer.js" if needs_chart_libraries(bundle) else "viewer-lite.js")
    css = VIEWER / "viewer.css"
    if not js.exists():
        raise ExportError("The viewer-only build is missing: run `npm run build` in apps/web.")
    return js.read_text(), css.read_text() if css.exists() else ""


def _page(head: str, body: str, root: str = "") -> str:
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n'
        f'{head}</head>\n<body>\n<div id="root">{root}</div>\n{body}</body>\n</html>\n'
    )


# Shown until the viewer starts. Browsers do not run a web site from the disk (file://).
SITE_FALLBACK = (
    '<p style="font: 16px/1.5 system-ui, sans-serif; max-width: 640px; margin: 15vh auto; '
    'padding: 0 16px; color: #888">Loading the report&hellip; If this page stays empty, open '
    "this folder through a web server, not from the disk. For a quick test: run "
    "<code>python -m http.server</code> in this folder, then open http://localhost:8000.</p>"
)


def write_site(bundle: Bundle, out: Path) -> Path:
    """A folder for any static host (S3, GitHub Pages, an intranet server): relative paths only."""
    out = Path(out)
    if out.exists() and any(out.iterdir()):
        index = out / "index.html"
        if not (index.exists() and 'name="datawalk-data"' in index.read_text(errors="replace")):
            raise ExportError(f"{out} is not empty, and it is not an earlier DataWalk export")
        shutil.rmtree(out)  # an earlier export of a report: replace it
    js, css = _viewer_files(bundle)
    data = out / "data"
    (data / "payloads").mkdir(parents=True)
    (data / "previews").mkdir()
    (data / "datasets").mkdir()
    (data / "report.json").write_text(json.dumps(bundle.data["report"]))
    (data / "export.json").write_text(json.dumps(bundle.data["export"]))
    for vid, p in bundle.data["payloads"].items():
        (data / "payloads" / f"{vid}.json").write_text(json.dumps(p))
    for vid, png in bundle.data["previews"].items():
        (data / "previews" / f"{vid}.png").write_bytes(png)
    for did, csv in bundle.data["datasets"].items():
        (data / "datasets" / f"{did}.csv").write_bytes(csv)
    if bundle.data.get("brand_logo"):
        (data / "brand").mkdir()
        (data / "brand" / "logo.png").write_bytes(bundle.data["brand_logo"])
    for rel, src in bundle.assets.items():
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
    (out / "viewer.js").write_text(js)
    (out / "viewer.css").write_text(css)
    title = _title(bundle.data["report"])
    head = (
        f"<title>{_escape(title)}</title>\n"
        '<meta name="datawalk-data" content="static" />\n'
        '<link rel="icon" href="data:," />\n'
        '<link rel="stylesheet" href="viewer.css" />\n'
    )
    (out / "index.html").write_text(
        _page(head, '<script type="module" src="viewer.js"></script>\n', SITE_FALLBACK)
    )
    return out


def _title(report: dict) -> str:
    label = report.get("classification")
    return f"[{label}] {report['name']}" if label else report["name"]


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    )


def _data_url(path: Path) -> str:
    mime = {
        ".ktx2": "image/ktx2",
        ".glb": "model/gltf-binary",
        ".hdr": "application/hdr",
        ".wasm": "application/wasm",
    }.get(path.suffix, mimetypes.guess_type(path.name)[0] or "application/octet-stream")
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def _script_json(value: Any) -> str:
    """JSON that is safe inside a <script> element."""
    return (
        json.dumps(value, separators=(",", ":"))
        .replace("<", "\\u003c")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def _sha(text: str) -> str:
    """CSP source for an inline script."""
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode()).digest()).decode() + "'"


def render_html(bundle: Bundle) -> str:
    """One self-contained, viewer-only HTML page that makes no network requests."""
    js, css = _viewer_files(bundle)
    d = bundle.data
    b64 = lambda raw, mime: f"data:{mime};base64,{base64.b64encode(raw).decode()}"  # noqa: E731
    inline = {
        "report": d["report"],
        "payloads": d["payloads"],
        "previews": {k: b64(v, "image/png") for k, v in d["previews"].items()},
        "datasets": {k: b64(v, "text/csv") for k, v in d["datasets"].items()},
        "export": d["export"],
        "brand_logo": b64(d["brand_logo"], "image/png") if d.get("brand_logo") else None,
    }
    # Scripts (BokehJS) run as inline scripts with CSP hashes; other assets become data URLs.
    scripts = [
        src.read_text() for rel, src in bundle.assets.items() if rel.startswith("vendor/bokeh/")
    ]
    scripts = [s.replace("</script", "<\\/script") for s in scripts]
    assets = {
        rel: _data_url(src)
        for rel, src in bundle.assets.items()
        if not rel.startswith("vendor/bokeh/")
    }
    data_script = (
        f"globalThis.__DATAWALK_DATA__={_script_json(inline)};"
        f"globalThis.__DATAWALK_ASSETS__={_script_json(assets)};"
    )
    js = js.replace("</script", "<\\/script")
    csp = (
        "default-src 'none'; "
        f"script-src {_sha(data_script)} {_sha(js)} {' '.join(map(_sha, scripts))} "
        "'wasm-unsafe-eval' 'unsafe-eval'; "
        "style-src 'unsafe-inline'; img-src data: blob:; font-src data:; "
        "connect-src data: blob:; worker-src blob:; media-src data:; "
        "base-uri 'none'; form-action 'none'"
    )
    e = d["export"]
    head = (
        f'<meta http-equiv="Content-Security-Policy" content="{csp}" />\n'
        f"<title>{_escape(_title(d['report']))}</title>\n"
        f'<meta name="datawalk-export" '
        f'content="revision {e["revision"]}; {e["exported_at"]}; {e["hash"]}" />\n'
        '<link rel="icon" href="data:," />\n'
        f"<style>{css}</style>\n"
    )
    vendor = "".join(f"<script>{s}</script>\n" for s in scripts)
    body = f'<script>{data_script}</script>\n{vendor}<script type="module">{js}</script>\n'
    return _page(head, body)


def write_html(bundle: Bundle, path: Path) -> tuple[Path, int]:
    html = render_html(bundle)
    path = Path(path)
    path.write_text(html, encoding="utf-8")
    return path, len(html.encode())


Paper = Literal["a4", "letter"]


@contextmanager
def headless_page(html: Path, query: str = "", what: str = "This export", **context: Any):
    """The exported HTML file in a headless browser (Chrome, Edge, or Playwright's Chromium).
    Needs Playwright: `datawalk[pdf]`."""
    try:
        from playwright.sync_api import Error, sync_playwright
    except ImportError as e:
        raise ExportError(f"{what} needs Playwright: pip install 'datawalk[pdf]'") from e
    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge", None):
            try:
                browser = p.chromium.launch(channel=channel) if channel else p.chromium.launch()
                break
            except Error:
                continue
        if browser is None:
            raise ExportError(
                f"{what} needs a browser: install Google Chrome, or run "
                "`playwright install chromium`."
            )
        try:
            ctx = browser.new_context(**({"viewport": {"width": 1600, "height": 1000}} | context))
            page = ctx.new_page()
            page.goto(Path(html).resolve().as_uri() + query)
            yield page
            ctx.close()  # writes a recorded video
        finally:
            browser.close()


def write_pdf(html: Path, pdf: Path, paper: Paper = "a4") -> Path:
    """Print the flat view of an exported HTML file."""
    with headless_page(html, "?view=flat", "PDF export") as page:
        page.wait_for_function("window.datawalkFlatReady === true", timeout=120_000)
        page.emulate_media(media="print")
        page.pdf(path=str(pdf), format="A4" if paper == "a4" else "Letter", print_background=True)
    return Path(pdf)


def _ready(page) -> None:
    page.wait_for_function("!!window.datawalk?.getState().report", timeout=120_000)


def chart_images(html: Path, ids: list[str]) -> dict[str, bytes]:
    """PNG images of charts, rendered by the viewer code that draws the walls."""
    if not ids:
        return {}
    out = {}
    with headless_page(html, "?export", "PPTX export of interactive charts") as page:
        _ready(page)
        for vid in ids:
            url = page.evaluate("id => window.datawalkExport.chartPng(id)", vid)
            if url:
                out[vid] = base64.b64decode(url.split(",", 1)[1])
    return out


def write_world(html: Path, path: Path, fmt: Literal["glb", "usdz"]) -> Path:
    """A static 3D snapshot of the rooms and their chart images (GLB or USDZ)."""
    with headless_page(html, "?export", f"{fmt.upper()} export") as page:
        _ready(page)
        data = page.evaluate("f => window.datawalkExport.world(f)", fmt)
    Path(path).write_bytes(base64.b64decode(data))
    return Path(path)


def write_video(
    html: Path,
    path: Path,
    seconds: float = 6.0,
    size: tuple[int, int] = (1920, 1080),
    log: Callable[[str], None] = print,
) -> Path:
    """Record the guided tour (P3): every stop for `seconds` (or its auto-play duration), with
    the camera glides between them. The browser records WebM; ffmpeg makes MP4 when installed."""
    import shutil as sh
    import subprocess
    import tempfile as tf

    tmp = Path(tf.mkdtemp())
    video = {
        "record_video_dir": str(tmp),
        "record_video_size": {"width": size[0], "height": size[1]},
    }
    with headless_page(
        html, "", "Tour video export", viewport={"width": size[0], "height": size[1]}, **video
    ) as page:
        page.add_init_script("localStorage.setItem('datawalk.view', '3d')")
        page.reload()
        _ready(page)
        stops = page.evaluate("window.datawalkTour.tourStops().map(s => s.stop.duration)")
        total = sum(d or seconds for d in stops)
        log(f"Recording the tour: {len(stops)} stops, about {total / 60:.1f} minutes in real time")
        for i, duration in enumerate(stops):
            if i and i % 5 == 0:
                log(f"  stop {i + 1} of {len(stops)}")
            page.evaluate("i => window.datawalkTour.goTo(i)", i)
            page.wait_for_timeout(300)
            page.wait_for_function("window.datawalkTourMoving === false", timeout=60_000)
            page.wait_for_timeout(int(1000 * (duration or seconds)))
        recorded = Path(page.video.path())
    path = Path(path)
    if path.suffix.lower() == ".webm" or not sh.which("ffmpeg"):
        out = path.with_suffix(".webm")
        sh.move(recorded, out)
        return out
    h264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-crf", "20"]
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(recorded), *h264, str(path)], check=True
    )
    return path


from .run import Plan, confirm, fill_previews, plan_export, run_export, target_format  # noqa: E402

__all__ = [
    "ExportError",
    "ExportOptions",
    "Plan",
    "confirm",
    "fill_previews",
    "plan_export",
    "prepare",
    "review",
    "run_export",
    "target_format",
]
