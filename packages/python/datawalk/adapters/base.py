from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from ..core.models import Mode, Source


@dataclass
class Imported:
    source: Source
    payload: dict[str, Any] | None
    preview_png: bytes | None


class Adapter(ABC):
    """Converts one kind of visualization object into a DataWalk record.

    Adapters must not import their plotting library in `supports`. Check
    `sys.modules` first, so that unused libraries never load.
    """

    name: str
    summary: str

    @abstractmethod
    def supports(self, obj: Any) -> bool: ...

    @abstractmethod
    def extract_metadata(self, obj: Any) -> Source:
        """Return title, axes, chart type and aspect. Leave mode and flags at defaults."""

    @abstractmethod
    def serialize(self, obj: Any) -> dict[str, Any] | None:
        """Return a payload (see core.models.Payload), or None when no data is recoverable."""

    @abstractmethod
    def render_preview(self, obj: Any) -> bytes | None:
        """Return PNG bytes, or None when the browser renders the preview."""

    def get_capabilities(self, payload: dict[str, Any] | None) -> Mode:
        if payload is None or payload["kind"] == "svg":  # an SVG is an image: no data values
            return "static"
        return "interactive" if payload["kind"] in ("plotly", "vegalite", "bokeh") else "structured"

    def import_(self, obj: Any) -> Imported:
        source = self.extract_metadata(obj)
        payload = self.serialize(obj)
        preview = self.render_preview(obj)
        source = source.model_copy(
            update={
                "mode": self.get_capabilities(payload),
                "has_payload": payload is not None,
                "has_preview": preview is not None,
            }
        )
        return Imported(source, payload, preview)
