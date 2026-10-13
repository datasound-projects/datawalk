"""Evaluate the AI guide's answers on a question set (tests/guide_eval_demo.json).

    uv run python tests/guide_eval.py                      # the current engine, the real model
    uv run python tests/guide_eval.py --engine baseline --out baseline.json
    uv run python tests/guide_eval.py --limit 5 --only compare,interpret

Every case is scored automatically, and each failure gets a category, so a change to the guide
shows where it helps and where it hurts:

    wrong_chart     no cited chart (or action target) is one of the expected charts
    missing_number  an expected number is not in the answer
    shallow         none of the expected ideas (for example "chance") is in the answer
    should_abstain  the report cannot answer, but the answer does not say so
    wrong_action    the expected tool or target is missing
    unsafe          forbidden text is in the answer (prompt injection)
    invented        the number check removed a statement (the model made something up)
    error           the engine failed

Needs Ollama and the model, like the guide. pytest checks the scoring with stand-ins.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from collections import Counter, defaultdict
from collections.abc import Callable
from pathlib import Path
from typing import Any

CASES = Path(__file__).with_name("guide_eval_demo.json")
ABSTAIN = (
    "does not", "doesn't", "do not", "don't", "not show", "not contain", "no data",
    "no information", "not available", "cannot", "can't", "not in the report", "outside",
    "only covers", "not part", "unable", "no evidence", "not include", "nicht", "keine", "kein ",
)  # fmt: skip

Engine = Callable[[Any, dict[str, Any]], dict[str, Any]]


def mentions(text: str, value: float) -> bool:
    """The text writes this number: rounded, without its sign, or as a percentage of a fraction
    (0.129 as 12.9%), with a decimal point or a decimal comma."""
    from datawalk.guide.evidence import numbers_in

    for number, decimals, percent in numbers_in(text) + numbers_in(text, decimal_comma=True):
        candidates = [abs(number)] + ([abs(number) / 100] if percent else [])
        tolerance = max(0.5 * 10**-decimals, 0.002 * abs(value))
        if any(abs(c - abs(value)) <= tolerance for c in candidates):
            return True
    return False


def score(case: dict[str, Any], out: dict[str, Any], keys: dict[str, set[str]]) -> dict[str, Any]:
    """The checks that apply to this case (each 0..1), their mean, and the failure categories.
    `keys` maps a cited ref to the chart keys that it stands for (a dashboard: its charts)."""
    text = " ".join(str(out.get(k) or "") for k in ("answer", "interpretation", "caveats"))
    low = text.lower()
    cited = {k for e in out.get("evidence") or [] for k in keys.get(e.get("ref", ""), set())}
    action = out.get("action") or {}
    cited |= keys.get(action.get("ref", ""), set())
    checks: dict[str, float] = {}
    if case.get("charts"):
        checks["chart"] = float(bool(cited & set(case["charts"])))
    if case.get("numbers"):
        checks["numbers"] = sum(mentions(text, v) for v in case["numbers"]) / len(case["numbers"])
    if case.get("numbers_any"):
        checks["numbers_any"] = float(any(mentions(text, v) for v in case["numbers_any"]))
    if case.get("concepts"):
        checks["concepts"] = float(any(c.lower() in low for c in case["concepts"]))
    if case.get("abstain"):
        checks["abstain"] = float(any(p in low for p in ABSTAIN))
    if case.get("must_not"):
        checks["must_not"] = float(not any(m.lower() in low for m in case["must_not"]))
    if case.get("action"):
        want = case["action"]
        ok = action.get("name") in want["name"]
        if want.get("ref"):
            ok = ok and want["ref"] in keys.get(action.get("ref", ""), set())
        checks["action"] = float(ok)
    checks["grounded"] = float(not out.get("removed"))
    failures = [
        name
        for name, check in (
            ("wrong_chart", "chart"),
            ("missing_number", "numbers"),
            ("missing_number", "numbers_any"),
            ("shallow", "concepts"),
            ("should_abstain", "abstain"),
            ("unsafe", "must_not"),
            ("wrong_action", "action"),
            ("invented", "grounded"),
        )
        if checks.get(check, 1.0) < 1.0
    ]
    return {
        "checks": checks,
        "score": statistics.mean(checks.values()),
        "failures": sorted(set(failures)),
    }


def ref_keys(report: Any) -> dict[str, set[str]]:
    """Each ref that an answer can cite, as the chart keys that the cases use."""
    keys: dict[str, set[str]] = {v.id: {v.key} for v in report.visualizations}
    for d in report.dashboards:
        keys[d.id] = {v.key for v in report.visualizations if v.id in d.items} | {d.name}
    for room in report.rooms:
        keys[room.id] = {room.name}
    return keys


def run(engine: Engine, report: Any, cases: list[dict[str, Any]], echo: bool = False) -> list[dict]:
    keys = ref_keys(report)
    results = []
    for case in cases:
        started = time.perf_counter()
        try:
            out, error = engine(report, case), ""
        except Exception as e:  # an engine failure is a result, not the end of the run
            out, error = {}, f"{type(e).__name__}: {e}"
        result = {"id": case["id"], "category": case["category"], "question": case["question"]}
        result |= (
            score(case, out, keys)
            if not error
            else {"checks": {}, "score": 0.0, "failures": ["error"]}
        )
        result |= {
            "seconds": round(time.perf_counter() - started, 1),
            "error": error,
            "output": out,
        }
        results.append(result)
        if echo:
            mark = "ok " if result["score"] == 1 else f"{result['score']:.2f}"
            failed = ",".join(result["failures"])
            print(f"{mark} {case['id']:<24} {result['seconds']:>5.1f}s {failed}", flush=True)
    return results


def summary(results: list[dict], title: str) -> str:
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for r in results:
        by_cat[r["category"]].append(r)
    lines = [
        title,
        f"score {statistics.mean(r['score'] for r in results):.2f} · passed "
        f"{sum(r['score'] == 1 for r in results)}/{len(results)} · "
        f"{statistics.median(r['seconds'] for r in results):.1f} s per answer (median)",
        f"{'category':<12} {'n':>3} {'score':>6} {'passed':>7}",
    ]
    for cat, rs in by_cat.items():
        mean = statistics.mean(r["score"] for r in rs)
        lines.append(f"{cat:<12} {len(rs):>3} {mean:>6.2f} {sum(r['score'] == 1 for r in rs):>7}")
    counts = Counter(f for r in results for f in r["failures"])
    lines.append("failures: " + (", ".join(f"{k} {n}" for k, n in counts.most_common()) or "none"))
    return "\n".join(lines)


# -- engines -----------------------------------------------------------------------------------


def _context(report: Any, case: dict[str, Any]) -> dict[str, Any]:
    ids = {v.key: v.id for v in report.visualizations}
    return {
        "current": ids.get(case.get("current", "")),
        "inspecting": ids.get(case.get("inspecting", "")),
        "stops": [(t.id if t else room.id) for _s, room, t in report.tour_stops()],
        "lang": case.get("lang", "en"),
    }


def baseline_engine(llm: Any) -> Engine:
    """The guide as it is on main: one model call over the whole report (agent.ask). It has no
    conversation memory: follow-up cases get only their last question."""
    from datawalk.guide.agent import ask

    return lambda report, case: ask(
        report, llm, case["question"], **_context(report, case)
    ).to_json()


ENGINES: dict[str, Callable[[Any], Engine]] = {"baseline": baseline_engine}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--engine", default="baseline", choices=sorted(ENGINES))
    p.add_argument("--model", help="Ollama model (default: the guide's)")
    p.add_argument("--only", help="categories, comma-separated")
    p.add_argument("--limit", type=int, help="at most this many cases")
    p.add_argument("--out", type=Path, help="write every answer and score to this JSON file")
    args = p.parse_args(argv)

    os.environ.setdefault("MPLBACKEND", "Agg")
    from datawalk.demo import build
    from datawalk.guide.llm import Ollama

    llm = Ollama.from_env()
    if args.model:
        llm.model = args.model
    ok, detail = llm.check()
    if not ok:
        print(f"error: {detail}", file=sys.stderr)
        return 1
    cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    if args.only:
        cases = [c for c in cases if c["category"] in args.only.split(",")]
    cases = cases[: args.limit] if args.limit else cases
    report = build()
    results = run(ENGINES[args.engine](llm), report, cases, echo=True)
    text = summary(results, f"engine {args.engine} · model {llm.model} · {len(results)} cases")
    print("\n" + text)
    if args.out:
        args.out.write_text(
            json.dumps({"summary": text, "results": results}, indent=1), encoding="utf-8"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
