"""What the guide may say: a compact text form of the report, and the numbers in it.

Each item that a presentation can show (room, chart, dashboard) gets a short alias (S1, S2,
...): models copy short aliases more reliably than 32-character ids, and the aliases keep the
prompt small. Chart data goes into the prompt only on demand (`detail`), as a few statistics
per series, not as raw arrays.

Report text is untrusted: a notebook or a chart title can contain instructions. It reaches the
model only inside a data block, and nothing the model returns is executed (see agent.py).
"""

from __future__ import annotations

import base64
import math
import re
import struct
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from ..core.models import Dashboard, Room, Visualization

if TYPE_CHECKING:
    from ..reports.report import Report

TEXT_LIMIT = 600  # characters of free text per field (text panels, notes)
SERIES_LIMIT = 8  # series or traces per chart in a detail
POINTS_LISTED = 12  # charts with at most this many points list every (x, y) pair


@dataclass
class Item:
    alias: str  # "S1"
    ref: str  # room, visualization, or dashboard id
    kind: str  # "room" | "chart" | "dashboard"
    title: str
    room: str  # the room that shows it (a room: its own name)
    text: str  # the evidence: what the model sees, and what claims are checked against
    members: list[str] = field(default_factory=list)  # aliases inside a room or dashboard
    viz_id: str | None = None  # the chart to inspect (a dashboard: its first chart)
    # The author's own words, for narration without a model: notes, findings, a summary line.
    notes: str = ""
    findings: list[str] = field(default_factory=list)
    summary: str = ""
    image_only: bool = False  # a picture without data or text: nothing to say about it
    data: str | None = None  # detail() of its chart, computed once when a check needs it


def _clip(text: str, limit: int = TEXT_LIMIT) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _num(x: Any) -> str:
    """A number as the model should quote it: 4 significant digits, no exponent."""
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
        return str(x)
    if x == int(x) and abs(x) < 1e15:
        return str(int(x))
    digits = max(0, 3 - int(math.floor(math.log10(abs(x))))) if x else 0
    text = f"{x:.{min(digits, 6)}f}"
    # Trailing zeros go only after a decimal point: 6626290 must not become 662629.
    return text.rstrip("0").rstrip(".") if "." in text else text


def _viz_text(report: Report, viz: Visualization, notes: str) -> str:
    s, e = viz.source, viz.overrides.explanation
    parts = [f"Chart '{viz.name}' ({s.chart_type}, {s.library})."]
    for axes in s.axes[:2]:
        labels = [f"{n} axis: {a.label}" for n, a in (("x", axes.x), ("y", axes.y)) if a.label]
        if axes.title and axes.title != viz.name:
            labels.insert(0, f"title: {axes.title}")
        if axes.legend:
            labels.append("series: " + ", ".join(axes.legend[:SERIES_LIMIT]))
        if labels:
            parts.append(_clip("; ".join(labels)) + ".")
    for label, value in (
        ("Description", viz.overrides.description),
        ("What it shows", e.what_it_shows),
        ("Units", e.units),
        ("Data source", e.data_source),
        ("Interpretation", e.interpretation),
        ("Methodology", e.methodology),
        ("Assumptions", e.assumptions),
        ("Limitations", e.limitations),
    ):
        if value.strip():
            parts.append(f"{label}: {_clip(value)}")
    parts += [f"Finding: {_clip(f)}" for f in e.findings if f.strip()]
    if s.limitations:
        parts.append("Limits of the extracted data: " + _clip("; ".join(s.limitations)))
    payload = report._payloads.get(viz.id) or {}
    kind = payload.get("kind")
    if kind == "kpi":
        value = f"{payload.get('display', '')} {payload.get('unit', '')}".strip()
        delta = f" (change {payload['delta_display']})" if payload.get("delta_display") else ""
        parts.append(f"Value: {value}{delta}.")
    elif kind == "text":
        parts.append("Text: " + _clip(payload.get("markdown", "")))
    elif kind == "table":
        cols, rows = payload.get("columns", []), payload.get("rows", [])
        parts.append(f"Table with columns {', '.join(map(str, cols[:12]))}.")
        for row in rows[:6]:
            cells = ", ".join(f"{c}={_num(v)}" for c, v in zip(cols, row, strict=False))
            parts.append(_clip(f"Row: {cells}", 300))
    if notes.strip():
        parts.append("Presenter notes: " + _clip(notes))
    return " ".join(parts)


