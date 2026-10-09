"""Install commands in messages. "datawalk" on PyPI is another project, so an extra
always comes from the GitHub release wheel, never from a plain `pip install "datawalk[x]"`."""

from __future__ import annotations

import sys
from pathlib import Path


def install(requirement: str) -> str:
    """The command that adds `requirement` ("datawalk[pdf]", "pillow") to the Python
    environment that runs DataWalk: a uv tool, a pipx app, or a normal environment."""
    from . import __version__

    wheel = (
        "https://github.com/datasound-projects/datawalk/releases/download/"
        f"v{__version__}/datawalk-{__version__}-py3-none-any.whl"
    )
    ours = requirement.startswith("datawalk[")
    prefix = Path(sys.prefix)
    if (prefix / "uv-receipt.toml").exists():
        # A tool install replaces the environment: install all extras, keep added packages.
        extra = "" if ours else f' --with "{requirement}"'
        return f'uv tool install "datawalk[all] @ {wheel}"{extra}'
    if (prefix / "pipx_metadata.json").exists():
        if ours:
            return f'pipx install --force "datawalk[all] @ {wheel}"'
        return f'pipx inject datawalk "{requirement}"'
    return f'pip install "{requirement} @ {wheel}"' if ours else f'pip install "{requirement}"'
