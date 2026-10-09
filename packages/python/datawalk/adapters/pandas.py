from __future__ import annotations

import sys
from typing import Any

from ..core.models import Source
from .base import Adapter
from .matplotlib import _values

MAX_ROWS = 10_000


class PandasAdapter(Adapter):
    name = "pandas"
    summary = f"pandas DataFrame as a table. Exact values; at most {MAX_ROWS:,} rows are kept."

    def supports(self, obj: Any) -> bool:
        if "pandas" not in sys.modules:
            return False
        import pandas as pd

        return isinstance(obj, pd.DataFrame)

    def extract_metadata(self, df: Any) -> Source:
        limitations = []
        if len(df) > MAX_ROWS:
            limitations.append(f"Only the first {MAX_ROWS:,} of {len(df):,} rows are included.")
        title = df.attrs.get("title")
        return Source(
            library=self.name,
            chart_type="table",
            title=str(title) if title else None,
            aspect=1.4,
            limitations=limitations,
        )

    def serialize(self, df: Any) -> dict[str, Any]:
        import pandas as pd

        head = df.head(MAX_ROWS)
        # A meaningful index (anything but 0..n-1) is data: keep it as the first column.
        if not isinstance(head.index, pd.RangeIndex) or head.index.start != 0:
            head = head.reset_index()
        columns = [
            " / ".join(map(str, c)) if isinstance(c, tuple) else str(c) for c in head.columns
        ]

        def missing(v: Any) -> bool:
            try:
                return bool(pd.isna(v))
            except (TypeError, ValueError):  # list-like cell
                return False

        cols = []
        for _, col in head.items():
            if col.dtype.kind == "b":
                cols.append([None if missing(v) else bool(v) for v in col])
            elif col.dtype.kind in "iufM":
                cols.append(_values(col.to_numpy()))
            else:
                cols.append([None if missing(v) else str(v) for v in col])
        rows = [list(r) for r in zip(*cols, strict=True)] if cols else []
        return {"kind": "table", "columns": columns, "rows": rows, "total_rows": len(df)}

    def render_preview(self, df: Any) -> None:
        return None  # The viewer draws the table.
