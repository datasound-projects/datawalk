"""Evaluate the AI guide's answers on a question set (tests/guide_eval_demo.json).

    uv run python tests/guide_eval.py --out facts.json      # the guide with the real model
    uv run python tests/guide_eval.py --out facts.json --resume   # go on after an interruption
    uv run python tests/guide_eval.py --limit 5 --only compare,interpret
    uv run python tests/guide_eval.py --engine template --cases tests/guide_eval_holdout.json
    uv run python tests/guide_eval.py --rescore facts.json      # saved answers, today's scoring

Every case is scored automatically, and each failure gets a category, so a change to the guide
shows where it helps and where it hurts:

    wrong_chart     no cited chart (or action target) is one of the expected charts
    missing_number  an expected number is not in the answer
    shallow         none of the expected ideas (for example "chance") is in the answer
    should_abstain  the report cannot answer, but the answer (not a caveat) does not say so
    wrong_action    the expected tool or target is missing
    unsafe          forbidden text is in the answer (prompt injection)
    invented        the number check removed a statement (the model made something up)
    error           the engine failed

Needs Ollama and the model, like the guide ("template" needs neither). pytest checks the
scoring with stand-ins, and that the template engine passes the question set.

Results with nemotron-3-nano:4b on an Apple M2 (score · passed · median time per answer):

    engine                          demo set (64)        held-out set (28)
    one call over the whole report  0.77 · 36 · 11.6 s   0.83 · 17 · 10.5 s   (the first guide)
    facts, with the model           1.00 · 63 · 11.9 s   1.00 · 28 ·  9.7 s   (first run: 0.97 · 26)
    facts, no model (template)      1.00 · 64            0.96 · 26
"""

from __future__ import annotations

import argparse
import importlib
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
    if case.get("abstain"):  # in the answer itself: a caveat that says "not" is no refusal
        said = str(out.get("answer") or "").lower()
        checks["abstain"] = float(any(p in said for p in ABSTAIN))
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


def run(
    engine: Engine,
    report: Any,
    cases: list[dict[str, Any]],
    echo: bool = False,
    after: Callable[[list[dict]], None] | None = None,
) -> list[dict]:
    """Every case's answer and score. `after` gets the results after each case (to save them:
    a long run on a laptop can be interrupted)."""
    keys = ref_keys(report)
    results: list[dict] = []
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
        if after:
            after(results)
        if echo:
            mark = "ok " if result["score"] == 1 else f"{result['score']:.2f}"
            failed = ",".join(result["failures"])
            source = out.get("source", "")
            print(
                f"{mark} {case['id']:<24} {result['seconds']:>5.1f}s {source:<8} {failed}",
                flush=True,
            )
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


def facts_engine(llm: Any) -> Engine:
    """The fact-first guide (answer.py): retrieved facts and expert interpretations, phrased by
    the model, checked, with a template from the facts as the fallback."""
    from datawalk.guide.answer import Knowledge, answer

    known: dict[int, Knowledge] = {}

    def engine(report: Any, case: dict[str, Any]) -> dict[str, Any]:
        kb = known.setdefault(id(report), Knowledge.of(report))
        history = case.get("history", [])
        out = answer(report, kb, llm, case["question"], history=history, **_context(report, case))
        return out.to_json()

    return engine


def template_engine(_llm: Any) -> Engine:
    """The fact-first guide without a model: what the audience gets when the model fails."""
    return facts_engine(None)


ENGINES: dict[str, Callable[[Any], Engine]] = {
    "facts": facts_engine,
    "template": template_engine,
}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--engine", default="facts", choices=sorted(ENGINES))
    p.add_argument("--model", help="Ollama model (default: the guide's)")
    p.add_argument("--only", help="categories, comma-separated")
    p.add_argument("--limit", type=int, help="at most this many cases")
    p.add_argument("--cases", type=Path, default=CASES, help="the question set (JSON)")
    p.add_argument("--out", type=Path, help="write every answer and score to this JSON file")
    p.add_argument("--resume", action="store_true", help="keep the answers already in --out")
    p.add_argument("--rescore", type=Path, help="score the answers saved in this file again")
    p.add_argument(
        "--timeout", type=float, help="seconds the facts engine waits for the model (default 60)"
    )
    args = p.parse_args(argv)

    os.environ.setdefault("MPLBACKEND", "Agg")
    from datawalk.demo import build
    from datawalk.guide.llm import Ollama

    if args.rescore:  # with the refs of the report that answered: each build has new ids
        saved = json.loads(args.rescore.read_text(encoding="utf-8"))
        cases = {c["id"]: c for c in json.loads(args.cases.read_text(encoding="utf-8"))["cases"]}
        if "keys" not in saved:
            print(
                f"error: {args.rescore} has no refs (an older run): run it again", file=sys.stderr
            )
            return 1
        keys = {ref: set(k) for ref, k in saved["keys"].items()}
        results = [
            r | (score(cases[r["id"]], r["output"], keys) if not r["error"] else {})
            for r in saved["results"]
        ]
        print(summary(results, f"{args.rescore.name}, scored again"))
        return 0

    if args.timeout:  # a busy computer: measure the answers, not the waiting
        importlib.import_module("datawalk.guide.answer").TIMEOUT = args.timeout
    llm = Ollama.from_env()
    if args.model:
        llm.model = args.model
    ok, detail = llm.check() if args.engine != "template" else (True, "")
    if not ok:
        print(f"error: {detail}", file=sys.stderr)
        return 1
    cases = json.loads(args.cases.read_text(encoding="utf-8"))["cases"]
    if args.only:
        cases = [c for c in cases if c["category"] in args.only.split(",")]
    cases = cases[: args.limit] if args.limit else cases
    report = build()
    # each build has new ids: keep the refs of earlier runs to score their answers again
    saved = json.loads(args.out.read_text(encoding="utf-8")) if args.resume else {}
    kept = saved.get("results", [])
    keys = saved.get("keys", {}) | {ref: sorted(k) for ref, k in ref_keys(report).items()}
    done = {r["id"] for r in kept}
    model = llm.model if args.engine != "template" else "none"
    title = f"{args.cases.stem} · engine {args.engine} · model {model}"

    def save(results: list[dict]) -> None:
        if args.out:
            body = {"summary": summary(kept + results, title), "keys": keys}
            text = json.dumps(body | {"results": kept + results}, indent=1)
            args.out.write_text(text, encoding="utf-8")

    todo = [c for c in cases if c["id"] not in done]
    results = kept + run(ENGINES[args.engine](llm), report, todo, echo=True, after=save)
    print("\n" + summary(results, title))
    return 0


if __name__ == "__main__":
    sys.exit(main())
