"""Ollama adapter: one JSON chat call, with a JSON schema that constrains the answer.

The report stays on this computer: the adapter talks only to a loopback address, unless
DATAWALK_GUIDE_ALLOW_REMOTE=1 permits another host (for example an Ollama server on the
same private network). Standard library only: no new dependency.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlsplit

DEFAULT_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "nemotron-3-nano:4b"
LOOPBACK = {"127.0.0.1", "localhost", "::1"}
# The same options for every request: a different context size makes Ollama load the model
# again, and the prompt cache (the report data that every request starts with) is lost.
OPTIONS = {"temperature": 0.2, "num_ctx": 16384}


class GuideError(ValueError):
    """A clear, user-facing reason why the guide cannot do something (the command line prints
    it as an error, without a traceback)."""


class LLM(Protocol):
    model: str

    def load(self) -> None:
        """Load the model into memory (an empty generate request), and keep it there."""
        try:
            body = {"model": self.model, "keep_alive": "15m", "options": OPTIONS}
            self._request("/api/generate", body, timeout=120)
        except GuideError:
            pass

    def chat(self, system: str, user: str, schema: dict[str, Any]) -> dict[str, Any]: ...

    def check(self) -> tuple[bool, str]: ...


def local_url(url: str, variable: str) -> str:
    """The URL without a trailing slash; only http(s) to this computer unless allowed."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise GuideError(f"{variable} must be an http:// address, not {url!r}.")
    if parts.username or parts.password:
        raise GuideError(f"{variable} must not contain a user name or password.")
    if parts.hostname not in LOOPBACK and os.environ.get("DATAWALK_GUIDE_ALLOW_REMOTE") != "1":
        raise GuideError(
            f"{variable} points to {parts.hostname}: the report would leave this computer. "
            "Use a local address, or set DATAWALK_GUIDE_ALLOW_REMOTE=1."
        )
    return url.rstrip("/")


@dataclass
class Ollama:
    url: str = DEFAULT_URL
    model: str = DEFAULT_MODEL
    timeout: float = 300.0  # a 10-minute plan on a laptop CPU takes a few minutes

    @classmethod
    def from_env(cls) -> Ollama:
        return cls(
            local_url(os.environ.get("DATAWALK_OLLAMA_URL", DEFAULT_URL), "DATAWALK_OLLAMA_URL"),
            os.environ.get("DATAWALK_GUIDE_MODEL", DEFAULT_MODEL),
        )

    def _request(self, path: str, body: dict | None = None, timeout: float = 5.0) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            self.url + path, data, {"Content-Type": "application/json"} if data else {}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            if e.code == 404 and "not found" in detail:
                raise GuideError(self._missing()) from None
            raise GuideError(f"Ollama answered {e.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            reason = getattr(e, "reason", e)
            raise GuideError(
                f"Cannot reach Ollama at {self.url} ({reason}). Start it with `ollama serve`."
            ) from None

    def _missing(self) -> str:
        return f"The model {self.model} is not installed. Run `ollama pull {self.model}`."

    def check(self) -> tuple[bool, str]:
        try:
            tags = self._request("/api/tags")
        except GuideError as e:
            return False, str(e)
        names = {m.get("name") for m in tags.get("models", [])}
        if self.model not in names and f"{self.model}:latest" not in names:
            return False, self._missing()
        return True, f"{self.model} at {self.url}"

    def load(self) -> None:
        """Load the model into memory (an empty generate request), and keep it there."""
        try:
            body = {"model": self.model, "keep_alive": "15m", "options": OPTIONS}
            self._request("/api/generate", body, timeout=120)
        except GuideError:
            pass

    def chat(self, system: str, user: str, schema: dict[str, Any]) -> dict[str, Any]:
        body = {
            "model": self.model,
            "stream": False,
            "think": False,  # a reasoning trace costs minutes on a laptop; the schema guides
            "format": schema,
            "options": OPTIONS,
            "keep_alive": "15m",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        reply = self._request("/api/chat", body, timeout=self.timeout)
        content = reply.get("message", {}).get("content", "")
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            raise GuideError(
                "The model did not answer in the expected format. Try again."
            ) from None
        if not isinstance(data, dict):
            raise GuideError("The model did not answer in the expected format. Try again.")
        return data
