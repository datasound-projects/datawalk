from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import TypeAdapter


def schema() -> dict:
    from ..core.models import SCHEMA_VERSION, Payload, ReportModel

    return {
        "schema_version": SCHEMA_VERSION,
        "report": ReportModel.model_json_schema(),
        "payload": TypeAdapter(Payload).json_schema(),
    }


def main(argv: list[str] | None = None) -> None:
    from .. import __version__

    # A Windows console or a redirected output can use a code page without "→" or "·".
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    parser = argparse.ArgumentParser(
        prog="datawalk",
        description="DataWalk: walk through your data. Share it. Explore your insights.",
        epilog="Start with: datawalk demo",
    )
    parser.add_argument("--version", action="version", version=f"datawalk {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)
    de = sub.add_parser("demo", help="build the demo report (synthetic data) and open the editor")
    de.add_argument(
        "--save", type=Path, default=Path("datawalk-demo.dwk"), help="file (default: %(default)s)"
    )
    de.add_argument("--port", type=int, help="port (default: a free port)")
    de.add_argument("--no-browser", action="store_true", help="print the address only")
    de.add_argument("--view-only", action="store_true", help="the stakeholder view, no editor")
    de.add_argument("--guide", action="store_true", help="add the AI guide (local model, Ollama)")
    op = sub.add_parser(
        "open", help="open a report (.dwk) or a Jupyter notebook (.ipynb) in the browser"
    )
    op.add_argument("path", type=Path, help="a .dwk report or an .ipynb notebook")
    op.add_argument("--port", type=int, help="port (default: a free port)")
    op.add_argument("--no-browser", action="store_true", help="print the address only")
    op.add_argument("--edit", action="store_true", help="open the editor; edits save to the file")
    op.add_argument("--execute", action="store_true", help="notebooks: run the notebook first")
    op.add_argument("--guide", action="store_true", help="add the AI guide (local model, Ollama)")
    ex = sub.add_parser(
        "export",
        help="export a report for people without Python (default: one HTML file)",
        description="Every export is a data release: DataWalk shows the export review first.",
    )
    ex.add_argument("path", type=Path, help="the .dwk report")
    ex.add_argument(
        "--html", type=Path, nargs="?", const=True, help="one self-contained HTML file (default)"
    )
    ex.add_argument("--site", type=Path, help="a folder for a static web server")
    ex.add_argument(
        "--pdf",
        type=Path,
        nargs="?",
        const=True,
        help="the flat view as PDF (needs datawalk[pdf])",
    )
    ex.add_argument(
        "--paper", type=str.lower, choices=["a4", "letter"], default="a4", help="PDF paper size"
    )
    ex.add_argument("--pptx", type=Path, nargs="?", const=True, help="one slide per tour stop")
    ex.add_argument("--template", type=Path, help="PowerPoint template (.potx or .pptx)")
    ex.add_argument("--glb", type=Path, nargs="?", const=True, help="3D world file (static)")
    ex.add_argument("--usdz", type=Path, nargs="?", const=True, help="3D world file for Quick Look")
    ex.add_argument(
        "--video", type=Path, nargs="?", const=True, help="the guided tour as MP4 (ffmpeg)"
    )
    ex.add_argument("--seconds", type=float, default=6.0, help="video: seconds per stop")
    ex.add_argument(
        "--preview-only",
        nargs="+",
        default=[],
        metavar="KEY",
        help="charts to export as their image only; `all` for every chart",
    )
    ex.add_argument("--datasets", action="store_true", help="include attached datasets (CSV files)")
    ex.add_argument(
        "--watermark", default="", help="recipient watermark, for example 'Board copy: J. Smith'"
    )
    ex.add_argument("--yes", action="store_true", help="accept the export review without a prompt")
    im = sub.add_parser("import", help="build a .dwk report from a Jupyter notebook")
    im.add_argument("notebook", type=Path, help="the .ipynb notebook")
    im.add_argument("-o", "--output", type=Path, help="archive to write (default: <notebook>.dwk)")
    im.add_argument("--name", help="report name (default: the first H1 heading)")
    im.add_argument("--execute", action="store_true", help="run the notebook first (nbclient)")
    im.add_argument("--timeout", type=int, default=600, help="execution timeout in seconds")
    im.add_argument("--open", action="store_true", help="open the report in the browser afterwards")
    im.add_argument("--edit", action="store_true", help="with --open: open the editor")
    pb = sub.add_parser("publish", help="publish a .dwk report to a DataWalk Hub")
    pb.add_argument("path", type=Path, help="the .dwk report")
    pb.add_argument(
        "--hub",
        default=os.environ.get("DATAWALK_HUB"),
        help="hub address, for example https://hub.example.internal (default: DATAWALK_HUB)",
    )
    pb.add_argument("--token", help="API token (default: the DATAWALK_HUB_TOKEN variable)")
    pl = sub.add_parser("pull", help="download the latest revision of a report from a hub")
    pl.add_argument("report_id", help="the report id (in the hub address of the report)")
    pl.add_argument(
        "--hub", default=os.environ.get("DATAWALK_HUB"), help="hub address (default: DATAWALK_HUB)"
    )
    pl.add_argument("--token", help="API token (default: the DATAWALK_HUB_TOKEN variable)")
    pl.add_argument("-o", "--output", type=Path, help="file to write (default: <report id>.dwk)")
    sub.add_parser("doctor", help="check the environment, browser, GPU tier, and optional extras")
    sub.add_parser("adapters", help="list supported visualization objects")
    sc = sub.add_parser("schema", help="write the report JSON schema")
    sc.add_argument("out", type=Path, help="the JSON file to write")
    args = parser.parse_args(argv)
    try:
        code = COMMANDS[args.command](args)
    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)
        code = 130
    except (OSError, ValueError, ImportError, EOFError) as e:
        if os.environ.get("DATAWALK_DEBUG"):
            raise
        code = _failed(e)  # a clear message, no traceback (DATAWALK_DEBUG=1 shows it)
    sys.exit(code)


