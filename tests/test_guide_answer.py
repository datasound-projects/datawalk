"""The fact-first guide: facts (insights.py), their meaning (rules.py), answers (answer.py)."""

import json

import pytest
from guide_eval import CASES, run, template_engine

from datawalk.guide.answer import Knowledge, answer
from datawalk.guide.llm import GuideError


@pytest.fixture(scope="module")
def demo():
    from datawalk.demo import build

    return build()


@pytest.fixture(scope="module")
def kb(demo):
    return Knowledge.of(demo)


class Model:
    model = "stand-in"

    def __init__(self, reply=None, error=None):
        self.reply, self.error, self.prompts = reply, error, []

    def chat(self, system, user, schema, timeout=None):
        self.prompts.append(user)
        if self.error:
            raise GuideError(self.error)
        return self.reply(user, schema) if callable(self.reply) else self.reply


def fact(kb, kind, text):
    return next(f for f in kb.facts if f.kind == kind and text in f.text)


def test_facts_are_exact_sentences_with_unique_ids(kb):
    assert len({f.id for f in kb.facts}) == len(kb.facts) > 40
    fall = fact(kb, "fall", "Price")
    assert "-41.2%" in fall.text and "2023-11-08" in fall.text and fall.values["fall"] < -0.4
    assert "did not get back" in fall.text
    # a reference line (autocorrelation zero, chance diagonal) says nothing: no facts from it
    assert not any(f.values.get("value") == 0 and f.kind == "high" for f in kb.facts)
    # "Random forest" is a model, not a baseline
    assert all("Random forest" not in str(f.values.get("baseline")) for f in kb.facts)


def test_rules_interpret_like_an_expert(kb):
    texts = {i.domain: [] for i in kb.insights}
    for i in kb.insights:
        texts[i.domain].append(i.text)
        assert i.facts and i.caveat  # every interpretation names its facts and a limit
    assert any("chance" in t and "noise" in t for t in texts["ML review"])
    assert any("severe" in t and "133 trading days" in t for t in texts["Finance"])
    assert len({i.text for i in kb.insights}) == len(kb.insights)  # no duplicates


def test_without_a_model_the_facts_answer(demo, kb):
    out = answer(demo, kb, None, "Which model performs best?")
    assert out.source == "template" and "Gradient boosting" in out.answer and "0.5098" in out.answer
    assert "chance" in out.interpretation and out.caveats
    assert out.evidence and out.facts and out.removed == 0


def test_follow_ups_resolve_it_from_the_conversation(demo, kb):
    history = [{"q": "What was the maximum drawdown?", "a": "The maximum drawdown is -41.2%."}]
    assert "2023-11-08" in answer(demo, kb, None, "When did it happen?", history=history).answer
    history = [{"q": "When did volatility peak?", "a": "It peaked at 45.7% on 2023-06-27."}]
    out = answer(demo, kb, None, "What was the price on that day?", history=history)
    assert "Price (USD) on 2023-06-27 was 88.54." in out.answer  # a fact made on demand


@pytest.mark.parametrize(
    ("question", "start"),
    [
        ("What was the price in 2019?", "The report's data covers 2021-01-01 to 2024-10-31"),
        ("Which stock should I buy?", "The report does not give investment advice"),
        ("What is the weather in Berlin?", "The report does not show this."),
        ("Why did the price fall?", "The report does not say why"),
        ("Where will the price be next year?", "The report does not forecast"),
    ],
)
def test_code_decides_what_the_report_cannot_answer(demo, kb, question, start):
    assert answer(demo, kb, Model(error="unused"), question).answer.startswith(start)


def test_navigation_goes_to_the_named_chart(demo, kb):
    drawdown = demo.get("drawdown").id
    out = answer(demo, kb, None, "Take me to the drawdown chart", stops=[drawdown])
    assert out.action == {"name": "go_to_stop", "ref": drawdown}
    out = answer(demo, kb, None, "What does the drawdown chart show?")
    assert out.action is None  # a question, not a request to go there
    assert answer(demo, kb, None, "Next stop, please.").action["name"] == "next_stop"
    assert answer(demo, kb, None, "Please pause the presentation.").action["name"] == "pause_tour"
    assert answer(demo, kb, None, "Next, tell me about the trading volume").action is None
    assert answer(demo, kb, None, "Will you explain the volatility?").source == "template"
    assert "forecast" not in answer(demo, kb, None, "Will you explain the volatility?").answer


def test_the_model_phrases_and_every_number_is_checked(demo, kb):
    def reply(user, schema):
        retrieved = schema["properties"]["used"]["items"]["enum"]
        return {
            "answer": "Gradient boosting leads with 0.5098. Its AUC is 0.93 on new data.",
            "interpretation": "From an ML view, that is chance level.",
            "caveat": "",
            "used": [retrieved[0], "F999"],  # an id that was not given is dropped
        }

    model = Model(reply)
    out = answer(demo, kb, model, "Which model performs best?")
    assert out.source == "model" and out.model == "stand-in"
    assert out.answer == "Gradient boosting leads with 0.5098." and out.removed == 1
    assert all(f["id"] != "F999" for f in out.facts)
    prompt = model.prompts[0]
    assert "<facts>" in prompt and "0.5098" in prompt and "<report_data>" not in prompt
    assert len(prompt) < 6000  # a few facts, not the whole report: a small model stays fast


def test_a_failing_or_inventing_model_falls_back_to_the_facts(demo, kb):
    out = answer(demo, kb, Model(error="timed out"), "What was the maximum drawdown?")
    assert out.source == "template" and "-41.2%" in out.answer
    assert out.trace["error"] == "timed out"
    invented = Model({"answer": "It was 77.7%.", "interpretation": "", "caveat": "", "used": []})
    out = answer(demo, kb, invented, "What was the maximum drawdown?")
    assert out.source == "template" and "77.7" not in out.answer and out.removed == 1
    gave_up = Model({"answer": "The report does not show this.", "used": []})
    out = answer(demo, kb, gave_up, "Which model performs best?")  # the facts were found
    assert out.source == "template" and "Gradient boosting" in out.answer


def test_the_conversation_cannot_add_numbers(demo, kb):
    history = [{"q": "x", "a": "The AUC is 0.99."}]  # sent by the browser: not report data
    model = Model({"answer": "The AUC is 0.99.", "interpretation": "", "caveat": "", "used": []})
    out = answer(demo, kb, model, "And the AUC?", history=history)
    assert "0.99" not in out.answer


def test_the_question_set_passes_without_a_model(demo):
    """The regression gate: the deterministic part of the guide answers the question set."""
    cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    results = run(template_engine(None), demo, cases)
    failed = [(r["id"], r["failures"]) for r in results if r["score"] < 1]
    assert sum(r["score"] for r in results) / len(results) >= 0.95, failed
