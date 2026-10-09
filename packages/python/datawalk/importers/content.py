"""Converters from stored content (notebook outputs, files) to visualization records.
They read data only: nothing here executes code."""

from __future__ import annotations

import io
import math
import struct
from html.parser import HTMLParser
from typing import Any

from ..adapters.base import Imported
from ..adapters.plotly import metadata_from_json
from ..core.models import AxesInfo, Axis, Source
from .svg import sanitize

MAX_ROWS = 10_000


def _imported(source: Source, payload: dict | None, preview: bytes | None) -> Imported:
    if payload is None or payload["kind"] == "svg":
        mode = "static"
    elif payload["kind"] in ("plotly", "vegalite", "bokeh"):
        mode = "interactive"
    else:
        mode = "structured"
    source = source.model_copy(
        update={
            "mode": mode,
            "has_payload": payload is not None,
            "has_preview": preview is not None,
        }
    )
    return Imported(source, payload, preview)


def plotly_figure(figure: dict[str, Any]) -> Imported:
    return _imported(metadata_from_json(figure), {"kind": "plotly", "figure": figure}, None)


def _vl_title(spec: dict[str, Any]) -> str | None:
    t = spec.get("title")
    if isinstance(t, dict):
        t = t.get("text")
    if isinstance(t, list):
        t = " ".join(map(str, t))
    return str(t) if t else None


def _vl_axis(encoding: dict[str, Any], channel: str) -> Axis:
    e = encoding.get(channel)
    if not isinstance(e, dict):
        return Axis()
    axis = e.get("axis") if isinstance(e.get("axis"), dict) else {}
    label = e.get("title") or axis.get("title") or e.get("field") or e.get("aggregate") or ""
    scale = (e.get("scale") or {}).get("type") or {"temporal": "time"}.get(e.get("type"), "linear")
    return Axis(label=str(label), scale=str(scale))


def vegalite(spec: dict[str, Any]) -> Imported:
    """A Vega-Lite specification (Altair charts, notebook outputs). Interactive in the viewer."""
    mark = spec.get("mark")
    chart_type = (mark.get("type") if isinstance(mark, dict) else mark) or next(
        (k for k in ("layer", "hconcat", "vconcat", "concat", "facet", "repeat") if k in spec),
        "chart",
    )
    enc = spec.get("encoding") or {}
    axes = [AxesInfo(x=_vl_axis(enc, "x"), y=_vl_axis(enc, "y"))] if enc else []
    width, height = spec.get("width"), spec.get("height")
    numeric = isinstance(width, int | float) and isinstance(height, int | float) and height > 0
    limitations = []

    def urls(node: Any) -> bool:
        if isinstance(node, dict):
            return (
                isinstance(node.get("data"), dict)
                and "url" in node["data"]
                or any(urls(v) for v in node.values())
            )
        return isinstance(node, list) and any(urls(v) for v in node)

    if urls(spec):
        limitations.append(
            "The chart loads its data from a URL. The viewer loads no external data, so the "
            "chart can be empty. Embed the data in the specification (Altair: "
            "alt.data_transformers.enable('default'))."
        )
    source = Source(
        library="vega-lite",
        chart_type=str(chart_type),
        title=_vl_title(spec),
        axes=axes,
        aspect=width / height if numeric else 1.5,
        limitations=limitations,
    )
    return _imported(source, {"kind": "vegalite", "spec": spec}, None)


def svg(text: str) -> Imported:
    clean, aspect = sanitize(text)
    source = Source(library="svg", chart_type="image", aspect=aspect)
    return _imported(source, {"kind": "svg", "svg": clean}, None)


def png_size(data: bytes) -> tuple[int, int]:
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("not a PNG image")
    return struct.unpack(">II", data[16:24])


def png(data: bytes, library: str = "image") -> Imported:
    w, h = png_size(data)
    source = Source(library=library, chart_type="image", aspect=w / h if h else 1.5)
    return _imported(source, None, data)


def to_png(data: bytes) -> bytes:
    """PNG bytes of a JPEG (or other raster) image. Needs Pillow (installed with Matplotlib)."""
    if data.startswith(b"\x89PNG"):
        return data
    try:
        from PIL import Image
    except ImportError as e:
        raise ImportError("JPEG images need Pillow: pip install pillow") from e
    out = io.BytesIO()
    with Image.open(io.BytesIO(data)) as img:
        img.save(out, format="PNG")
    return out.getvalue()


def _cell(v: Any) -> float | str | bool | None:
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, int | float):
        return v if math.isfinite(v) else None
    s = str(v).strip()
    if s in ("", "NaN", "nan", "None", "NaT", "<NA>"):
        return None
    try:
        x = float(s.replace(",", ""))
    except ValueError:
        return s
    return x if math.isfinite(x) else s


def table(columns: list[str], rows: list[list[Any]], title: str | None = None) -> Imported:
    limitations = []
    if len(rows) > MAX_ROWS:
        limitations.append(f"Only the first {MAX_ROWS:,} of {len(rows):,} rows are included.")
    payload = {
        "kind": "table",
        "columns": [str(c) for c in columns],
        "rows": [[_cell(v) for v in r] for r in rows[:MAX_ROWS]],
        "total_rows": len(rows),
    }
    source = Source(
        library="table", chart_type="table", title=title, aspect=1.4, limitations=limitations
    )
    return _imported(source, payload, None)


def dataresource(obj: dict[str, Any]) -> Imported:
    """application/vnd.dataresource+json (pandas table schema output)."""
    fields = [f["name"] for f in obj.get("schema", {}).get("fields", [])]
    rows = [[r.get(f) for f in fields] for r in obj.get("data", [])]
    return table(fields, rows)


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self.header_rows: list[int] = []
        self.row: list[str] | None = None
        self.cell: list[str] | None = None
        self.in_head = False

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag == "table":
            self.tables.append([])
            self.header_rows.append(0)
        elif tag == "thead":
            self.in_head = True
        elif tag == "tr" and self.tables:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.tables[-1].append(self.row)
            if self.in_head:
                self.header_rows[-1] += 1
            self.row = None
        elif tag == "thead":
            self.in_head = False

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell.append(data)


def html_table(html: str) -> Imported | None:
    """A pandas DataFrame's HTML output (class "dataframe"). Other HTML is not imported."""
    if "dataframe" not in html or "<table" not in html:
        return None
    p = _TableParser()
    p.feed(html)
    if not p.tables or not p.tables[0]:
        return None
    rows, n_head = p.tables[0], max(p.header_rows[0], 1)
    head = rows[:n_head]
    # pandas writes the index name on a second header row: join the header rows per column.
    width = max(len(r) for r in rows)
    columns = [
        " / ".join(h[i] for h in head if i < len(h) and h[i])
        or ("index" if i == 0 else f"column {i}")
        for i in range(width)
    ]
    body = [r + [""] * (width - len(r)) for r in rows[n_head:]]
    return table(columns, body)


def markdown(text: str, title: str | None = None) -> Imported:
    lines = len(text.splitlines()) or 1
    source = Source(
        library="markdown",
        chart_type="text",
        title=title,
        aspect=max(1.0, min(2.2, 2.2 - 0.05 * lines)),
    )
    return _imported(source, {"kind": "text", "markdown": text, "links": []}, None)
