"""Tier 1 adapters: Altair charts, pandas Styler, and files given as pathlib.Path
(images, CSV and Excel tables, Markdown, Plotly or Vega-Lite JSON)."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from ..adapters.base import Adapter, Imported
from ..core.models import AxesInfo, Axis, Provenance, Source, bokeh_without_code
from . import content

IMAGES = {".png", ".jpg", ".jpeg", ".svg"}
TABLES = {".csv", ".tsv", ".xlsx", ".xls"}


class _Direct(Adapter):
    """An adapter that builds the whole record at once (content converters)."""

    def extract_metadata(self, obj: Any) -> Source:
        return self.import_(obj).source

    def serialize(self, obj: Any) -> dict[str, Any] | None:
        return self.import_(obj).payload

    def render_preview(self, obj: Any) -> bytes | None:
        return self.import_(obj).preview_png


class AltairAdapter(_Direct):
    name = "altair"
    summary = "Altair / Vega-Lite chart. Mode A: interactive with Vega (data must be inline)."

    def supports(self, obj: Any) -> bool:
        return (
            "altair" in sys.modules
            and type(obj).__module__.startswith("altair")
            and hasattr(obj, "to_dict")
        )

    def import_(self, chart: Any) -> Imported:
        return content.vegalite(chart.to_dict())


class BokehAdapter(_Direct):
    name = "bokeh"
    summary = (
        "Bokeh plot or layout (json_item). Mode A: interactive with BokehJS of the same version."
    )

    def supports(self, obj: Any) -> bool:
        if "bokeh" not in sys.modules:
            return False
        from bokeh.model import Model

        return isinstance(obj, Model) and hasattr(obj, "width")

    def import_(self, obj: Any) -> Imported:
        import bokeh
        from bokeh.embed import json_item

        title = getattr(getattr(obj, "title", None), "text", None)
        glyphs = [
            r.glyph.__class__.__name__.lower()
            for r in getattr(obj, "renderers", [])
            if hasattr(r, "glyph")
        ]
        axes = []
        if hasattr(obj, "xaxis") and hasattr(obj, "yaxis"):
            label = lambda ax: ax[0].axis_label if ax and ax[0].axis_label else ""  # noqa: E731
            axes = [
                AxesInfo(x=Axis(label=str(label(obj.xaxis))), y=Axis(label=str(label(obj.yaxis))))
            ]
        width, height = getattr(obj, "width", None), getattr(obj, "height", None)
        source = Source(
            library="bokeh",
            chart_type=glyphs[0] if glyphs else "figure",
            title=title or None,
            axes=axes,
            aspect=width / height if width and height else 1.5,
            limitations=[
                f"Rendered with BokehJS {bokeh.__version__}: serving or exporting this report "
                f"needs bokeh=={bokeh.__version__} installed."
            ],
        )
        item = json_item(obj)
        if bokeh_without_code(item):
            source.limitations.append(
                "JavaScript callbacks (CustomJS) were removed: they do not run in DataWalk."
            )
        payload = {"kind": "bokeh", "item": item, "version": bokeh.__version__}
        return content._imported(source, payload, None)


class StylerAdapter(_Direct):
    name = "pandas-styler"
    summary = "pandas Styler as a table. Exact values; colors and formats are not kept."

    def supports(self, obj: Any) -> bool:
        return "pandas" in sys.modules and type(obj).__name__ == "Styler" and hasattr(obj, "data")

    def import_(self, styler: Any) -> Imported:
        from ..adapters.pandas import PandasAdapter

        df = styler.data
        caption = getattr(styler, "caption", None)
        imported = PandasAdapter().import_(df)
        imported.source.title = str(caption) if caption else imported.source.title
        imported.source.limitations.append("The Styler's colors and number formats are not kept.")
        return imported


class FileAdapter(_Direct):
    name = "file"
    summary = (
        "pathlib.Path to PNG, JPEG, SVG (sanitized), CSV, TSV, Excel, Markdown, "
        "or Plotly / Vega-Lite JSON."
    )

    def supports(self, obj: Any) -> bool:
        return isinstance(obj, Path) and obj.suffix.lower() in IMAGES | TABLES | {".md", ".json"}

    def import_(self, path: Path) -> Imported:
        data = path.read_bytes()
        suffix = path.suffix.lower()
        if suffix == ".svg":
            imported = content.svg(data.decode("utf-8"))
        elif suffix in IMAGES:
            imported = content.png(content.to_png(data))
        elif suffix in TABLES:
            imported = _table_file(path)
        elif suffix == ".md":
            imported = content.markdown(data.decode("utf-8").strip())
        else:
            imported = _json_file(path, data)
        imported.source.provenance = Provenance(
            kind="file", path=str(path), sha256=hashlib.sha256(data).hexdigest()
        )
        if not imported.source.title and suffix in IMAGES | {".md"}:
            imported.source.title = (
                path.stem.replace("_", " ").replace("-", " ").strip().capitalize()
            )
        return imported


def read_table(path: Path) -> Any:
    import pandas as pd

    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xls"):
        return pd.read_excel(path)  # needs openpyxl (xlsx) or xlrd (xls)
    return pd.read_csv(path, sep="\t" if suffix == ".tsv" else ",")


def _table_file(path: Path) -> Imported:
    from ..adapters.pandas import PandasAdapter

    df = read_table(path)
    df.attrs["title"] = path.stem.replace("_", " ").capitalize()
    return PandasAdapter().import_(df)


def _json_file(path: Path, data: bytes) -> Imported:
    doc = json.loads(data)
    # R and other tools write Plotly figures ({data, layout}) or Vega-Lite specs ($schema).
    if isinstance(doc, dict) and "vega-lite" in str(doc.get("$schema", "")):
        return content.vegalite(doc)
    if (
        isinstance(doc, dict)
        and isinstance(doc.get("data"), list)
        and ("layout" in doc or doc["data"])
    ):
        return content.plotly_figure({"data": doc["data"], "layout": doc.get("layout") or {}})
    raise ValueError(f"{path}: not a Plotly figure or a Vega-Lite specification")
