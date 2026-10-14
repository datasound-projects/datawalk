"""Serve the demo report with the AI guide for browser tests: guide_serve.py PORT [down].

The default uses stand-ins that answer at once and always the same: a scripted model, a voice
that returns short tones (real WAV audio), and an Audio2Face-3D stand-in with frames.
`down`: the real adapters, pointed at nothing: no model, no Kokoro files (offline), no
Audio2Face.
"""

import math
import re
import runpy
import sys
import tempfile
from pathlib import Path

import numpy as np
import uvicorn

from datawalk.guide import Guide
from datawalk.guide.llm import Ollama
from datawalk.guide.voice import Kokoro, wav_bytes, wav_seconds
from datawalk.server import create_app

examples = Path(__file__).resolve().parents[3] / "examples"
report = runpy.run_path(str(examples / "financial_research.py"))["report"]
report.save(Path(tempfile.mkdtemp()) / "e2e-guide.dwk")


LONG = "%s Each part has a name. The lines show the values. The colors mark the series."


class ScriptedModel:
    """A plan of six stops, one sentence of which has a number that the report does not
    contain: the guide must remove it. Answers name the facts that they use."""

    model = "scripted-test-model"

    def check(self):
        return True, "scripted model (browser tests)"

    def chat(self, system, user, schema, timeout=None):
        if "stops" in schema["properties"]:
            return {"stops": self._plan(user)}
        question = re.search(r"<question>(.*)</question>", user, re.S)[1].lower()
        ids = schema["properties"]["used"]["items"]["enum"]
        if "model" in question:
            about = [i for i in ids if re.search(rf"^{i} \[Model Comparison\]", user, re.M)]
            return {"answer": "Gradient boosting has the highest AUC.", "used": about}
        return {"answer": "All data in this report is synthetic.", "used": []}

    def _plan(self, user):
        def alias(pattern):
            return re.search(
                rf"^(S\d+) \[[^\]]*\]: (?:In dashboard '[^']*'\. )?{pattern}", user, re.M
            )[1]

        return [
            {
                "ref": alias("Chart 'Historical Price'"),
                "narration": "The price moves from 100.4 to 87.5 USD. "
                "Then it doubles to 999.9 USD.",  # no data supports this sentence
            },
            {
                "ref": alias("Room 'Summary'"),
                "narration": "Welcome to the summary. All data is synthetic.",
            },
            # Several sentences each: on a slow machine the tour must outlast the test.
            {
                "ref": alias("Chart 'Rolling Volatility'"),
                "narration": LONG % "Volatility changes over time.",
            },
            {
                "ref": alias("Chart 'Drawdown from Peak'"),
                "narration": LONG % "The drawdown shows the losses.",
            },
            {
                "ref": alias("Chart 'Model Comparison'"),
                "narration": LONG % "The models are close to chance.",
            },
            {
                "ref": alias("Chart 'Model Metrics'"),
                "narration": LONG % "These are the model metrics.",
            },
        ]


class ToneVoice:
    """A short tone per sentence: real audio for WebAudio, the analyser, and the timing."""

    def check(self):
        return True, "tone voice (browser tests)"

    def speak(self, text, lang):
        seconds = 0.8 + 0.03 * len(text)  # long enough for the test to act during a sentence
        t = np.arange(int(24000 * seconds)) / 24000
        return wav_bytes(0.2 * np.sin(2 * math.pi * 220 * t), 24000)


class FaceStandIn:
    """Frames like Audio2Face-3D sends them: ARKit names, 30 per second."""

    def check(self):
        return True, "Audio2Face-3D stand-in (browser tests)"

    def animate(self, wav):
        n = int(wav_seconds(wav) * 30)
        names = ["jawOpen", "mouthFunnel", "eyeBlinkLeft", "eyeBlinkRight"]
        return {
            "fps": 30,
            "names": names,
            "frames": [[abs(math.sin(i / 3)), 0.1, 0, 0] for i in range(n)],
        }


if sys.argv[2:] == ["down"]:
    import datawalk.guide.voice as voice

    voice.RELEASE = "http://127.0.0.1:9/"  # offline: the voice files cannot download
    guide = Guide(
        llm=Ollama("http://127.0.0.1:9"), voice=Kokoro(folder=Path(tempfile.mkdtemp())), face=None
    )
else:
    guide = Guide(llm=ScriptedModel(), voice=ToneVoice(), face=FaceStandIn())
uvicorn.run(
    create_app(report, guide=guide), host="127.0.0.1", port=int(sys.argv[1]), log_level="warning"
)
