"""Install commands in messages. "datawalk" on PyPI is another project, so an extra always
comes from the GitHub repository (the README's install command), never from a plain
`pip install "datawalk[x]"`."""

from __future__ import annotations

import sys
from pathlib import Path

SOURCE = "git+https://github.com/datasound-projects/datawalk"
CHECKOUT = Path(__file__).resolve().parents[3]  # the repository, when running from a clone


def install(requirement: str) -> str:
    """The command that adds `requirement` ("datawalk[pdf]", "datawalk[voice]", "pillow") to
    the Python environment that runs DataWalk: a uv tool, a clone, a pipx app, or another
    environment. `all` has every extra except `voice` (GPL-3.0 dependencies)."""
    ours = requirement.startswith("datawalk[")
    extras = "all,voice" if ours and "voice" in requirement else "all"
    prefix = Path(sys.prefix)
    if (prefix / "uv-receipt.toml").exists():
        # A tool install replaces the environment: install all extras, keep added packages.
        extra = "" if ours else f' --with "{requirement}"'
        return f'uv tool install "datawalk[{extras}] @ {SOURCE}"{extra}'
    if (CHECKOUT / "pyproject.toml").exists() and (CHECKOUT / "apps" / "web").exists():
        return "uv sync --all-extras" if ours else f'uv pip install "{requirement}"'
    if (prefix / "pipx_metadata.json").exists():
        if ours:
            return f'pipx install --force "datawalk[{extras}] @ {SOURCE}"'
        return f'pipx inject datawalk "{requirement}"'
    return f'pip install "{requirement} @ {SOURCE}"' if ours else f'pip install "{requirement}"'
