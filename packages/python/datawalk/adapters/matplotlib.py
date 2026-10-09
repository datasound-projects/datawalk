from __future__ import annotations

import io
import math
import sys
from typing import Any

from ..core.models import AxesInfo, Axis, Source
from .base import Adapter

MAX_POINTS = 100_000  # per series; larger series stay image-only


def _values(arr: Any) -> list[float | str | None] | None:
    """Convert artist data to JSON values. Return None for unsupported data types."""
    import numpy as np

    a = np.asarray(arr)
    if a.ndim != 1:
        return None
    if a.dtype.kind in "iub":
        return a.astype(float).tolist()
    if a.dtype.kind == "f":
        return [None if math.isnan(v) else v for v in a.tolist()]
    if a.dtype.kind == "M":
        return [None if s == "NaT" else s for s in np.datetime_as_string(a).tolist()]
    if a.dtype.kind in "UO":
        return [None if v is None else str(v) for v in a.tolist()]
    return None


def _converter(axis: Any) -> Any:
    get = getattr(axis, "get_converter", None)  # Matplotlib >= 3.10
    return get() if get else axis.converter


def _date_axis(axis: Any) -> bool:
    return type(_converter(axis)).__module__ == "matplotlib.dates"


class MatplotlibAdapter(Adapter):
    name = "matplotlib"
    summary = (
        "Figure, SubFigure and Axes objects. Mode B: PNG preview plus extracted line and "
        "scatter data; other artists are image-only."
    )

    def supports(self, obj: Any) -> bool:
        if "matplotlib" not in sys.modules:
            return False
        from matplotlib.axes import Axes
        from matplotlib.figure import FigureBase

        return isinstance(obj, FigureBase | Axes)

    @staticmethod
    def figure(obj: Any) -> Any:
        from matplotlib.figure import Figure

        fig = obj
        while not isinstance(fig, Figure):
            fig = fig.figure
        return fig

    @staticmethod
    def _axes(fig: Any) -> list[Any]:
        # A colorbar is an Axes too, but it holds no data.
        return [ax for ax in fig.axes if ax.get_visible() and ax.get_label() != "<colorbar>"]

    def extract_metadata(self, obj: Any) -> Source:
        fig = self.figure(obj)
        axes = self._axes(fig)
        infos = []
        for ax in axes:
            legend = ax.get_legend()
            infos.append(
                AxesInfo(
                    title=ax.get_title(),
                    x=Axis(label=ax.get_xlabel(), scale=ax.get_xscale()),
                    y=Axis(label=ax.get_ylabel(), scale=ax.get_yscale()),
                    z=Axis(label=ax.get_zlabel(), scale=ax.get_zscale())
                    if ax.name == "3d"
                    else None,
                    legend=[t.get_text() for t in legend.get_texts()] if legend else [],
                )
            )
        suptitle = fig.get_suptitle() if hasattr(fig, "get_suptitle") else ""
        # One titled axes (colorbars have no title) names the figure.
        titles = [i.title for i in infos if i.title]
        title = suptitle or (titles[0] if len(titles) == 1 else "")
        w, h = fig.get_size_inches()
        return Source(
            library=self.name,
            chart_type=self._chart_type(axes),
            title=title or None,
            axes=infos,
            aspect=float(w / h),
            limitations=self._scan(fig)[1],
        )

    @staticmethod
    def _chart_type(axes: list[Any]) -> str:
        from matplotlib.collections import PathCollection, QuadMesh
        from matplotlib.container import BarContainer

        if not axes:
            return "figure"
        ax = axes[0]
        if ax.name == "3d":
            return "scatter3d" if ax.collections else "surface"
        if ax.images or any(isinstance(c, QuadMesh) for c in ax.collections):
            return "heatmap"
        if any(isinstance(c, BarContainer) for c in ax.containers):
            return "bar"
        if any(isinstance(c, PathCollection) for c in ax.collections):
            return "scatter"
        if ax.get_lines():
            return "line"
        return "figure"

    def serialize(self, obj: Any) -> dict[str, Any] | None:
        series = self._scan(self.figure(obj))[0]
        return {"kind": "series", "series": series} if series else None

    def _scan(self, fig: Any) -> tuple[list[dict[str, Any]], list[str]]:
        """Extract line and scatter data; describe everything that stays image-only."""
        from matplotlib import dates
        from matplotlib.collections import LineCollection, PathCollection, PolyCollection, QuadMesh
        from matplotlib.container import BarContainer

        series: list[dict[str, Any]] = []
        skipped: dict[str, list[int]] = {}  # what stays image-only -> axes numbers
        for i, ax in enumerate(self._axes(fig)):

            def skip(what: str, i: int = i) -> None:
                skipped.setdefault(what, []).append(i + 1)

            if ax.name != "rectilinear":
                skip(f"all data on {ax.name} axes")
                continue
            if any(isinstance(c, BarContainer) for c in ax.containers):
                skip("bar values")
            if ax.images or any(isinstance(c, QuadMesh) for c in ax.collections):
                skip("image or heatmap cells")
            if any(isinstance(c, PolyCollection) for c in ax.collections):
                skip("filled areas")
            if any(isinstance(c, LineCollection) for c in ax.collections):
                skip("line collections")
            n = 0
            for line in ax.get_lines():
                # Reference lines (axhline etc.) are not in data coordinates.
                if line.get_transform() is not ax.transData:
                    continue
                x = _values(line.get_xdata(orig=True))
                y = _values(line.get_ydata(orig=True))
                if x is None or y is None or len(x) != len(y) or not x:
                    continue
                if len(x) > MAX_POINTS:
                    skip(f"lines over {MAX_POINTS} points")
                    continue
                n += 1
                series.append(self._series(i, line.get_label(), n, "line", x, y))
            for coll in ax.collections:
                if not isinstance(coll, PathCollection):
                    continue
                if coll.get_offset_transform() is not ax.transData:
                    continue
                offsets = coll.get_offsets()
                if not 0 < len(offsets) <= MAX_POINTS:
                    if len(offsets):
                        skip(f"scatters over {MAX_POINTS} points")
                    continue
                cols = []
                for axis, col in ((ax.xaxis, offsets[:, 0]), (ax.yaxis, offsets[:, 1])):
                    if _date_axis(axis):
                        cols.append([dates.num2date(v).isoformat() for v in col])
                    elif _converter(axis) is None:
                        cols.append(_values(col))
                    else:
                        cols.append(None)  # categorical or unit axis: positions are not values
                if None in cols:
                    skip("scatters on categorical axes")
                    continue
                n += 1
                series.append(self._series(i, coll.get_label(), n, "scatter", *cols))
        if not skipped:
            return series, []
        parts = [f"{what} (axes {', '.join(map(str, nums))})" for what, nums in skipped.items()]
        return series, ["Not extracted, see the preview image: " + "; ".join(parts) + "."]

    @staticmethod
    def _series(axes: int, label: str, n: int, kind: str, x: list, y: list) -> dict[str, Any]:
        name = label if label and not label.startswith("_") else f"Series {n}"
        return {"axes": axes, "name": name, "kind": kind, "x": x, "y": y}

    def render_preview(self, obj: Any) -> bytes:
        fig = self.figure(obj)
        width_in = fig.get_size_inches()[0]
        buf = io.BytesIO()
        # Target ~1800 px wide so wall displays stay readable up close.
        fig.savefig(buf, format="png", dpi=max(100, min(300, 1800 / width_in)))
        return buf.getvalue()
