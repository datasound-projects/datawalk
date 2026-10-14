"""DataWalk AI Guide: a local presentation agent (opt-in: `datawalk demo --guide`).

The guide plans a presentation of a report, narrates it, and answers questions about it. A
local model (Ollama) writes the text; DataWalk computes the facts and their meaning (insights.py,
rules.py), checks every stop and every number against the report, and runs every action itself
(answer.py). Speech and facial animation are optional (voice.py).
Nothing leaves this computer.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any

from . import answer as answering  # not the function: it would hide the module
from .agent import LENGTHS, Plan, model_plan, report_plan
from .llm import LLM, GuideError, Ollama
from .voice import Audio2Face, Kokoro, Voice, speech

if TYPE_CHECKING:
    from ..reports.report import Report

__all__ = ["Guide", "GuideError", "LENGTHS"]


class Guide:
    """The guide of one served report. Thread-safe: the server calls it from a thread pool."""

    def __init__(
        self,
        llm: LLM | None = None,
        voice: Voice | None = None,
        face: Audio2Face | None = None,
        model: str | None = None,  # an Ollama model instead of the default (--model)
    ):
        self.llm = llm if llm is not None else Ollama.from_env(model)
        self.voice = voice if voice is not None else Kokoro()
        self.face = face if face is not None else Audio2Face.from_env()
        # ponytail: one model call at a time; a laptop GPU runs one anyway
        self._model = threading.Lock()
        self._plans: dict[tuple, Plan] = {}
        self._known: tuple[tuple, answering.Knowledge] | None = None

    def warm(self) -> None:
        """Load the voice and the model now (a background thread at server start): the first
        sentence and the first plan then come without the loading time."""
        if self.voice.check()[0]:
            try:
                self.voice.speak("Ready.", "en")
            except GuideError:
                pass
        if self.llm.check()[0] and hasattr(self.llm, "load"):
            self.llm.load()

    def status(self) -> dict[str, Any]:
        llm_ok, llm_detail = self.llm.check()
        voice_ok, voice_detail = self.voice.check()
        face_ok, face_detail = (
            self.face.check()
            if self.face
            else (False, "Audio2Face-3D is not configured: lip sync follows the audio.")
        )
        return {
            "model": {"ok": llm_ok, "detail": llm_detail, "name": self.llm.model},
            "voice": {
                "ok": voice_ok,
                "detail": voice_detail,
                "engine": "kokoro" if voice_ok else "browser",
            },
            "face": {
                "ok": face_ok,
                "detail": face_detail,
                "engine": "audio2face" if face_ok else "lipsync",
            },
            "lengths": list(LENGTHS),
        }

    def plan(self, report: Report, minutes: int, lang: str = "en", refresh: bool = False) -> Plan:
        """A plan for this revision of the report (cached). Without a model: the report's own
        text, with a note that says why."""
        if minutes not in LENGTHS:
            raise GuideError(f"Choose a length of {', '.join(map(str, LENGTHS))} minutes.")
        key = (report.id, report.revision, minutes, lang, self.llm.model)
        if not refresh and key in self._plans:
            return self._plans[key]
        with self._model:
            try:
                plan = model_plan(report, self.llm, minutes, lang)
            except GuideError as e:
                note = f"No AI model: {e} This plan uses the report's own text."
                return report_plan(report, minutes, note, lang)
        # Plans of older revisions go: the report changed.
        self._plans = {k: v for k, v in self._plans.items() if k[:2] == key[:2]}
        self._plans[key] = plan
        return plan

    def ask(self, report: Report, question: str, **context: Any) -> dict[str, Any]:
        """An answer from the report's facts, phrased by the model when it can (answer.py)."""
        with self._model:
            key = (report.id, report.revision)
            if self._known is None or self._known[0] != key:
                self._known = (key, answering.Knowledge.of(report))
            kb = self._known[1]
            return answering.answer(report, kb, self.llm, question, **context).to_json()

    def speech(self, text: str, lang: str = "en") -> dict[str, Any]:
        return speech(self.voice, self.face, text, lang)
