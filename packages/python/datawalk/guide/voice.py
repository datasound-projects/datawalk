"""Speech (Kokoro-82M, local) and facial animation (NVIDIA Audio2Face-3D, optional).

Both are optional. Without Kokoro the viewer speaks with the browser's own voices; without
Audio2Face the avatar's mouth follows the loudness of the audio that plays.

Kokoro runs with kokoro-onnx and two model files (about 120 MB, not part of DataWalk):
    pip install kokoro-onnx
    DATAWALK_KOKORO_DIR (default ~/.cache/datawalk/kokoro) holds kokoro-v1.0.int8.onnx (or
    kokoro-v1.0.onnx) and voices-v1.0.bin. docs/guide.md has the download commands.

Audio2Face-3D is a C++/CUDA SDK for Linux and Windows with an NVIDIA GPU. DataWalk does not
link it. A separate local bridge process (not part of DataWalk) runs the SDK and answers
    POST {DATAWALK_A2F_URL}/animate   body: audio/wav (mono, 16-bit)
    200 {"fps": 30, "names": ["jawOpen", ...], "frames": [[0.1, ...], ...]}
with ARKit blendshape names and one weight row per frame (0..1).
"""

from __future__ import annotations

import base64
import io
import json
import os
import threading
import urllib.error
import urllib.request
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .llm import GuideError, local_url

MAX_TEXT = 2000  # characters per speech request: one sentence, however long
MAX_FACE_SECONDS = 120
MAX_SHAPES = 64


class Voice(Protocol):
    def check(self) -> tuple[bool, str]: ...

    def speak(self, text: str, lang: str) -> bytes:
        """A WAV file (mono, 16-bit PCM)."""
        ...


def wav_bytes(samples: Any, rate: int) -> bytes:
    """Float samples (-1..1) as a 16-bit mono WAV file."""
    import numpy as np

    pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1, 1) * 32767).astype("<i2")
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return out.getvalue()


def wav_seconds(wav: bytes) -> float:
    with wave.open(io.BytesIO(wav)) as w:
        return w.getnframes() / w.getframerate()


class Kokoro:
    """Kokoro-82M through kokoro-onnx. Loads the model on first use (about 1 s)."""

    LANGS = {"en": "en-us"}  # Kokoro v1.0 has no German voice: German uses the browser

    def __init__(self, folder: Path | None = None, voice: str | None = None):
        default = Path.home() / ".cache" / "datawalk" / "kokoro"
        self.folder = Path(folder or os.environ.get("DATAWALK_KOKORO_DIR") or default)
        self.voice = voice or os.environ.get("DATAWALK_KOKORO_VOICE", "af_heart")
        self._engine = None
        self._lock = threading.Lock()

    def _files(self) -> tuple[Path, Path] | None:
        model = next(
            (
                p
                for n in ("kokoro-v1.0.int8.onnx", "kokoro-v1.0.onnx", "kokoro-v1.0.fp16.onnx")
                if (p := self.folder / n).is_file()
            ),
            None,
        )
        voices = self.folder / "voices-v1.0.bin"
        return (model, voices) if model and voices.is_file() else None

    def check(self) -> tuple[bool, str]:
        try:
            import kokoro_onnx  # noqa: F401
        except ImportError:
            from ..hints import install

            how = install("datawalk[voice]")
            return False, f"Kokoro is not installed ({how}). The browser voice speaks."
        if self._files() is None:
            return False, f"The Kokoro model files are not in {self.folder} (docs/guide.md)."
        return True, f"Kokoro-82M ({self.voice})"

    def speak(self, text: str, lang: str) -> bytes:
        if lang not in self.LANGS:
            raise GuideError(f"Kokoro has no voice for '{lang}'.")
        with self._lock:  # one synthesis at a time; the ONNX session is large
            if self._engine is None:
                ok, why = self.check()
                if not ok:
                    raise GuideError(why)
                from kokoro_onnx import Kokoro as Engine

                model, voices = self._files()  # type: ignore[misc]
                self._engine = Engine(str(model), str(voices))
            samples, rate = self._engine.create(
                text, voice=self.voice, speed=1.0, lang=self.LANGS[lang]
            )
        return wav_bytes(samples, rate)


@dataclass
class Audio2Face:
    """Client of a local Audio2Face-3D bridge (see the module text)."""

    url: str
    timeout: float = 30.0

    @classmethod
    def from_env(cls) -> Audio2Face | None:
        url = os.environ.get("DATAWALK_A2F_URL")
        return cls(local_url(url, "DATAWALK_A2F_URL")) if url else None

    def check(self) -> tuple[bool, str]:
        try:
            with urllib.request.urlopen(self.url + "/health", timeout=3) as res:
                return res.status == 200, f"Audio2Face-3D bridge at {self.url}"
        except (urllib.error.URLError, OSError) as e:
            return (
                False,
                f"Cannot reach the Audio2Face-3D bridge at {self.url} ({getattr(e, 'reason', e)}).",
            )

    def animate(self, wav: bytes) -> dict[str, Any]:
        request = urllib.request.Request(self.url + "/animate", wav, {"Content-Type": "audio/wav"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as res:
                data = json.loads(res.read(8 * 2**20))
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise GuideError(f"Audio2Face-3D failed: {getattr(e, 'reason', e)}") from None
        return validate_face(data, wav_seconds(wav))


def validate_face(data: Any, seconds: float) -> dict[str, Any]:
    """Accept only the documented shape: names, a frame rate, and rows of weights 0..1."""
    if not isinstance(data, dict):
        raise GuideError("Audio2Face-3D answered in an unknown format.")
    names, frames, fps = data.get("names"), data.get("frames"), data.get("fps")
    if not (isinstance(fps, (int, float)) and 1 <= fps <= 120):
        raise GuideError("Audio2Face-3D answered without a valid frame rate.")
    if not (
        isinstance(names, list)
        and 0 < len(names) <= MAX_SHAPES
        and all(isinstance(n, str) and len(n) < 64 for n in names)
    ):
        raise GuideError("Audio2Face-3D answered without valid blendshape names.")
    limit = int(fps * min(seconds + 1, MAX_FACE_SECONDS))
    if not isinstance(frames, list) or len(frames) > limit:
        raise GuideError("Audio2Face-3D answered with too many frames.")
    rows = []
    for row in frames:
        if not (isinstance(row, list) and len(row) == len(names)):
            raise GuideError("Audio2Face-3D answered with malformed frames.")
        rows.append(
            [
                round(min(1.0, max(0.0, float(v))), 3) if isinstance(v, (int, float)) else 0.0
                for v in row
            ]
        )
    return {"fps": fps, "names": names, "frames": rows}


def speech(voice: Voice, face: Audio2Face | None, text: str, lang: str) -> dict[str, Any]:
    """One clip: the audio, its length, and the face animation (None: the viewer animates)."""
    text = " ".join(text.split())[:MAX_TEXT]
    if not text:
        raise GuideError("Nothing to say.")
    wav = voice.speak(text, lang)
    animation = None
    if face is not None:
        try:
            animation = face.animate(wav)
        except GuideError:
            animation = None  # the viewer's lip sync takes over; speech must not stop
    return {
        "audio": base64.b64encode(wav).decode(),
        "seconds": round(wav_seconds(wav), 3),
        "face": animation,
    }
