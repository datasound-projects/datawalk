"""One export run, the same for the CLI, `Report.export`, the editor, and the hub:
plan (policy, missing preview images, review text), confirm, then write every output."""

from __future__ import annotations

import sys
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING

from . import (
    HTML_BUDGET_BYTES,
    Bundle,
    ExportError,
    ExportOptions,
    Paper,
    chart_images,
    estimate_size,
    format_review,
    prepare,
    review,
    write_html,
    write_pdf,
    write_site,
    write_video,
    write_world,
)

if TYPE_CHECKING:
    from ..reports.report import Report

SUFFIXES = {
    ".html": "html",
    ".htm": "html",
    ".pdf": "pdf",
    ".pptx": "pptx",
    ".glb": "glb",
    ".usdz": "usdz",
    ".mp4": "video",
    ".webm": "video",
}


def target_format(path: str | Path) -> str:
    """The export format that a path asks for: its suffix; no suffix means a static site folder."""
    suffix = Path(path).suffix.lower()
    if suffix in SUFFIXES:
        return SUFFIXES[suffix]
    if not suffix:
        return "site"
    raise ExportError(
        f"{path}: unknown export format {suffix!r}. Use .html, a folder (static site), .pdf, "
        ".pptx, .glb, .usdz, or .mp4."
    )


def _active(report: Report):
    return [v for v in report.visualizations if v.status == "active"]


def resolve_preview_only(report: Report, keys: set[str] | list[str] | tuple[str, ...]) -> set[str]:
    """`all` stands for every chart that has data."""
    keys = set(keys)
    if "all" in keys:
        keys.discard("all")
        keys |= {v.key for v in _active(report) if v.id in report._payloads}
    return keys


def fill_previews(report: Report, keys: set[str]) -> list[str]:
    """Render the missing preview images of these charts with the viewer (headless), so that
    they can leave as images only. Returns the keys that got an image."""
    missing = [v for v in _active(report) if v.key in keys and v.id not in report._previews]
    if not missing:
        return []
    try:
        import playwright  # noqa: F401
    except ImportError:
        names = ", ".join(v.key for v in missing)
        raise ExportError(
            f"These charts have no preview image yet: {names}. Install datawalk[pdf]: DataWalk "
            "then draws them."
        ) from None
    with tempfile.TemporaryDirectory() as tmp:
        page, _ = write_html(prepare(report, ExportOptions()), Path(tmp) / "report.html")
        images = chart_images(page, [v.id for v in missing])
    for v in missing:
        if v.id in images:
            report._previews[v.id] = images[v.id]
            v.source.has_preview = True
    return [v.key for v in missing if v.id in images]


@dataclass
class Plan:
    report: Report
    outputs: list[tuple[str, Path]]  # (format, path)
    options: ExportOptions
    bundle: Bundle
    review: str  # what the author confirms
    notes: list[str]  # policy and preview notes (also part of `review`)
    total: int  # estimated bytes
    paper: Paper = "a4"
    template: Path | None = None
    seconds: float = 6.0