def doctor(args: argparse.Namespace) -> int:
    from .doctor import main as run

    return run()


def list_adapters(args: argparse.Namespace) -> int:
    from ..adapters import adapters

    for a in adapters():
        print(f"{a.name:14} {a.summary}")
    return 0


def write_schema(args: argparse.Namespace) -> int:
    args.out.write_text(json.dumps(schema(), indent=2) + "\n", encoding="utf-8")
    return 0


def demo(args: argparse.Namespace) -> int:
    """Build the demo report, save it (a rerun keeps the editor changes), and open it."""
    os.environ.setdefault("MPLBACKEND", "Agg")  # no plot windows
    try:
        from ..demo import build
    except ImportError as e:
        from ..hints import install

        raise ImportError(
            f"The demo needs the plotting libraries ({e.name}): {install('datawalk[charts]')}"
        ) from None
    print("Building the demo report (synthetic data)...", flush=True)
    report = build()
    print(f"Saved {report.save(args.save)}", flush=True)
    report.show(
        port=args.port,
        open_browser=not args.no_browser,
        block=True,
        edit=not args.view_only,
        guide=args.guide,
    )
    return 0


def open_report(args: argparse.Namespace) -> int:
    """Open a .dwk report, or import a notebook into <notebook>.dwk and open that."""
    from ..importers import NotebookError
    from ..reports.report import MergeConflict, Report
    from ..serialization.archive import ArchiveError

    try:
        if args.path.suffix.lower() == ".ipynb":
            report = _import(args.path, args.path.with_suffix(".dwk"), None, args.execute, 600)
            if report is None:
                return 1
        else:
            report = Report.load(args.path)
    except (ArchiveError, NotebookError, MergeConflict, OSError) as e:
        return _failed(e)
    report.show(
        port=args.port,
        open_browser=not args.no_browser,
        block=True,
        edit=args.edit,
        guide=args.guide,
    )
    return 0


def export(args: argparse.Namespace) -> int:
    from .. import export as ex
    from ..policy import PolicyError
    from ..reports.report import Report
    from ..serialization.archive import ArchiveError

    def named(fmt: str, value: Path | bool) -> Path:
        """The output file: <report>.<format> by default; a name without a suffix gets one."""
        suffix = ".mp4" if fmt == "video" else f".{fmt}"
        if value is True:
            return args.path.with_suffix(suffix)
        if value.is_dir():  # a folder: the file goes into it
            return value / args.path.with_suffix(suffix).name
        return value if value.suffix else value.with_suffix(suffix)

    outputs = [
        (fmt, named(fmt, value))
        for fmt in ("html", "pdf", "pptx", "glb", "usdz", "video")
        if (value := getattr(args, fmt))
    ]
    if args.site:
        outputs.append(("site", args.site))
    if not outputs:
        outputs = [("html", args.path.with_suffix(".html"))]  # the most common export
    try:
        report = Report.load(args.path)
        options = ex.ExportOptions(set(args.preview_only), args.datasets, args.watermark)
        plan = ex.plan_export(
            report, outputs, options, paper=args.paper, template=args.template, seconds=args.seconds
        )
        print(plan.review, flush=True)
        if not args.yes and not ex.confirm("\nExport this content? [y/N] "):
            print("Export cancelled.")
            return 1
        ex.run_export(plan)
    except (ex.ExportError, PolicyError, ArchiveError, ImportError, OSError) as e:
        return _failed(e)
    return 0


