"""Expert rules: what the facts mean, written as code, so a small model only has to repeat it.

Each rule reads facts (insights.py) and returns an interpretation with its reasons, a caveat,
and the facts that it rests on. Three packs: ML review, Finance, Statistics. The thresholds
are common rules of thumb; each interpretation says what it is based on. Rules never invent
numbers: every number in an interpretation comes from its facts.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field

from .insights import Fact, fmt, words

AUC_TEXT = re.compile(r"\bAUC\b[^0-9]{0,12}(0\.\d+)", re.I)
MEANING = {
    "mean", "meaning", "good", "useful", "trust", "interpret", "significant", "skill", "predict",
    "worth", "conclusion", "risk", "risky", "severe", "bad", "why", "should", "real", "matter",
    "reliable", "edge", "chance", "noise", "valid", "explain", "tell", "conclude",
}  # fmt: skip


@dataclass
class Insight:
    id: str  # I1, I2, ...
    domain: str  # "ML review" | "Finance" | "Statistics"
    text: str
    caveat: str
    facts: list[str]  # the facts it rests on
    refs: set[str]  # their charts
    importance: float
    tags: set[str] = field(default_factory=set)


Rule = Callable[[list[Fact]], list[tuple[str, str, str, list[Fact], float]]]


def _metric(f: Fact, *names: str) -> bool:
    return any(n in str(f.values.get("metric", "")).lower() for n in names)


def auc_skill(facts: list[Fact]) -> list:
    out, done = [], set()
    for f in facts:
        if f.kind != "ranking" or not _metric(f, "auc"):
            continue
        values = f.values["all"]
        best, b = f.values["best"], f.values["value"]
        if (best, round(b, 3)) in done:  # the same models in a chart and in a table
            continue
        done.add((best, round(b, 3)))
        spread = max(abs(v - 0.5) for v in values.values())
        if spread <= 0.03:
            text = (
                f"{best} has the highest AUC ({fmt(b)}), but every model is within {spread:.2f} "
                "of chance (0.50): none shows real predictive skill, so the ranking is most likely "
                "noise."
            )
            caveat = (
                "The report gives no confidence intervals; differences this small need them "
                "before choosing a model."
            )
        else:
            text = f"The best AUC, {fmt(b)} ({best}), means {_auc_level(b)}."
            caveat = "AUC measures ranking, not profit; check the costs of wrong decisions too."
        same = [g for g in facts if g.kind in ("ranking", "gap", "baseline") and _metric(g, "auc")]
        out.append(("ML review", text, caveat, same, 0.95))
    for f in facts:  # an AUC that the author wrote ("ROC AUC of 0.49")
        if f.kind == "author" and (m := AUC_TEXT.search(f.text)):
            v = float(m.group(1))
            out.append(
                (
                    "ML review",
                    f"An AUC of {m.group(1)} means {_auc_level(v)}.",
                    "AUC measures how well scores rank cases, not whether a strategy pays.",
                    [f],
                    0.9,
                )
            )
    return out


def _auc_level(v: float) -> str:
    if abs(v - 0.5) <= 0.03:
        return (
            "chance level (0.50): the model does not separate the classes better than a coin flip"
        )
    if v < 0.5:
        return "worse than chance: the scores point the wrong way"
    if v < 0.65:
        return "a weak signal"
    if v < 0.75:
        return "a fair, useful signal"
    if v < 0.9:
        return "a good model"
    return "an excellent result; check for data leakage before trusting it"


def accuracy_vs_baseline(facts: list[Fact]) -> list:
    out = []
    for f in facts:
        if f.kind == "baseline" and _metric(f, "accuracy"):
            diff = f.values["value"] - f.values["base"]
            if abs(diff) < 0.05:
                text = (
                    f"{f.values['best']}'s accuracy of {fmt(f.values['value'])} is only "
                    f"{diff * 100:.1f} percentage points above the {f.values['baseline']} baseline "
                    f"({fmt(f.values['base'])}): a small edge."
                )
                caveat = (
                    "Accuracy depends on how balanced the classes are, and the report does not "
                    "state it."
                )
                out.append(("ML review", text, caveat, [f], 0.85))
    return out


def walk_forward(facts: list[Fact]) -> list:
    out = []
    for f in facts:
        if f.kind == "change" and _metric(f, "accuracy") and "window" in f.text.lower():
            high = next((g for g in facts if g.kind == "high" and g.ref == f.ref), None)
            first, last = f.values["first"], f.values["last"]
            peak = (
                f" (best {fmt(high.values['value'])} at window {fmt(high.values['x'])})"
                if high
                else ""
            )
            if max(first, last) < 0.6:
                text = (
                    f"Accuracy {'rises' if last > first else 'falls'} from {fmt(first)} to "
                    f"{fmt(last)} across the windows{peak}, but stays close to chance (0.50): a "
                    "small edge that trading costs could erase."
                )
                out.append(
                    (
                        "ML review",
                        text,
                        "One synthetic history; results on new data can differ.",
                        [f] + ([high] if high else []),
                        0.75,
                    )
                )
    return out


def precision_vs_base(facts: list[Fact]) -> list:
    out = []
    for f in facts:
        if f.kind == "high" and _metric(f, "precision") and "last" in f.values:
            high, last = f.values["value"], f.values["last"]
            if 0 < high - last < 0.05:
                text = (
                    f"Precision peaks at {fmt(high)}, barely above the base rate ({fmt(last)} at "
                    "full recall): the model adds little over guessing."
                )
                out.append(
                    (
                        "ML review",
                        text,
                        "Precision at one threshold; the report does not show the costs.",
                        [f],
                        0.65,
                    )
                )
    return out


def autocorrelation(facts: list[Fact]) -> list:
    out = []
    for f in facts:
        if f.kind == "high" and _metric(f, "autocorrelation"):
            low = next((g for g in facts if g.kind == "low" and g.ref == f.ref), None)
            if abs(f.values["value"]) < 0.2 and (not low or abs(low.values["value"]) < 0.2):
                text = (
                    f"Autocorrelation is small (largest {fmt(f.values['value'])}, at lag "
                    f"{fmt(f.values['x'])}) and close to zero at the other lags: past returns tell "
                    "little about future returns."
                )
                out.append(
                    (
                        "Statistics",
                        text,
                        "Correlation measures only straight-line links.",
                        [f] + ([low] if low else []),
                        0.7,
                    )
                )
    return out


def drawdown_severity(facts: list[Fact]) -> list:
    deep = [
        f
        for f in facts
        if (f.kind == "low" and _metric(f, "drawdown")) or (f.kind == "fall" and "fall" in f.values)
    ]
    if not deep:
        return []
    worst = min(deep, key=lambda f: f.values.get("value", f.values.get("fall", 0)))
    depth = abs(worst.values.get("value", worst.values.get("fall", 0)))
    level = (
        "severe: more than 40% below the peak, the size of a deep bear market"
        if depth >= 0.4
        else "large: the size of a bear market"
        if depth >= 0.2
        else "a correction"
        if depth >= 0.1
        else "mild"
    )
    based = [worst]
    text = f"The deepest fall from a peak, {depth * 100:.1f}%, is {level}"
    stretch = next((f for f in facts if f.kind == "stretch"), None)
    if stretch:
        days = stretch.values["days"]
        text += f", and it stayed more than 20% below its peak for {days} trading days in a row"
        based.append(stretch)
    fall = next((f for f in facts if f.kind == "fall" and "did not get back" in f.text), None)
    if fall:
        text += "; the price had not recovered by the end"
        based.append(fall)
    return [("Finance", text + ".", "Past falls do not predict future ones.", based, 0.9)]


def volatility_level(facts: list[Fact]) -> list:
    out = []
    for f in facts:
        if f.kind == "spread" and _metric(f, "volatil"):
            v = f.values
            level = (
                "low"
                if v["last"] < 0.15
                else "moderate"
                if v["last"] < 0.25
                else "high"
                if v["last"] < 0.4
                else "very high"
            )
            now, mean, high = fmt(v["last"], True), fmt(v["mean"], True), fmt(v["high"], True)
            text = (
                f"Volatility is {level} now ({now}), below its average ({mean}) and far below its "
                f"peak ({high})"
                if v["last"] < v["mean"]
                else f"Volatility is {level} now ({now}), above its average ({mean})"
            )
            years = [g for g in facts if g.kind == "year" and g.ref == f.ref and "mean" in g.values]
            stressed = [g for g in years if g.values["mean"] > v["mean"]]
            if v["high"] / v["median"] >= 2 and stressed:
                names = ", ".join(str(g.values["year"]) for g in stressed)
                text += f"; it comes in waves, with stressed years ({names})"
            out.append(
                (
                    "Finance",
                    text + ".",
                    "Volatility changes fast: a calm phase can end abruptly.",
                    [f, *stressed],
                    0.8,
                )
            )
    return out


def price_performance(facts: list[Fact]) -> list:
    out = []
    for f in facts:
        if (
            f.kind == "change"
            and "change" in f.values
            and _metric(f, "price", "value", "index", "close")
        ):
            years = [
                g for g in facts if g.kind == "year" and g.ref == f.ref and "change" in g.values
            ]
            change = f.values["change"]
            verb = "lost" if change < 0 else "gained"
            text = f"Over the whole period the price {verb} {abs(change) * 100:.1f}%"
            if len(years) >= 2:
                best = max(years, key=lambda g: g.values["change"])
                worst = min(years, key=lambda g: g.values["change"])
                text += (
                    f", with large swings between years: best {best.values['year']} "
                    f"({best.values['change'] * 100:+.1f}%), worst {worst.values['year']} "
                    f"({worst.values['change'] * 100:+.1f}%)"
                )
                based = [f, best, worst]
            else:
                based = [f]
            out.append(
                ("Finance", text + ".", "Past returns do not predict future returns.", based, 0.8)
            )
    return out


def small_gap(facts: list[Fact]) -> list:
    out, done = [], set()
    for f in facts:
        if _metric(f, "auc"):  # AUC has its own rule (auc_skill)
            continue
        if (
            f.kind == "gap"
            and abs(f.values["top"]) <= 1
            and f.values["top"]
            and f.values["gap"] / abs(f.values["top"]) < 0.03
        ):
            key = (
                f.values["first"],
                f.values["second"],
                f.values["metric"],
                round(f.values["gap"], 3),
            )
            if key in done:
                continue
            done.add(key)
            text = (
                f"{f.values['first']} leads {f.values['second']} by only {fmt(f.values['gap'])} in "
                f"{f.values['metric']}: too small a difference to call a clear winner."
            )
            out.append(
                (
                    "Statistics",
                    text,
                    "Without confidence intervals, small differences can be noise.",
                    [f],
                    0.6,
                )
            )
    return out


RULES: list[Rule] = [
    auc_skill, accuracy_vs_baseline, walk_forward, precision_vs_base, autocorrelation,
    drawdown_severity, volatility_level, price_performance, small_gap,
]  # fmt: skip


def build_insights(facts: list[Fact]) -> list[Insight]:
    insights: list[Insight] = []
    seen: set[str] = set()
    for rule in RULES:
        for domain, text, caveat, based, importance in rule(facts):
            if text in seen:
                continue
            seen.add(text)
            tags = set().union(*(f.tags for f in based)) | MEANING | words(f"{domain} {text}")
            ids = list(dict.fromkeys(f.id for f in based))
            insights.append(
                Insight(
                    f"I{len(insights) + 1}",
                    domain,
                    text,
                    caveat,
                    ids,
                    {f.ref for f in based},
                    importance,
                    tags,
                )
            )
    return insights
