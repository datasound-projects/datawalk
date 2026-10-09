"""Jupyter notebook importer. Reads the stored outputs; executes nothing unless asked.

    H1 heading                  report name (unless given)
    H2 heading                  room
    H3 heading                  dashboard group (when it holds two or more outputs)
    Markdown before an output   description of that output
    Plotly / Vega-Lite output   interactive chart (mode A)
    PNG, JPEG, SVG output       static chart (mode C); SVG is sanitized
    pandas HTML, dataresource   table
    cell metadata "datawalk"   {key, room, name, skip, kpi, text}

Keys are "<cell id>-<output index>", so a rerun of the same notebook updates the same
visualizations, and editor changes stay (Report.save merges by key).
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..adapters.base import Imported
from ..core.models import Provenance
from . import content

if TYPE_CHECKING:
    from ..reports.report import Report

DEFAULT_ROOM = "Notebook"
VEGALITE = re.compile(r"application/vnd\.vegalite\.v[3-6]\+json")
HEADING = re.compile(r"^(#{1,3})\s+(.*?)\s*#*\s*$")


class NotebookError(ValueError):
    pass


def _text(src: str | list[str]) -> str:
    return "".join(src) if isinstance(src, list) else src


def read(path: Path) -> dict[str, Any]:
    try:
        nb = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise NotebookError(f"{path}: not a readable notebook ({e})") from None
    if nb.get("nbformat") != 4:
        raise NotebookError(
            f"{path}: notebook format {nb.get('nbformat')} is not supported. "
            "Convert it: jupyter nbconvert --to notebook --nbformat 4"
        )
    return nb


def execute(path: Path, timeout: int) -> Path:
    """Run the notebook in a separate process (nbclient) and return the executed copy."""
    out = Path(tempfile.mkdtemp()) / path.name
    cmd = [sys.executable, "-m", "datawalk.importers.execute", str(path), str(out), str(timeout)]
    try:
        subprocess.run(cmd, check=True, timeout=timeout + 60, capture_output=True, text=True)
    except subprocess.TimeoutExpired:
        raise NotebookError(f"Execution took longer than {timeout} s and was stopped.") from None
    except subprocess.CalledProcessError as e:
        plain = re.sub(r"\x1b\[[0-9;]*m", "", e.stderr).strip()  # no terminal colors
        raise NotebookError(f"Execution failed:\n{plain[-2000:]}") from None
    return out


def output_content(output: dict[str, Any]) -> Imported | None:
    """The richest supported representation of one output."""
    if output.get("output_type") not in ("display_data", "execute_result"):
        return None
    data = output.get("data", {})
    if "application/vnd.plotly.v1+json" in data:
        return content.plotly_figure(data["application/vnd.plotly.v1+json"])
    for mime in sorted((m for m in data if VEGALITE.fullmatch(m)), reverse=True):
        return content.vegalite(data[mime])
    if "application/vnd.dataresource+json" in data:
        return content.dataresource(data["application/vnd.dataresource+json"])
    if "text/html" in data and (t := content.html_table(_text(data["text/html"]))):
        return t
    if "image/svg+xml" in data:
        return content.svg(_text(data["image/svg+xml"]))
    if "image/png" in data:
        return content.png(base64.b64decode(_text(data["image/png"])))
    if "image/jpeg" in data:
        return content.png(content.to_png(base64.b64decode(_text(data["image/jpeg"]))))
    return None


def _number(text: str) -> float | int | str:
    t = text.strip().strip("'\"")
    try:
        return int(t)
    except ValueError:
        pass
    try:
        return float(t)
    except ValueError:
        return t


def _first_sentence(text: str, limit: int = 70) -> str:
    line = re.sub(r"[*_`#>]", "", text.strip().splitlines()[0]).strip()
    sentence = re.split(r"(?<=[.!?])\s", line, maxsplit=1)[0].rstrip(".")
    return sentence if len(sentence) <= limit else sentence[: limit - 1].rstrip() + "…"


def _kind(output: dict[str, Any]) -> str:
    """A short name for an output that DataWalk does not show."""
    kind = output.get("output_type")
    if kind == "stream":
        return "text output"
    if kind == "error":
        return "error"
    mimes = [m for m in output.get("data", {}) if m != "text/plain"]
    return mimes[0] if mimes else "plain text"


@dataclass
class _Section:
    room: str
    group: str | None = None
    group_keys: list[str] = field(default_factory=list)


def from_notebook(
    path: str | Path,
    name: str | None = None,
    execute_first: bool = False,
    timeout: int = 600,
) -> Report:
    from ..reports.report import Report

    path = Path(path)
    source_path = path
    if execute_first:
        path = execute(path, timeout)
    nb = read(path)
    digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
    report = Report(name or path.stem)
    named = name is not None
    intro: list[str] = []  # text of the H1 cell: the report description
    room_text: dict[str, list[str]] = {}  # text of each H2 cell: the room description
    group_text: list[str] = []  # text of the current H3 cell: the dashboard description
    pending: list[str] = []  # Markdown since the last output
    sec = _Section(DEFAULT_ROOM)
    skipped: Counter[str] = Counter()  # outputs that DataWalk does not show, by kind
    warnings: list[str] = []

    def close_group() -> None:
        if sec.group and len(sec.group_keys) >= 2:
            description = "\n".join(group_text).strip()
            report.add_dashboard(sec.group, sec.group_keys, room=sec.room, description=description)
        sec.group, sec.group_keys = None, []

    for index, cell in enumerate(nb.get("cells", [])):
        md = cell.get("metadata") or {}
        meta = md.get("datawalk") or md.get("vizatrium") or {}  # also the earlier name
        cell_id = str(cell.get("id") or f"cell{index}")
        src = _text(cell.get("source", ""))
        if meta.get("skip"):
            continue
        if cell.get("cell_type") == "markdown":
            if meta.get("text"):  # explicit text panel: narrative, context, agenda
                key = meta.get("key") or f"{cell_id}-text"
                imported = content.markdown(src.strip(), title=meta.get("name"))
                imported.source.provenance = Provenance(
                    kind="notebook", path=str(source_path), sha256=digest, cell_id=cell_id
                )
                report._register(
                    key, imported, meta.get("name"), meta.get("room") or sec.room, None
                )
                continue
            # Text in the same cell as a heading describes that report, room, or group;
            # other Markdown describes the next output.
            target: list[str] = pending
            for line in src.splitlines():
                h = HEADING.match(line)
                if not h:
                    target.append(line)
                    continue
                level, title = len(h.group(1)), h.group(2).strip()
                if level == 1:
                    if not named:
                        report.name = title or report.name
                    target = intro
                elif level == 2:
                    close_group()
                    sec.room = title or DEFAULT_ROOM
                    room = report._room(sec.room, create=True)
                    target = room_text.setdefault(room.id, [])
                    pending = []
                else:
                    close_group()
                    sec.group = title
                    target = group_text
                    group_text.clear()
                    pending = []
            continue
        if cell.get("cell_type") != "code":
            continue
        outputs = cell.get("outputs") or []
        visual = [(i, o, c) for i, o in enumerate(outputs) if (c := output_content(o))]
        for i, o in enumerate(outputs):
            if not any(i == j for j, _, _ in visual) and not meta.get("kpi"):
                skipped[_kind(o)] += 1
        kpi = meta.get("kpi")
        if kpi:
            value = next(
                (
                    _number(_text(o["data"]["text/plain"]))
                    for o in outputs
                    if "text/plain" in o.get("data", {})
                ),
                None,
            )
            spec = kpi if isinstance(kpi, dict) else {}
            key = meta.get("key") or f"{cell_id}-kpi"
            report.add_kpi(
                key,
                spec.get("label") or meta.get("name") or key,
                value,
                unit=spec.get("unit", ""),
                fmt=spec.get("fmt"),
                higher_is_better=spec.get("higher_is_better", True),
                room=meta.get("room") or sec.room,
                description="\n".join(pending).strip() or None,
                update=True,
            )
            report.get(key).source.provenance = Provenance(
                kind="notebook",
                path=str(source_path),
                sha256=digest,
                cell_id=cell_id,
                execution_count=cell.get("execution_count"),
                code=src,
            )
            pending = []
            continue
        for n, (i, _, imported) in enumerate(visual):
            key = meta.get("key") or f"{cell_id}-{i}"
            if meta.get("key") and n:
                key = f"{meta['key']}-{n + 1}"
            imported.source.provenance = Provenance(
                kind="notebook",
                path=str(source_path),
                sha256=digest,
                cell_id=cell_id,
                output_index=i,
                execution_count=cell.get("execution_count"),
                code=src,
            )
            description = "\n".join(pending).strip() or None
            pending = []
            # Untitled images and tables take the first sentence of their description.
            name = meta.get("name")
            if not name and not imported.source.title and description:
                name = _first_sentence(description)
            room = meta.get("room") or sec.room
            if report.get(key):
                raise NotebookError(f"Two outputs have the key {key!r}: give one another key")
            report._register(key, imported, name, room, description)
            if sec.group and room == sec.room:
                sec.group_keys.append(key)
    close_group()
    report._import_log = {"skipped": dict(skipped), "warnings": warnings}
    if not all(c.get("id") for c in nb.get("cells", [])):
        warnings.append(
            "The notebook has no cell ids (nbformat < 4.5): the keys follow cell positions, so a "
            "new cell above a chart can move editor changes. Save the notebook with a current "
            "Jupyter to add ids."
        )
    report.description = "\n".join(intro).strip()
    for room in report.rooms:
        room.description = "\n".join(room_text.get(room.id, [])).strip()
    # Rooms without content (headings only) are of no use in the world.
    report.rooms = [r for r in report.rooms if r.items]
    return report
