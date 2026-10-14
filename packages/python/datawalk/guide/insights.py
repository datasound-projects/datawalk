"""Facts: what the report's data says, computed by DataWalk, not by the model.

Each chart's data becomes short, exact statements (facts): changes, extremes, years,
rankings, falls from a peak, long stretches, and the author's own findings and values. A
model then only chooses and phrases facts; every number in an answer must come from one
(answer.py), and expert rules turn facts into interpretations (rules.py). Facts are computed
once per report revision.
"""

from __future__ import annotations

import math
import re
import statistics
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import TYPE_CHECKING, Any

from .evidence import _array, _num

if TYPE_CHECKING:
    from ..reports.report import Report

WORD = re.compile(r"[a-zäöüß0-9]+")
UNNAMED = re.compile(r"^(|trace \d+|series \d+|\d+|none)$", re.I)
PERCENT_WORDS = ("volatility", "drawdown", "return", "percent", "%", "yield", "share")
NOT_PERCENT = ("correlation", "auc", "accuracy", "precision", "recall", "score", "count", "days")
BASELINE = re.compile(r"\b(naive|baseline|chance|benchmark)\b", re.I)  # not "random": Random forest
LEVEL_WORDS = ("price", "index", "value", "equity", "nav", "close", "level", "balance")
SKIP_X = ("false positive rate",)  # ROC curves: their AUC is the fact, not the curve's points


@dataclass
class Fact:
    id: str  # F1, F2, ... (stable for a report revision)
    ref: str  # the visualization (or room) it is about
    chart: str  # its title
    kind: str  # change | high | low | year | fall | stretch | ranking | lowest | gap | baseline
    #            row | value | author | spread | trend
    text: str  # one exact sentence
    importance: float  # 0..1: what a short answer should mention first
    tags: set[str] = field(default_factory=set)  # words for retrieval
    values: dict[str, Any] = field(default_factory=dict)  # the raw numbers, for the rules


@dataclass
class Data:
    """One series of a chart, in a common form."""

    name: str  # the metric: series name, else the y axis, else the chart title
    xname: str  # the x axis ("window", "lag"), "" for dates and categories
    xs: list[Any]  # date, number, or category label
    ys: list[float]
    xkind: str  # "date" | "number" | "category"
    percent: bool  # fractions shown as percentages (volatility 0.155 -> 15.5%)


def words(text: str) -> set[str]:
    out = set(WORD.findall(text.lower()))
    return out | {w[:-1] for w in out if len(w) > 4 and w.endswith("s")}  # plurals


def fmt(value: float, percent: bool = False) -> str:
    return f"{value * 100:.1f}%" if percent else _num(value)


def _date(value: Any) -> date | None:
    if not isinstance(value, str) or len(value) < 8:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "")).date()
    except ValueError:
        return None


def _data(name: str, xname: str, xs: list[Any] | None, ys: list[Any], percent: bool) -> Data | None:
    if all(y == ys[0] for y in ys):  # a reference line (zero, chance): nothing to say
        return None
    pairs = [
        (x, float(y))
        for x, y in zip(xs or range(1, len(ys) + 1), ys, strict=False)
        if isinstance(y, (int, float)) and not isinstance(y, bool) and math.isfinite(y)
    ]
    if len(pairs) < 2:
        return None
    xv = [x for x, _ in pairs]
    dates = [_date(x) for x in xv]
    if all(dates):
        kind, xv = "date", dates
    elif all(isinstance(x, (int, float)) for x in xv):
        kind = "number"
    else:
        kind, xv = "category", [str(x) for x in xv]
    return Data(name, xname, xv, [y for _, y in pairs], kind, percent)


def chart_data(report: Report, viz: Any) -> list[Data]:
    """The chart's numeric series: line and bar data, Plotly traces, and table columns."""
    try:
        return _chart_data(report, viz)
    except (KeyError, IndexError, TypeError, ValueError, AttributeError):
        return []  # a payload shape that this reader does not know: no facts from this chart


