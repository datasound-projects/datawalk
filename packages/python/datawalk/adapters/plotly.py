from __future__ import annotations

import json
import re
import sys
from typing import Any

from ..core.models import AxesInfo, Axis, Source
from ..core.naming import strip_markup
from .base import Adapter


def _axis(d: dict[str, Any] | None) -> Axis:
    d = d or {}
    title = d.get("title") or {}
    text = title.get("text", "") if isinstance(title, dict) else str(title)
    # Plotly picks the axis type from the data when "type" is unset.
    return Axis(label=strip_markup(text or ""), scale=d.get("type") or "auto")


def _suffix_order(key: str) -> int:
    digits = re.sub(r"\D", "", key)
    return int(digits) if digits else 1


def _chart_type(data: list[dict[str, Any]]) -> str:
    if not data:
        return "figure"
    trace = data[0]
    kind = trace.get("type", "scatter")
    if kind in ("scatter", "scattergl"):
        return "line" if "lines" in (trace.get("mode") or "lines") else "scatter"
    return kind


def metadata_from_json(figure: dict[str, Any], library: str = "plotly") -> Source:
    """Title, axes, legend, chart type and aspect of a Plotly figure in JSON form (as Plotly.py
    writes it, and as notebooks store application/vnd.plotly.v1+json)."""
    layout = figure.get("layout") or {}
    data = figure.get("data") or []
    # Map each trace to its subplot key ("xaxis2", "scene", ...).
    trace_keys = []
    for t in data:
        if t.get("type", "scatter") in ("scatter3d", "surface", "mesh3d", "cone", "streamtube"):
            trace_keys.append(t.get("scene") or "scene")
        elif "xaxis" in t or t.get("type", "scatter") in (
            "scatter",
            "scattergl",
            "bar",
            "histogram",
            "box",
            "violin",
            "heatmap",
            "contour",
        ):
            trace_keys.append("xaxis" + (t.get("xaxis") or "x")[1:])
        else:
            trace_keys.append(None)
    keys = {k for k in layout if re.fullmatch(r"xaxis\d*|scene\d*", k)}
    keys |= {k for k in trace_keys if k}
    axes = {}
    for key in sorted(keys, key=lambda k: (k.startswith("scene"), _suffix_order(k))):
        d = layout.get(key) or {}
        if key.startswith("scene"):
            axes[key] = AxesInfo(
                x=_axis(d.get("xaxis")), y=_axis(d.get("yaxis")), z=_axis(d.get("zaxis"))
            )
        else:
            axes[key] = AxesInfo(x=_axis(d), y=_axis(layout.get("y" + key[1:])))
    for t, key in zip(data, trace_keys, strict=True):
        if key and t.get("name") and t.get("showlegend") is not False:
            axes[key].legend.append(t["name"])
    title = layout.get("title") or {}
    text = title.get("text") if isinstance(title, dict) else str(title)
    return Source(
        library=library,
        chart_type=_chart_type(data),
        title=strip_markup(text or "") or None,
        axes=list(axes.values()),
        aspect=(layout.get("width") or 700) / (layout.get("height") or 450),
    )


class PlotlyAdapter(Adapter):
    name = "plotly"
    summary = "plotly.graph_objects.Figure (incl. Plotly Express). Mode A: full interactive figure."

    def supports(self, obj: Any) -> bool:
        if "plotly" not in sys.modules:
            return False
        from plotly.basedatatypes import BaseFigure

        return isinstance(obj, BaseFigure)

    def extract_metadata(self, fig: Any) -> Source:
        return metadata_from_json(json.loads(fig.to_json()), self.name)

    def serialize(self, fig: Any) -> dict[str, Any]:
        # to_json applies Plotly's own encoder (numpy arrays, dates, typed-array base64).
        return {"kind": "plotly", "figure": json.loads(fig.to_json())}

    def render_preview(self, fig: Any) -> None:
        return None  # The viewer renders previews with Plotly.js; Kaleido is not required.