def _import(notebook: Path, out: Path, name: str | None, execute: bool, timeout: int):
    """Import a notebook into `out` (an existing file keeps its editor changes). Prints what
    happened; returns None when the notebook has nothing to show."""
    from ..reports.report import Report

    report = Report.from_notebook(notebook, name, execute, timeout)
    log = report._import_log
    active = [v for v in report.visualizations if v.status == "active"]
    if not active:
        found = ", ".join(f"{n} {k}" for k, n in sorted(log.get("skipped", {}).items()))
        print(
            f"error: {notebook} has no charts, tables, or images that DataWalk can show (it has: "
            f"{found})."
            if found
            else f"error: {notebook} has no outputs that DataWalk can show. Run the notebook and "
            "save it, or add --execute.",
            file=sys.stderr,
        )
        return None
    report.save(out)
    rooms = ", ".join(r.name for r in report.rooms)
    print(f"Wrote {out}: {len(active)} items in {len(report.rooms)} rooms ({rooms})")
    if log.get("skipped"):
        kinds = ", ".join(f"{n} {k}" for k, n in sorted(log["skipped"].items()))
        print(f"Not shown: {kinds}")
    for warning in log.get("warnings", []):
        print(f"warning: {warning}")
    return report


def import_notebook(args: argparse.Namespace) -> int:
    from ..importers import NotebookError
    from ..reports.report import MergeConflict

    out = args.output or args.notebook.with_suffix(".dwk")
    try:
        report = _import(args.notebook, out, args.name, args.execute, args.timeout)
    except (NotebookError, MergeConflict, OSError) as e:
        return _failed(e)
    if report is None:
        return 1
    if args.open:
        report.show(open_browser=True, block=True, edit=args.edit)
    return 0


def _failed(e: BaseException) -> int:
    sys.stdout.flush()  # in logs, the error comes after what the command printed
    if isinstance(e, OSError) and e.filename:
        what = "no such file" if isinstance(e, FileNotFoundError) else (e.strerror or "").lower()
        print(f"error: {e.filename}: {what}", file=sys.stderr)
    else:
        print(f"error: {e}", file=sys.stderr)
    return 1


def _hub(args: argparse.Namespace) -> tuple[str, str] | None:
    if not args.hub:
        print("error: give --hub or set DATAWALK_HUB (the hub address)", file=sys.stderr)
        return None
    token = args.token or os.environ.get("DATAWALK_HUB_TOKEN")
    if not token:
        print("error: give --token or set DATAWALK_HUB_TOKEN (hub Account page)", file=sys.stderr)
        return None
    hub = args.hub.rstrip("/")
    url = urlsplit(hub)
    local = url.scheme == "http" and url.hostname in ("127.0.0.1", "localhost", "::1")
    if not (url.scheme == "https" or local) or url.username or url.password:
        print("error: use https:// (the token and the report travel to the hub)", file=sys.stderr)
        return None
    return hub, token


def pull(args: argparse.Namespace) -> int:
    """Download the latest revision, with its presentation edits, so that a rerun keeps them."""
    import urllib.error
    import urllib.request

    conn = _hub(args)
    if conn is None:
        return 2
    hub, token = conn
    out = args.output or Path(f"{args.report_id}.dwk")
    url = f"{hub}/api/reports/{args.report_id}/archive"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(request, timeout=300) as res:
            data, revision = res.read(), res.headers.get("X-Revision")
    except urllib.error.HTTPError as e:
        print(
            f"error: the hub answered {e.code}: {e.read().decode(errors='replace')}",
            file=sys.stderr,
        )
        return 1
    except urllib.error.URLError as e:
        print(f"error: cannot reach {hub}: {e.reason}", file=sys.stderr)
        return 1
    out.write_bytes(data)
    print(f"Wrote {out} (revision {revision})")
    return 0


def publish(args: argparse.Namespace) -> int:
    """Upload the archive. The hub checks it and stores it as a new revision."""
    import urllib.error
    import urllib.request

    conn = _hub(args)
    if conn is None:
        return 2
    hub, token = conn
    request = urllib.request.Request(
        f"{hub}/api/publish",
        data=args.path.read_bytes(),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/octet-stream"},
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as res:
            body = json.loads(res.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        print(f"error: the hub answered {e.code}: {detail}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"error: cannot reach {hub}: {e.reason}", file=sys.stderr)
        return 1
    c = body["changes"]
    print(f"Published revision {body['revision']}: {body['url']}")
    print(f"  added {len(c['added'])}, removed {len(c['removed'])}, updated {len(c['updated'])}")
    for k in c["kpis"]:
        print(f"  {k['name']}: {k['before']} -> {k['after']}")
    return 0


COMMANDS = {
    "demo": demo,
    "open": open_report,
    "export": export,
    "import": import_notebook,
    "publish": publish,
    "pull": pull,
    "doctor": doctor,
    "adapters": list_adapters,
    "schema": write_schema,
}