def _chart_data(report: Report, viz: Any) -> list[Data]:
    payload = report._payloads.get(viz.id) or {}
    axes = viz.source.axes[0] if viz.source.axes else None
    ylabel, xlabel = (axes.y.label, axes.x.label) if axes else ("", "")
    title = viz.name

    def named(raw: Any) -> str:
        raw = str(raw or "")
        if UNNAMED.match(raw):
            return ylabel or title
        if ylabel and not words(ylabel) & words(raw):  # a legend entry: say what it measures
            return f"{ylabel} ({raw})"
        return raw

    def percent(name: str) -> bool:
        text = f"{name} {title} {ylabel}".lower()
        return any(w in text for w in PERCENT_WORDS) and not any(w in text for w in NOT_PERCENT)

    if any(w in xlabel.lower() for w in SKIP_X):
        return []

    out: list[Data] = []
    if payload.get("kind") == "series":
        for s in payload.get("series", [])[:8]:
            name = named(s.get("name"))
            ys = s.get("y", [])
            fraction = percent(name) and all(abs(y) <= 1.5 for y in ys if isinstance(y, float))
            if d := _data(name, xlabel, s.get("x"), ys, fraction):
                out.append(d)
    elif payload.get("kind") == "plotly":
        for trace in payload.get("figure", {}).get("data", [])[:8]:
            if trace.get("type") in ("scatter3d", "surface", "heatmap", "mesh3d", "pie"):
                continue
            if trace.get("mode") == "markers":  # a point cloud: no series to describe
                continue
            ys, xs = _array(trace.get("y")), _array(trace.get("x"))
            if trace.get("orientation") == "h":
                xs, ys = ys, xs
            if not ys:
                continue
            name = named(trace.get("name"))
            fraction = percent(name) and all(abs(y) <= 1.5 for y in ys if isinstance(y, float))
            if d := _data(name, xlabel, xs, ys, fraction):
                out.append(d)
    elif payload.get("kind") == "table":
        cols, rows = payload.get("columns", []), payload.get("rows", [])
        label = next(
            (i for i, c in enumerate(cols) if all(isinstance(r[i], str) for r in rows)), None
        )
        if label is not None and rows:
            for i, col in enumerate(cols):
                ys = [r[i] for r in rows]
                if i != label and all(isinstance(y, (int, float)) for y in ys):
                    if d := _data(str(col), "", [r[label] for r in rows], ys, False):
                        out.append(d)
    return out


class Builder:
    def __init__(self) -> None:
        self.facts: list[Fact] = []

    def add(
        self,
        viz_ref: str,
        chart: str,
        kind: str,
        text: str,
        importance: float,
        tags: set[str],
        **values,
    ):
        fact = Fact(f"F{len(self.facts) + 1}", viz_ref, chart, kind, text, importance)
        fact.tags = tags | words(f"{chart} {text}") | {kind}
        fact.values = values
        self.facts.append(fact)
        return fact


INTENT_TAGS = {
    "change": {
        "change", "trend", "develop", "move", "rise", "fall", "increase", "decrease", "over",
        "period", "up", "down", "go",
    },
    "high": {"highest", "maximum", "max", "peak", "top", "most", "record", "when"},
    "low": {"lowest", "minimum", "min", "bottom", "least", "trough", "when"},
    "year": {"year", "yearly", "annual"},
    "fall": {"risk", "loss", "fall", "drawdown", "peak", "trough", "recover", "decline", "crash"},
    "stretch": {"long", "duration", "how", "stay", "stayed", "below", "days", "recover"},
    "ranking": {
        "best", "top", "highest", "rank", "ranking", "compare", "win", "wins", "better", "most",
    },
    "lowest": {"worst", "lowest", "least", "fewest", "weakest", "bottom", "compare"},
    "gap": {"gap", "difference", "better", "compare", "close", "trust", "ranking"},
    "baseline": {"baseline", "naive", "chance", "compare", "better", "versus", "vs"},
    "row": set(),
    "value": {"key", "figure", "figures", "value", "now", "current", "final"},
    "author": {"finding", "findings", "summary", "key", "conclusion", "main"},
    "spread": {"average", "typical", "mean", "high", "now", "current", "regime"},
}  # fmt: skip