def build_items(report: Report) -> list[Item]:
    """Every room, chart, and dashboard that a presentation can show, in room order."""
    active = {v.id: v for v in report.visualizations if v.status == "active"}
    dashboards = {d.id: d for d in report.dashboards}
    notes = {s.ref: s.notes for s in report.tour if s.notes.strip()}
    items: list[Item] = []
    by_ref: dict[str, Item] = {}
    direct: set[str] = set()  # charts that a room shows on its own wall

    def add(kind: str, ref: str, title: str, room: Room, text: str, viz_id: str | None) -> Item:
        item = Item(f"S{len(items) + 1}", ref, kind, title, room.name, text, viz_id=viz_id)
        item.notes = _clip(notes.get(ref, ""))
        if viz_id == ref:
            viz = active[ref]
            item.findings = [_clip(f) for f in viz.overrides.explanation.findings if f.strip()]
            item.summary = _summary(report, viz)
            item.image_only = viz.source.mode == "static" and not (
                item.findings or item.summary or item.notes
            )
        else:
            owner = next((x for x in (*report.rooms, *report.dashboards) if x.id == ref), None)
            item.summary = _clip(owner.description) if owner else ""
        items.append(item)
        by_ref[ref] = item
        return item

    for room in report.rooms:
        head = f"Room '{room.name}'." + (f" {_clip(room.description)}" if room.description else "")
        if notes.get(room.id):
            head += " Presenter notes: " + _clip(notes[room.id])
        room_item = add("room", room.id, room.name, room, head, None)
        for ref in room.items:
            if ref in by_ref:  # shown twice: one alias, so a stop is never visited twice
                if ref in active and ref not in direct:  # the tour frames it on this wall
                    by_ref[ref].room = room.name
                    direct.add(ref)
            elif ref in active:
                viz = active[ref]
                add("chart", ref, viz.name, room, _viz_text(report, viz, notes.get(ref, "")), ref)
                direct.add(ref)
            elif (dash := dashboards.get(ref)) and (
                shown := [i for i in dash.items if i in active]
            ):
                dash_item = _dashboard(add, report, dash, room, shown, notes.get(ref, ""))
                for vid in shown:
                    if vid not in by_ref:
                        viz = active[vid]
                        text = f"In dashboard '{dash.name}'. " + _viz_text(
                            report, viz, notes.get(vid, "")
                        )
                        add("chart", vid, viz.name, room, text, vid)
                    member = by_ref[vid]
                    dash_item.members.append(member.alias)
                    if member.summary and not dash.description:  # key figures: their values
                        sep = "; " if dash_item.summary else ""
                        dash_item.summary += f"{sep}{member.title}: {member.summary}"
            else:
                continue
            room_item.members.append(by_ref[ref].alias)
    for item in items:  # a room lists what it contains: the model can choose what to show
        if item.kind == "room" and item.members:
            names = {i.alias: i.title for i in items}
            item.text += " Contains: " + "; ".join(f"{a} {names[a]}" for a in item.members) + "."
    return items


def _summary(report: Report, viz: Visualization) -> str:
    """One line in the author's words: what the chart shows, its description, or its value."""
    payload = report._payloads.get(viz.id) or {}
    if payload.get("kind") == "kpi":
        unit = f" {payload['unit']}" if payload.get("unit") else ""
        delta = f" ({payload['delta_display']})" if payload.get("delta_display") else ""
        return f"{payload.get('display', '')}{unit}{delta}"
    if payload.get("kind") == "text":
        return _clip(re.sub(r"[#*_>`\[\]]", "", payload.get("markdown", "")), 300)
    e = viz.overrides.explanation
    return _clip(e.what_it_shows or viz.overrides.description, 300)


