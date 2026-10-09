"""Third-party browser code that comes from the author's Python environment, so that its
version matches the content: BokehJS from the installed bokeh package."""

from __future__ import annotations

from pathlib import Path

BOKEH_FILES = ("bokeh", "bokeh-gl", "bokeh-widgets", "bokeh-tables")


def bokeh_js(version: str) -> dict[str, Path]:
    """The BokehJS files of the installed bokeh package. They must match `version`."""
    try:
        import bokeh
    except ImportError:
        raise LookupError(
            f"Bokeh charts need bokeh=={version}: pip install bokeh=={version}"
        ) from None
    if bokeh.__version__ != version:
        raise LookupError(
            f"A Bokeh chart was made with bokeh {version}, but bokeh {bokeh.__version__} is "
            f"installed. Install bokeh=={version}, or re-run the analysis."
        )
    base = Path(bokeh.__file__).parent / "server" / "static" / "js"
    return {name: base / f"{name}.min.js" for name in BOKEH_FILES}