def _series_facts(b: Builder, ref: str, chart: str, d: Data) -> None:
    p, name, ys, xs = d.percent, d.name, d.ys, d.xs
    base = words(f"{name} {d.xname}")

    def tags(kind: str, extra: set[str] = frozenset()) -> set[str]:
        return base | INTENT_TAGS[kind] | set(extra)

    if d.xkind == "category":
        order = sorted(range(len(ys)), key=lambda i: -ys[i])
        listing = ", ".join(f"{xs[i]} {fmt(ys[i], p)}" for i in order)
        top, second, last = order[0], order[1], order[-1]
        labels = {w for x in xs for w in words(str(x))}
        b.add(
            ref,
            chart,
            "ranking",
            f"{chart}: the highest {name} is {xs[top]} with {fmt(ys[top], p)} (all: {listing}).",
            0.85,
            tags("ranking", labels),
            best=xs[top],
            value=ys[top],
            all=dict(zip(xs, ys, strict=True)),
            metric=name,
        )
        b.add(
            ref,
            chart,
            "lowest",
            f"{chart}: the lowest {name} is {xs[last]} with {fmt(ys[last], p)}.",
            0.6,
            tags("lowest", labels),
            worst=xs[last],
            value=ys[last],
            metric=name,
        )
        gap = ys[top] - ys[second]
        b.add(
            ref,
            chart,
            "gap",
            f"{chart}: {xs[top]} is ahead of {xs[second]} by {fmt(gap, p)} in {name} "
            f"({fmt(ys[top], p)} versus {fmt(ys[second], p)}).",
            0.55,
            tags("gap", labels),
            gap=gap,
            first=xs[top],
            second=xs[second],
            metric=name,
            top=ys[top],
        )
        bases = [i for i, x in enumerate(xs) if BASELINE.search(str(x))]
        if bases and top not in bases:
            i = bases[0]
            b.add(
                ref,
                chart,
                "baseline",
                f"{chart}: the best {name}, {xs[top]} with {fmt(ys[top], p)}, is "
                f"{fmt(ys[top] - ys[i], p)} above {xs[i]} ({fmt(ys[i], p)}).",
                0.7,
                tags("baseline", labels),
                best=xs[top],
                value=ys[top],
                baseline=xs[i],
                base=ys[i],
                metric=name,
            )
        return

    def at(i: int) -> str:
        x = xs[i]
        if d.xkind == "date":
            return f"on {x.isoformat()}"
        return f"at {d.xname.lower() or 'x'} {_num(x)}"

    hi, lo = max(range(len(ys)), key=ys.__getitem__), min(range(len(ys)), key=ys.__getitem__)
    first, last = ys[0], ys[-1]
    if d.xkind == "number" and len(ys) > 40:  # a curve or a histogram: its peak only
        b.add(
            ref,
            chart,
            "high",
            f"The highest {name} is {fmt(ys[hi], p)} {at(hi)}; at the end it is {fmt(last, p)}.",
            0.6,
            tags("high", words(at(hi))),
            value=ys[hi],
            x=xs[hi],
            last=last,
            metric=name,
        )
        return
    deficit = d.xkind == "date" and max(ys) <= 0  # a drawdown: its "highest" is just zero
    span = f"from {at(0)[3:]} to {at(len(ys) - 1)[3:]}" if d.xkind == "date" else ""
    if d.xkind == "date" and not p and first > 0:
        change = last / first - 1
        b.add(
            ref,
            chart,
            "change",
            f"{name} moves from {fmt(first)} to {fmt(last)} {span} ({change * 100:+.1f}%).",
            0.8,
            tags("change"),
            first=first,
            last=last,
            change=change,
            metric=name,
        )
    else:
        b.add(
            ref,
            chart,
            "change",
            f"{name} goes from {fmt(first, p)} {at(0)} to {fmt(last, p)} {at(len(ys) - 1)}.",
            0.7,
            tags("change"),
            first=first,
            last=last,
            metric=name,
        )
    if not deficit:
        b.add(
            ref,
            chart,
            "high",
            f"The highest {name} is {fmt(ys[hi], p)} {at(hi)}.",
            0.7,
            tags("high", words(at(hi))),
            value=ys[hi],
            x=xs[hi],
            metric=name,
        )
    dd = "drawdown" in name.lower()
    b.add(
        ref,
        chart,
        "low",
        f"The lowest {name} is {fmt(ys[lo], p)} {at(lo)}.",
        0.65,
        # a drawdown's lowest value is its maximum ("the maximum drawdown")
        tags("low", words(at(lo)) | ({"maximum", "max", "deepest", "worst"} if dd else set())),
        value=ys[lo],
        x=xs[lo],
        metric=name,
    )
    if d.xkind != "date":
        return
    mean, median = statistics.fmean(ys), statistics.median(ys)
    if p and min(ys) >= 0:
        b.add(
            ref,
            chart,
            "spread",
            f"The average {name} is {fmt(mean, p)}; now it is {fmt(last, p)}, and the "
            f"highest is {max(ys) / median:.1f} times the median ({fmt(median, p)}).",
            0.6,
            tags("spread"),
            mean=mean,
            median=median,
            last=last,
            high=max(ys),
            metric=name,
        )
    years = sorted({x.year for x in xs})
    if len(years) >= 2:
        for year in years:
            idx = [i for i, x in enumerate(xs) if x.year == year]
            if len(idx) < 20:
                continue
            a, z = ys[idx[0]], ys[idx[-1]]
            if not p and a > 0:
                change = (z / a - 1) * 100
                verb = "rose" if change > 0 else "fell" if change < 0 else "ended flat"
                text = f"In {year}, {name} {verb} from {fmt(a)} to {fmt(z)} ({change:+.1f}%)."
                b.add(
                    ref,
                    chart,
                    "year",
                    text,
                    0.5,
                    tags("year", {str(year)} | INTENT_TAGS["change"]),
                    year=year,
                    first=a,
                    last=z,
                    change=z / a - 1,
                    metric=name,
                )
            elif max(ys[i] for i in idx) <= 0:
                j = min(idx, key=ys.__getitem__)
                b.add(
                    ref,
                    chart,
                    "year",
                    f"In {year}, the deepest {name} was {fmt(ys[j], p)} {at(j)}.",
                    0.45,
                    tags("year", {str(year)}),
                    year=year,
                    low=ys[j],
                    metric=name,
                )
            else:
                j = max(idx, key=ys.__getitem__)
                avg = statistics.fmean(ys[i] for i in idx)
                b.add(
                    ref,
                    chart,
                    "year",
                    f"In {year}, the average {name} was {fmt(avg, p)} (highest {fmt(ys[j], p)} "
                    f"{at(j)}).",
                    0.5,
                    tags("year", {str(year)} | INTENT_TAGS["change"]),
                    year=year,
                    mean=avg,
                    high=ys[j],
                    metric=name,
                )
    level = any(w in f"{name} {chart}".lower() for w in LEVEL_WORDS)
    if level and not p and min(ys) > 0:  # a level (a price): the largest fall from a peak
        peak_i, best, fall, fall_peak, fall_low = 0, ys[0], 0.0, 0, 0
        for i, y in enumerate(ys):
            if y > best:
                best, peak_i = y, i
            if y / best - 1 < fall:
                fall, fall_peak, fall_low = y / best - 1, peak_i, i
        if fall < -0.05:
            later = [i for i in range(fall_low, len(ys)) if ys[i] >= ys[fall_peak]]
            recovered = (
                f"It was back at the peak {at(later[0])}."
                if later
                else "It did not get back to that peak by the end."
            )
            b.add(
                ref,
                chart,
                "fall",
                f"The largest fall of {name} from a peak is {fall * 100:.1f}%, from "
                f"{fmt(ys[fall_peak])} {at(fall_peak)} to {fmt(ys[fall_low])} {at(fall_low)}. "
                f"{recovered}",
                0.75,
                tags("fall"),
                fall=fall,
                metric=name,
            )
    if p and max(ys) <= 0 and min(ys) < -0.2:  # a drawdown: how long it stayed deep
        run = best_run = start = best_start = 0
        for i, y in enumerate(ys):
            if y < -0.2:
                if run == 0:
                    start = i
                run += 1
                if run > best_run:
                    best_run, best_start = run, start
            else:
                run = 0
        end = best_start + best_run - 1
        b.add(
            ref,
            chart,
            "stretch",
            f"{name} stayed below -20% for {best_run} data points (trading days) in a row, "
            f"from {xs[best_start].isoformat()} to {xs[end].isoformat()}.",
            0.6,
            tags("stretch"),
            days=best_run,
            metric=name,
        )