def _dashboard(add, report: Report, dash: Dashboard, room: Room, shown: list[str], notes: str):
    text = f"Dashboard '{dash.name}'." + (f" {_clip(dash.description)}" if dash.description else "")
    if notes:
        text += " Presenter notes: " + _clip(notes)
    return add("dashboard", dash.id, dash.name, room, text, shown[0])


def report_header(report: Report) -> str:
    parts = [f"Report '{report.name}'."]
    for label, value in (
        ("Description", report.description),
        ("Author", report.author),
        ("Date", report.date),
        ("Data until", report.data_cutoff),
    ):
        if value.strip():
            parts.append(f"{label}: {_clip(value, 300)}")
    return " ".join(parts)


# -- chart data on demand ------------------------------------------------------------------

_DTYPES = {"i1": "b", "u1": "B", "i2": "h", "u2": "H", "i4": "i", "u4": "I", "f4": "f", "f8": "d"}
_DTYPES |= {"i8": "q", "u8": "Q", "u1c": "B"}


def _array(value: Any) -> list[Any] | None:
    """Plain JSON lists, and plotly.py's {dtype, bdata} arrays (1-D only)."""
    if isinstance(value, list):
        return value if not (value and isinstance(value[0], list)) else None
    if isinstance(value, dict) and "bdata" in value and value.get("dtype") in _DTYPES:
        if "," in str(value.get("shape", "")):
            return None
        raw = base64.b64decode(value["bdata"])
        code = _DTYPES[value["dtype"]]
        return list(struct.unpack(f"<{len(raw) // struct.calcsize(code)}{code}", raw))
    return None


def _numbers(values: list[Any]) -> list[float]:
    return [float(v) for v in values if isinstance(v, (int, float)) and math.isfinite(v)]


_MIDNIGHT = re.compile(r"T00:00(:00(\.0+)?)?$")


def _series_stats(name: str, xs: list[Any] | None, ys: list[Any]) -> str:
    values = _numbers(ys)
    if not values:
        return ""
    xs = xs if xs and len(xs) == len(ys) else None
    if xs:  # dates without a time of day: 2021-01-01, not 2021-01-01T00:00:00.000000
        xs = [_MIDNIGHT.sub("", x) if isinstance(x, str) else x for x in xs]
    if len(ys) <= POINTS_LISTED and xs:
        pairs = ", ".join(
            f"{x if isinstance(x, str) else _num(x)}: {_num(y)}"
            for x, y in zip(xs, ys, strict=True)
        )
        return f"Series '{name}': {pairs}."

    def at(value: float) -> str:
        if not xs:
            return ""
        x = xs[ys.index(value)]
        return f" at {x if isinstance(x, str) else _num(x)}"

    first, last = values[0], values[-1]
    lo, hi, mean = min(values), max(values), sum(values) / len(values)
    span = f" from {xs[0]} to {xs[-1]}" if xs and isinstance(xs[0], str) else ""
    return (
        f"Series '{name}' ({len(values)} points{span}): first {_num(first)}, last {_num(last)}, "
        f"minimum {_num(lo)}{at(lo)}, maximum {_num(hi)}{at(hi)}, mean {_num(mean)}."
    )


