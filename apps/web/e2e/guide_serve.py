"""Serve the demo report with the AI guide for browser tests: guide_serve.py PORT [down].

The default uses stand-ins that answer at once and always the same: a scripted model, a voice
that returns short tones (real WAV audio), and an Audio2Face-3D stand-in with frames.
`down`: the real adapters, pointed at nothing: no model, no Kokoro, no Audio2Face.
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


class ScriptedModel:
    """Four stops; answers with one action. One sentence of the plan has a number that the
    report does not contain: the guide must remove it."""

    model = "scripted-test-model"

    def check(self):
        return True, "scripted model (browser tests)"

    def chat(self, system, user, schema):
        def alias(pattern):
            return re.search(
                rf"^(S\d+) \[[^\]]*\]: (?:In dashboard '[^']*'\. )?{pattern}", user, re.M
            )[1]

        summary = alias("Room 'Summary'")
        price, models = alias("Chart 'Historical Price'"), alias("Chart 'Model Comparison'")
        metrics = alias("Chart 'Model Metrics'")
        volatility, drawdown = (
            alias("Chart 'Rolling Volatility'"),
            alias("Chart 'Drawdown from Peak'"),
        )
        if "stops" in schema["properties"]:
            return {
                "stops": [
                    {
                        "ref": price,
                        "narration": "The price moves from 100.4 to 87.5 USD. "
                        "Then it doubles to 999.9 USD.",  # no data supports this sentence
                    },
                    {"ref": summary, "narration": "Welcome to the summary. All data is synthetic."},
                    {"ref": volatility, "narration": "Volatility changes over time."},
                    {"ref": drawdown, "narration": "The drawdown shows the losses from the peak."},
                    {"ref": models, "narration": "The models are close to chance."},
                    {"ref": metrics, "narration": "These are the model metrics."},
                ]
            }
        question = re.search(r"<question>(.*)</question>", user, re.S)[1].lower()
        if "best" in question:
            return {
                "answer": "Gradient boosting has the highest AUC.",
                "interpretation": "",
                "evidence": [models],
                "action": {"name": "go_to_stop", "ref": models},
            }
        if "pause" in question:
            return {
                "answer": "I pause.",
                "interpretation": "",
                "evidence": [],
                "action": {"name": "pause_tour", "ref": ""},
            }
        return {
            "answer": "All data in this report is synthetic.",
            "interpretation": "",
            "evidence": [summary],
            "action": {"name": "none", "ref": ""},
        }


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
    guide = Guide(
        llm=Ollama("http://127.0.0.1:9"), voice=Kokoro(folder=Path(tempfile.mkdtemp())), face=None
    )
else:
    guide = Guide(llm=ScriptedModel(), voice=ToneVoice(), face=FaceStandIn())
uvicorn.run(
    create_app(report, guide=guide), host="127.0.0.1", port=int(sys.argv[1]), log_level="warning"
)