def _plain(markdown: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[#*_>`\[\]]", "", markdown)).strip()


def build_facts(report: Report) -> list[Fact]:
    """All facts of the report, the most important first within each chart."""
    b = Builder()
    for viz in report.visualizations:
        if viz.status != "active":
            continue
        payload = report._payloads.get(viz.id) or {}
        chart = viz.name
        for finding in viz.overrides.explanation.findings:
            if finding.strip():
                b.add(
                    viz.id,
                    chart,
                    "author",
                    f"{chart}: {finding.strip()}",
                    0.95,
                    words(chart) | INTENT_TAGS["author"],
                )
        if payload.get("kind") == "kpi":
            delta = f" (change {payload['delta_display']})" if payload.get("delta_display") else ""
            unit = f" {payload['unit']}" if payload.get("unit") else ""
            b.add(
                viz.id,
                chart,
                "value",
                f"{chart}: {payload.get('display', '')}{unit}{delta}.",
                0.9,
                words(chart) | INTENT_TAGS["value"],
                value=payload.get("value"),
                delta=payload.get("delta"),
                metric=chart,
            )
        elif payload.get("kind") == "text":
            text = _plain(payload.get("markdown", ""))
            if text:
                b.add(
                    viz.id, chart, "author", text[:400], 0.9, words(chart) | INTENT_TAGS["author"]
                )
        if payload.get("kind") == "table":
            cols, rows = payload.get("columns", []), payload.get("rows", [])
            for row in rows[:12]:
                cells = ", ".join(
                    f"{c} {_num(v) if isinstance(v, (int, float)) else v}"
                    for c, v in zip(cols, row, strict=False)
                )
                b.add(
                    viz.id,
                    chart,
                    "row",
                    f"{chart}: {cells}.",
                    0.5,
                    {w for v in row for w in words(str(v))},
                )
        for d in chart_data(report, viz):
            try:
                _series_facts(b, viz.id, chart, d)
            except (ValueError, ZeroDivisionError, TypeError):
                continue  # data that the analyses do not fit: the chart keeps its other facts
    return b.facts
