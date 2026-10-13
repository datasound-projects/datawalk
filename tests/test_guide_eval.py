"""The guide's evaluation harness (tests/guide_eval.py): its scoring, and its question set."""

import json

import pytest
from guide_eval import CASES, mentions, ref_keys, run, score, summary


@pytest.fixture(scope="module")
def demo():
    from datawalk.demo import build

    return build()


def test_numbers_are_found_as_people_write_them():
    assert mentions("The AUC is 0.51.", 0.5098)  # rounded
    assert mentions("It fell 12.9%.", -0.129)  # a fraction as a percentage, without its sign
    assert mentions("Drawdown: -41.2 %", 41.2)
    assert mentions("Die AUC ist 0,51.", 0.5098)  # a decimal comma
    assert not mentions("The AUC is 0.5098.", 0.5)  # close is not equal
    assert not mentions("It made 412 trades.", 41.2)


def test_the_question_set_matches_the_demo_report(demo):
    cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    assert len({c["id"] for c in cases}) == len(cases) >= 60
    keys = {v.key for v in demo.visualizations}
    for case in cases:
        for key in case.get("charts", []) + [case.get("current"), case.get("inspecting")]:
            assert key is None or key in keys, (case["id"], key)
        if ref := case.get("action", {}).get("ref"):
            assert ref in keys, case["id"]


def test_scoring_rewards_a_complete_answer_and_names_each_failure(demo):
    case = {
        "id": "best",
        "category": "compare",
        "question": "Which model performs best?",
        "charts": ["model_comparison"],
        "numbers": [0.5098],
        "concepts": ["gradient boosting"],
    }
    keys = ref_keys(demo)
    chart = demo.get("model_comparison").id
    good = {
        "answer": "Gradient boosting is best (AUC 0.51).",
        "evidence": [{"ref": chart}],
        "removed": 0,
    }
    assert score(case, good, keys)["score"] == 1
    vague = {"answer": "One model is a bit better.", "evidence": [], "removed": 1}
    result = score(case, vague, keys)
    assert result["failures"] == ["invented", "missing_number", "shallow", "wrong_chart"]
    refusal = score(
        {"id": "x", "category": "abstain", "question": "?", "abstain": True}, good, keys
    )
    assert refusal["failures"] == ["should_abstain"]


def test_a_failing_engine_is_a_result(demo):
    def broken(report, case):
        raise TimeoutError("the model did not answer")

    cases = [{"id": "a", "category": "explain", "question": "?", "concepts": ["x"]}]
    results = run(broken, demo, cases)
    assert results[0]["failures"] == ["error"] and "TimeoutError" in results[0]["error"]
    assert "failures: error 1" in summary(results, "t")
