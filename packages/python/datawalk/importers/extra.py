"""KPIs from tables (explicit mapping), MLflow runs, and PDF pages."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..core.models import Provenance
from . import content

if TYPE_CHECKING:
    from ..reports.report import Report

AGGREGATES = {"last", "first", "sum", "mean", "min", "max", "count"}


def _key(text: str) -> str:
    """A key part from a name (MLflow allows spaces in metric and file names)."""
    return re.sub(r"[\s#?%]+", "_", text)


KPI_SETTINGS = {
    "label", "column", "agg", "row", "unit", "fmt",
    "delta_agg", "delta_row", "delta_fmt", "higher_is_better",
}  # fmt: skip


def _numeric(column: Any) -> bool:
    from pandas.api.types import is_bool_dtype, is_numeric_dtype

    return is_numeric_dtype(column) and not is_bool_dtype(column)


def _reduce(column: Any, key: str, agg: str | None, row: int | None) -> Any:
    if row is not None:
        if not -len(column) <= row < len(column):
            raise ValueError(f"KPI {key!r}: row {row} does not exist ({len(column)} rows)")
        return column.iloc[row]
    agg = agg or "last"
    if agg not in AGGREGATES:
        raise ValueError(f"KPI {key!r}: aggregate must be one of {sorted(AGGREGATES)}")
    if agg not in ("last", "first", "count") and not _numeric(column):
        raise ValueError(f"KPI {key!r}: {agg!r} needs numbers; column {column.name!r} has text")
    values = column.dropna()
    if agg in ("last", "first"):
        return values.iloc[-1 if agg == "last" else 0]
    return getattr(values, agg)()


def kpis_from_table(
    report: Report,
    source: Any,
    mapping: dict[str, dict[str, Any]],
    room: str | None,
    update: bool = False,
) -> list:
    """mapping: {key: {"label", "column", "agg" (default "last") or "row", "unit", "fmt",
    "delta_agg" or "delta_row", "delta_fmt", "higher_is_better"}}. Nothing is guessed: every
    KPI names its column and how to reduce it."""
    from .adapters import read_table

    provenance = None
    if isinstance(source, str | Path):
        path = Path(source)
        provenance = Provenance(
            kind="file", path=str(path), sha256=hashlib.sha256(path.read_bytes()).hexdigest()
        )
        source = read_table(path)
    out = []
    for key, m in mapping.items():
        if unknown := set(m) - KPI_SETTINGS:
            raise ValueError(
                f"KPI {key!r}: unknown setting {', '.join(sorted(unknown))}. "
                f"Use: {', '.join(sorted(KPI_SETTINGS))}."
            )
        if "column" not in m:
            raise ValueError(f"KPI {key!r}: give its column")
        column = m["column"]
        if column not in source.columns:
            raise ValueError(f"KPI {key!r}: no column {column!r} (columns: {list(source.columns)})")
        value = _reduce(source[column], key, m.get("agg"), m.get("row"))
        delta = None
        if "delta_agg" in m or "delta_row" in m:
            base = _reduce(source[column], key, m.get("delta_agg"), m.get("delta_row"))
            delta = float(value) - float(base)
        value = value.item() if hasattr(value, "item") else value
        viz = report.add_kpi(
            key,
            m.get("label", column),
            value,
            unit=m.get("unit", ""),
            fmt=m.get("fmt"),
            delta=delta,
            delta_fmt=m.get("delta_fmt"),
            higher_is_better=m.get("higher_is_better", True),
            room=room,
            update=update,
        )
        viz.source.provenance = provenance
        out.append(viz)
    return out


# -- MLflow ---------------------------------------------------------------------------


def _read_run_dir(run: Path) -> tuple[str, dict[str, list[tuple[int, float]]], dict[str, str]]:
    """An MLflow file-store run directory: mlruns/<experiment>/<run>/."""
    meta = (run / "meta.yaml").read_text(encoding="utf-8") if (run / "meta.yaml").exists() else ""
    name = re.search(r"^run_name:\s*(.+)$", meta, re.M)
    metrics: dict[str, list[tuple[int, float]]] = {}
    for f in sorted((run / "metrics").rglob("*")) if (run / "metrics").exists() else []:
        if f.is_file():
            rows = [
                line.split() for line in f.read_text(encoding="utf-8").splitlines() if line.strip()
            ]
            metrics[str(f.relative_to(run / "metrics"))] = [
                (int(r[2]) if len(r) > 2 else i, float(r[1])) for i, r in enumerate(rows)
            ]
    params = {}
    for f in sorted((run / "params").rglob("*")) if (run / "params").exists() else []:
        if f.is_file():
            params[str(f.relative_to(run / "params"))] = f.read_text(encoding="utf-8").strip()
    return (name.group(1).strip() if name else run.name), metrics, params


def _read_run_client(run_id: str, tracking_uri: str | None):
    from mlflow.tracking import MlflowClient

    client = MlflowClient(tracking_uri=tracking_uri)
    run = client.get_run(run_id)
    metrics = {
        k: [(m.step, m.value) for m in client.get_metric_history(run_id, k)]
        for k in run.data.metrics
    }
    artifacts = Path(client.download_artifacts(run_id, ""))
    return run.info.run_name or run_id, metrics, dict(run.data.params), artifacts


def add_mlflow_run(
    report: Report, run: str | Path, room: str | None, tracking_uri: str | None = None
) -> list:
    """Metrics become KPIs (last value; change since the first step), logged figures become
    charts, parameters become a table. `run`: a run directory of an MLflow file store, or a
    run id (needs the mlflow package)."""
    import pandas as pd

    path = Path(run)
    if path.is_dir():
        name, metrics, params = _read_run_dir(path)
        artifacts = path / "artifacts"
        where = str(path)
    else:
        name, metrics, params, artifacts = _read_run_client(str(run), tracking_uri)
        where = f"mlflow run {run}"
    room = room or name
    slug = re.sub(r"\W+", "_", name).strip("_").lower() or "run"
    prov = Provenance(kind="mlflow", path=where)
    added = []
    for metric, history in sorted(metrics.items()):
        history.sort()
        last = history[-1][1]
        delta = last - history[0][1] if len(history) > 1 else None
        viz = report.add_kpi(
            f"{slug}.{_key(metric)}", metric, last, fmt=".4g", delta=delta, delta_fmt="+.4g",
            room=room, update=True,
        )  # fmt: skip
        viz.source.provenance = prov
        added.append(viz)
    if params:
        df = pd.DataFrame({"parameter": list(params), "value": list(params.values())})
        df.attrs["title"] = f"Parameters of {name}"
        viz = report.add(df, key=f"{slug}.params", room=room, update=True)
        viz.source.provenance = prov
        added.append(viz)
    from .adapters import FileAdapter

    files = FileAdapter()
    for f in sorted(artifacts.rglob("*")) if artifacts.exists() else []:
        if f.is_file() and files.supports(f) and f.suffix.lower() not in (".csv", ".tsv", ".md"):
            rel = str(f.relative_to(artifacts))
            try:
                imported = files.import_(f)
            except ValueError:
                continue  # JSON that is not a chart
            imported.source.provenance = Provenance(kind="mlflow", path=f"{where}/artifacts/{rel}")
            key = f"{slug}.artifact.{_key(rel)}"
            added.append(report._register(key, imported, None, room, None))
    return added


# -- PDF pages --------------------------------------------------------------------------


def add_pdf(
    report: Report, path: str | Path, pages: list[int] | None, key: str | None, room: str | None,
    update: bool = False, dpi: int = 150,
) -> list:  # fmt: skip
    """PDF pages as static charts (for example Power BI or Tableau PDF exports). Needs
    pypdfium2: the `pdf-import` extra."""
    try:
        import pypdfium2 as pdfium
    except ImportError as e:
        from ..hints import install

        raise ImportError(f"PDF pages need pypdfium2: {install('datawalk[pdf-import]')}") from e
    import io

    path = Path(path)
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    doc = pdfium.PdfDocument(data)
    numbers = pages or list(range(1, len(doc) + 1))
    if bad := [n for n in numbers if not 1 <= n <= len(doc)]:
        raise ValueError(f"{path}: no page {bad[0]}. Pages count from 1 to {len(doc)}.")
    base = key or re.sub(r"\W+", "_", path.stem).lower()
    if not update and (taken := [n for n in numbers if report.get(f"{base}.page{n}")]):
        raise ValueError(
            f"Duplicate key {base}.page{taken[0]!r}. Pass update=True to replace the pages."
        )
    added = []
    for n in numbers:
        image = doc[n - 1].render(scale=dpi / 72).to_pil()
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        imported = content.png(buf.getvalue(), library="pdf")
        imported.source.title = f"{path.stem} – page {n}"
        imported.source.provenance = Provenance(kind="file", path=f"{path}#page={n}", sha256=digest)
        added.append(report._register(f"{base}.page{n}", imported, None, room, None))
    return added
