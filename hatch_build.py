"""Build the viewer during a source install, so that uv alone installs a working DataWalk:

    uv tool install "datawalk[all] @ git+https://github.com/datasound-projects/datawalk"

(and `uv sync` in a clone). Node.js comes from the nodejs-wheel-binaries package, which the
build gets only when the viewer is missing: release wheels, the hub image, CI, and developers
who ran `npm run build` already have it. DATAWALK_SKIP_VIEWER_BUILD=1 skips the build."""

from __future__ import annotations

import os
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

NODE = "nodejs-wheel-binaries>=22"


class ViewerBuild(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def _needed(self) -> bool:
        root = Path(self.root)
        server = root / "packages" / "python" / "datawalk" / "server"
        built = (server / "static" / "index.html").exists() and (
            server / "viewer" / "viewer.js"
        ).exists()
        sources = (root / "apps" / "web" / "package.json").exists()  # not in an sdist
        return not built and sources and not os.environ.get("DATAWALK_SKIP_VIEWER_BUILD")

    def dependencies(self) -> list[str]:
        return [NODE] if self._needed() else []

    def initialize(self, version: str, build_data: dict) -> None:
        if not self._needed():
            return
        from nodejs_wheel import executable  # the build requirement from dependencies()

        node = Path(executable.ROOT_DIR) / ("" if os.name == "nt" else "bin")
        # npm scripts run `node`, `tsc`, and `vite`: this Node must come first on the PATH.
        env = {**os.environ, "PATH": f"{node}{os.pathsep}{os.environ.get('PATH', '')}"}
        web = Path(self.root) / "apps" / "web"
        self.app.display_info("Building the DataWalk viewer (about one minute)...")
        for args in (["ci", "--no-audit", "--no-fund"], ["run", "build"]):
            run = {"cwd": web, "env": env, "capture_output": True, "text": True}
            done = executable.npm(args, return_completed_process=True, **run)
            if done.returncode:
                output = (done.stdout or "") + (done.stderr or "")
                raise RuntimeError(f"npm {' '.join(args)} failed in {web}:\n{output[-4000:]}")
