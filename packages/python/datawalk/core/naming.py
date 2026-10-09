"""Default visualization names: original title, then axes, then a numbered fallback."""

from __future__ import annotations

import re
from collections.abc import Collection

from .models import Source

FALLBACK_LABELS = {
    "line": "Line Chart",
    "scatter": "Scatter Plot",
    "scatter3d": "3D Scatter Plot",
    "bar": "Bar Chart",
    "histogram": "Histogram",
    "heatmap": "Heatmap",
    "surface": "Surface Plot",
    "table": "Table",
    "kpi": "KPI",
}


def strip_markup(text: str) -> str:
    return " ".join(re.sub(r"<[^>]*>", " ", text).split())


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def default_name(source: Source, taken: Collection[str] = ()) -> str:
    if source.title and source.title.strip():
        return source.title.strip()
    for ax in source.axes:
        if ax.x.label and ax.y.label:
            return f"{_cap(ax.y.label)} vs {_cap(ax.x.label)}"
    label = FALLBACK_LABELS.get(source.chart_type, "Figure")
    n = 1
    while f"{label} {n:02d}" in taken:
        n += 1
    return f"{label} {n:02d}"