def detail(report: Report, viz_id: str | None) -> str:
    """A few exact statistics of a chart's data, for questions about that chart."""
    payload = report._payloads.get(viz_id or "") or {}
    out: list[str] = []
    if payload.get("kind") == "series":
        for s in payload.get("series", [])[:SERIES_LIMIT]:
            out.append(_series_stats(s.get("name", ""), s.get("x"), s.get("y", [])))
    elif payload.get("kind") == "plotly":
        for i, trace in enumerate(payload.get("figure", {}).get("data", [])[:SERIES_LIMIT]):
            if trace.get("type") in ("scatter3d", "surface", "heatmap", "mesh3d"):
                continue
            name = trace.get("name") or f"trace {i + 1}"
            ys, xs = _array(trace.get("y")), _array(trace.get("x"))
            if trace.get("orientation") == "h":
                xs, ys = ys, xs
            if ys:
                out.append(_series_stats(str(name), xs, ys))
    elif payload.get("kind") == "table":
        cols, rows = payload.get("columns", []), payload.get("rows", [])
        for row in rows[:POINTS_LISTED]:
            out.append(", ".join(f"{c}={_num(v)}" for c, v in zip(cols, row, strict=False)) + ".")
    text = " ".join(o for o in out if o)
    return f"Data: {text}" if text else ""


# -- grounding -----------------------------------------------------------------------------

# A number as people write it: -12.9, 1,000, 0.61, 41%, 2021-03-04 (three numbers).
_NUMBER = re.compile(r"(?<![\w.])[-+−]?\d[\d,]*(?:\.\d+)?%?")
_ALIAS = re.compile(r"\bS\d{1,3}\b")
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[\"'(\[]?[A-ZÄÖÜ0-9])")


def _parse(token: str, decimal_comma: bool) -> tuple[float, int, bool] | None:
    """(value, decimals, percent) of a written number."""
    percent = token.endswith("%")
    token = token.rstrip("%").replace("−", "-").lstrip("+")
    if decimal_comma:
        token = token.replace(".", "").replace(",", ".")
    else:
        token = token.replace(",", "")
    try:
        value = float(token)
    except ValueError:
        return None
    decimals = len(token.split(".")[1]) if "." in token else 0
    return value, decimals, percent


def numbers_in(text: str, decimal_comma: bool = False) -> list[tuple[float, int, bool]]:
    return [n for t in _NUMBER.findall(text) if (n := _parse(t, decimal_comma))]


def _matches(claim: tuple[float, int, bool], known: list[tuple[float, int, bool]]) -> bool:
    """A claim matches a known number written the same, rounded (0.61 for 0.6123, 87 for
    87.49, but not 1 for 0.61), without its sign, or as a percentage (0.129 is 12.9%)."""
    value, decimals, percent = claim
    rounding = 0.5 * 10**-decimals + 1e-9
    for k, _, k_percent in known:
        candidates = [abs(k)]
        if percent and not k_percent:
            candidates.append(abs(k) * 100)
        for c in candidates:
            error = abs(abs(value) - c)
            if error <= 1e-9 or (error <= rounding and error <= 0.05 * c):
                return True
    return False


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE.split(text.strip()) if s.strip()]


def _comma_decimal(token: str) -> bool:
    token = token.rstrip("%")
    return "," in token and "." not in token and len(token.rsplit(",", 1)[1]) != 3


def ground(text: str, evidence: str, decimal_comma: bool = False) -> tuple[str, int]:
    """Keep the sentences whose numbers all occur in the evidence. Returns the kept text and
    the number of sentences removed. Aliases (S3) are internal: they are taken out."""
    # The evidence is read as written in English; a number with a decimal comma (12,9 but not
    # 2,654) is read as German too: reading every number both ways would invent values.
    known = numbers_in(evidence) + [
        n for t in _NUMBER.findall(evidence) if _comma_decimal(t) and (n := _parse(t, True))
    ]
    kept, removed = [], 0
    text = re.sub(r"\s*\(\s*[,;]?\s*\)", "", _ALIAS.sub("", text))  # "(S3)" leaves nothing
    for sentence in split_sentences(re.sub(r" +([,.;])", r"\1", text).replace("  ", " ")):
        # Every number in digits is a claim, small counts too ("a count of 1"): the prompt
        # asks for counts in words.
        if all(_matches(c, known) for c in numbers_in(sentence, decimal_comma)):
            kept.append(sentence)
        else:
            removed += 1
    return " ".join(kept), removed
