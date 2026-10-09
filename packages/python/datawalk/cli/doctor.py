"""datawalk doctor: check the environment, the browser, the GPU tier, and the optional extras."""

from __future__ import annotations

import importlib.util
import os
import platform
import re
import shutil
import sys
from pathlib import Path

from ..hints import install

OK, INFO, FAIL = "ok", "--", "!!"

# Same rules as the viewer (apps/web/src/app/quality.ts): the renderer string decides.
SOFTWARE = re.compile(
    r"swiftshader|llvmpipe|softpipe|microsoft basic render"
    r"|vmware|virtualbox|citrix|parallels display",
    re.I,
)
INTEGRATED = re.compile(r"intel|iris|uhd|hd graphics|mali|adreno|powervr|videocore", re.I)
DISCRETE = re.compile(r"nvidia|geforce|rtx|gtx|quadro|radeon (rx|pro)|amd radeon|apple m\d", re.I)


def gpu_tier(renderer: str) -> str:
    if SOFTWARE.search(renderer):
        return "software rendering: Low, and the flat view opens first"
    if DISCRETE.search(renderer):
        return "High"
    if INTEGRATED.search(renderer):
        return "Low (integrated GPU)"
    return "Medium"


def _has(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


def _browser_and_gpu() -> list[tuple[str, str, str]]:
    if not _has("playwright"):
        return [
            (
                INFO,
                "Browser and GPU",
                f"not checked: needs Playwright: {install('datawalk[pdf]')}. "
                "The viewer lobby shows the GPU tier.",
            )
        ]
    from playwright.sync_api import Error, sync_playwright

    rows = []
    with sync_playwright() as p:
        for channel, name in (
            ("chrome", "Google Chrome"),
            ("msedge", "Microsoft Edge"),
            (None, "Playwright Chromium"),
        ):
            try:
                browser = (
                    p.chromium.launch(
                        channel=channel, args=["--enable-gpu", "--ignore-gpu-blocklist"]
                    )
                    if channel
                    else p.chromium.launch()
                )
            except Error:
                rows.append((INFO, name, "not installed"))
                continue
            page = browser.new_page()
            renderer = page.evaluate(
                """() => { const gl = document.createElement('canvas').getContext('webgl2');
                if (!gl) return null; const ext = gl.getExtension('WEBGL_debug_renderer_info');
                return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) }"""
            )
            rows.append((OK, name, f"version {browser.version}"))
            if renderer:
                rows.append((OK, "GPU (headless)", f"{renderer} → {gpu_tier(renderer)}"))
            else:
                rows.append((FAIL, "WebGL 2", "not available: the viewer opens the flat view"))
            browser.close()
            break
    return rows


def checks() -> list[tuple[str, str, str]]:
    import datawalk
    from datawalk.export import STATIC, VIEWER

    rows = []
    ok_python = sys.version_info >= (3, 11)
    rows.append(
        (OK if ok_python else FAIL, "Python", f"{platform.python_version()} (3.11 or later)")
    )
    rows.append((OK, "DataWalk", f"{datawalk.__version__} at {Path(datawalk.__file__).parent}"))
    built = (STATIC / "index.html").exists() and (STATIC / "library" / "index.json").exists()
    rows.append(
        (
            OK if built else FAIL,
            "Viewer",
            "built" if built else "missing: run `npm run build` in apps/web",
        )
    )
    viewer = (VIEWER / "viewer.js").exists()
    rows.append(
        (
            OK if viewer else FAIL,
            "Export viewer",
            "built" if viewer else "missing: run `npm run build` in apps/web",
        )
    )
    extras = [
        ("matplotlib", "Matplotlib charts", "matplotlib"),
        ("seaborn", "Seaborn charts", "seaborn"),
        ("plotly", "Plotly charts", "plotly"),
        ("pandas", "DataFrames and CSV files", "pandas"),
        ("altair", "Altair (Vega-Lite) charts", "altair"),
        ("bokeh", "Bokeh charts", "bokeh"),
        ("openpyxl", "Excel files (.xlsx)", "datawalk[excel]"),
        ("xlrd", "Excel files (.xls)", "datawalk[excel]"),
        ("nbclient", "notebook --execute", "datawalk[notebook]"),
        ("pptx", "PowerPoint export", "datawalk[pptx]"),
        ("playwright", "PDF, PPTX images, GLB, USDZ, video", "datawalk[pdf]"),
        ("pypdfium2", "PDF pages as charts", "datawalk[pdf-import]"),
    ]
    for module, what, requirement in extras:
        found = _has(module)
        rows.append(
            (
                OK if found else INFO,
                what,
                "installed" if found else f"optional: {install(requirement)}",
            )
        )
    ff = shutil.which("ffmpeg")
    rows.append((OK if ff else INFO, "ffmpeg", ff or "optional: the tour video is WebM without it"))
    policy = os.environ.get("DATAWALK_POLICY")
    if policy:
        try:
            from datawalk.policy import check_labels, labels

            problems = check_labels()
            rows.append(
                (FAIL, "Classification policy", "; ".join(problems))
                if problems
                else (
                    OK,
                    "Classification policy",
                    f"{policy}: {', '.join(labels())} (replaces the built-in labels)",
                )
            )
        except Exception as e:
            rows.append((FAIL, "Classification policy", str(e)))
    else:
        rows.append(
            (INFO, "Classification policy", "built-in labels (set DATAWALK_POLICY for your own)")
        )
    hub = os.environ.get("DATAWALK_HUB")
    if hub:
        import urllib.request

        try:
            with urllib.request.urlopen(f"{hub.rstrip('/')}/login", timeout=10) as res:
                rows.append((OK, "Hub", f"{hub} answers ({res.status})"))
        except Exception as e:
            rows.append((FAIL, "Hub", f"{hub}: {e}"))
    try:
        rows += _browser_and_gpu()
    except Exception as e:  # a broken browser install must not stop the report
        rows.append((FAIL, "Browser", str(e).splitlines()[0]))
    return rows


def main() -> int:
    rows = checks()
    width = max(len(r[1]) for r in rows)
    for mark, name, detail in rows:
        print(f"[{mark}] {name:{width}}  {detail}")
    failed = [r for r in rows if r[0] == FAIL]
    print(
        f"\n{len(failed)} problem(s)."
        if failed
        else "\nEverything that DataWalk needs is in place."
    )
    return 1 if failed else 0