def plan_export(
    report: Report,
    outputs: list[tuple[str, Path]],
    options: ExportOptions,
    *,
    paper: Paper = "a4",
    template: Path | None = None,
    seconds: float = 6.0,
) -> Plan:
    """Check the classification policy, make the preview images that "preview only" needs,
    prepare the data, and write the review. Nothing is written to disk."""
    from ..policy import check_export, policy

    if not outputs:
        raise ExportError(
            "Give at least one output: .html, a folder, .pdf, .pptx, .glb, .usdz, or .mp4."
        )
    if not _active(report):
        raise ExportError(
            f"{report.name}: the report has no visualizations. Add some, then export."
        )
    for fmt, path in outputs:  # find mistakes before the review, not after it
        path = Path(path)
        if path.suffix.lower() == ".dwk" or (report._path and path.resolve() == report._path):
            raise ExportError(f"{path}: an export never replaces a .dwk report. Use another name.")
        if fmt != "site" and path.is_dir():
            raise ExportError(
                f"{path} is a folder. Give a file name, for example {path / 'report'}."
            )
    if template is not None and not Path(template).is_file():
        raise ExportError(f"{template}: no such PowerPoint template")
    from importlib.util import find_spec

    from ..hints import install

    browser = {"pdf", "pptx", "glb", "usdz", "video"} & {fmt for fmt, _ in outputs}
    if browser and find_spec("playwright") is None:
        extra = "pptx" if browser == {"pptx"} else "pdf"
        raise ExportError(
            f"{', '.join(sorted(f.upper() for f in browser))} export needs Playwright: "
            + install(f"datawalk[{extra}]")
        )
    if any(fmt == "pptx" for fmt, _ in outputs) and find_spec("pptx") is None:
        raise ExportError(f"PowerPoint export needs python-pptx: {install('datawalk[pptx]')}")
    notes = []
    options = replace(options, preview_only=resolve_preview_only(report, options.preview_only))
    rule = policy(report.classification)
    if rule and not rule.data:
        # The label allows images only: export every chart (not text) as its image.
        data = {
            v.key
            for v in _active(report)
            if v.id in report._payloads and v.source.chart_type != "text"
        }
        if not data <= options.preview_only:
            options = replace(options, preview_only=options.preview_only | data)
            notes.append(
                "Every chart leaves as its preview image (the classification allows no data)."
            )
    data = {
        v.key for v in _active(report) if v.id in report._payloads and v.source.chart_type != "text"
    }
    for fmt, _ in outputs:
        check_export(
            report.classification,
            fmt,
            options.include_datasets,
            data <= options.preview_only,
            options.watermark,
        )
    drawn = fill_previews(report, options.preview_only)
    if drawn:
        notes.append(f"Drew preview images for: {', '.join(drawn)}.")
    bundle = prepare(report, options)
    single = any(fmt == "html" for fmt, _ in outputs)
    total = estimate_size(bundle, single_file=single)
    lines = [f"Export review: {report.name} (revision {report.revision})"]
    if rule:
        lines.append(f"Classification: {rule.describe()}")
    lines += notes
    # The size matters for files that people send (HTML) or host (site), not for PDF or PPTX.
    sized = any(fmt in ("html", "site") for fmt, _ in outputs)
    lines += ["", format_review(review(report, options), total if sized else None)]
    if options.watermark:
        lines.append(f"Watermark: {options.watermark}")
    if single and total > HTML_BUDGET_BYTES:
        lines.append(
            f"Note: the HTML file will be about {total / 2**20:.0f} MB. Many e-mail services "
            f"accept {HTML_BUDGET_BYTES // 2**20} MB at most (Outlook: 20 MB). Share a link to "
            "a static site, or reduce large charts to their image."
        )
    lines.append("Outputs: " + ", ".join(str(p) for _, p in outputs))
    return Plan(
        report, outputs, options, bundle, "\n".join(lines), notes, total, paper, template, seconds
    )


def confirm(prompt: str = "Export this content? [y/N] ") -> bool:
    """Ask in a terminal or a notebook; elsewhere the caller must confirm explicitly."""
    interactive = sys.stdin is not None and sys.stdin.isatty() or "ipykernel" in sys.modules
    if not interactive:
        raise ExportError("Read the export review above, then confirm it (--yes, or yes=True).")
    try:
        return input(prompt).strip().lower() in ("y", "yes")
    except (EOFError, KeyboardInterrupt):  # Ctrl+D or Ctrl+C: no
        print()
        return False


def run_export(plan: Plan, log=print) -> list[Path]:
    """Write every output of a confirmed plan."""
    written = []
    page: Path | None = None  # the single HTML file that the headless exports open
    with tempfile.TemporaryDirectory() as tmp:

        def viewer_page() -> Path:
            nonlocal page
            page = page or write_html(plan.bundle, Path(tmp) / "report.html")[0]
            return page

        for fmt, path in plan.outputs:
            path = Path(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            if fmt == "html":
                out, size = write_html(plan.bundle, path)
                log(f"Wrote {out} ({size / 2**20:.1f} MB)")
            elif fmt == "site":
                out = write_site(plan.bundle, path)
                log(f"Wrote {out}/ (serve it with any web server)")
            elif fmt == "pdf":
                out = write_pdf(viewer_page(), path, plan.paper)
                log(f"Wrote {out}")
            elif fmt == "pptx":
                from .pptx import needs_images, write_pptx

                images = chart_images(viewer_page(), needs_images(plan.report))
                levels = plan.bundle.data["export"]["levels"]
                out = write_pptx(
                    plan.report, path, images, plan.template, levels, plan.options.watermark
                )
                log(f"Wrote {out}")
            elif fmt == "video":
                out = write_video(viewer_page(), path, plan.seconds, log=log)
                log(f"Wrote {out}")
            else:
                out = write_world(viewer_page(), path, fmt)  # glb, usdz
                log(f"Wrote {out} (a static snapshot)")
            written.append(out)
    return written
