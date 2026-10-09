"""The report-as-code recipe (examples/ci/report-as-code.sh), end to end against a live hub:
first publish, an editor change, then a scheduled rerun with new data."""

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from datawalk import export as ex

RECIPE = Path(__file__).parents[1] / "examples" / "ci"
pytest.importorskip("datawalk_hub")
pytest.importorskip("playwright")
pytestmark = pytest.mark.skipif(
    not (ex.VIEWER / "viewer.js").exists() or shutil.which("bash") is None,
    reason="needs the web build and bash",
)


@pytest.fixture
def hub(tmp_path):
    import uvicorn
    from datawalk_hub import auth
    from datawalk_hub.app import create_app
    from datawalk_hub.config import Config

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    cfg = Config(
        data_dir=tmp_path / "hub",
        base_url=base,
        secret_key="x" * 32,
        encryption_key=b"k" * 32,
        secure_cookies=False,
    )
    cfg.data_dir.mkdir()
    app = create_app(cfg)
    uid = auth.create_user(app.state.store, "ci@example.org", "CI", "ci-password-123")
    token = auth.new_api_token(app.state.store, uid, "ci")
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.05)
    yield base, token, app
    server.should_exit = True
    thread.join(5)


def run_recipe(work: Path, base: str, token: str, report_id: str = "") -> str:
    env = os.environ | {
        "DATAWALK_HUB": base,
        "DATAWALK_HUB_TOKEN": token,
        "REPORT_ID": report_id,
        "WATERMARK": "CI copy",
        "PATH": f"{Path(sys.executable).parent}{os.pathsep}{os.environ['PATH']}",
    }
    res = subprocess.run(
        ["bash", str(RECIPE / "report-as-code.sh")],
        cwd=work,
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert res.returncode == 0, res.stdout + res.stderr
    return res.stdout


def test_scheduled_rerun_keeps_edits_and_publishes(hub, tmp_path):
    import datawalk as dw
    from datawalk.core.models import ReportModel

    base, token, app = hub
    work = tmp_path / "repo"
    work.mkdir()
    shutil.copy(RECIPE / "analysis.py", work)
    (work / "data.csv").write_text("month,revenue\n2026-01,100\n2026-02,110\n")
    out = run_recipe(work, base, token)  # the first run: no REPORT_ID yet
    report_id = re.search(r"/reports/([0-9a-f]{32})", out).group(1)
    assert (
        "Published revision 1" in out
        and (work / "report.html").exists()
        and (work / "report.pdf").exists()
    )

    # An analyst renames the chart in the editor and publishes the edit.
    edited = dw.Report.load(work / "report.dwk")
    doc = ReportModel.model_validate_json(edited.model_dump_json())
    doc.visualizations[0].overrides.name = "Revenue (board view)"
    edited.apply_presentation(doc)
    edited.save(work / "report.dwk")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "datawalk.cli",
            "publish",
            str(work / "report.dwk"),
            "--hub",
            base,
            "--token",
            token,
        ],
        check=True,
        capture_output=True,
    )

    # The scheduled run: new data, and the edit stays.
    (work / "report.dwk").unlink()
    (work / "data.csv").write_text("month,revenue\n2026-01,100\n2026-02,110\n2026-03,125\n")
    out = run_recipe(work, base, token, report_id)
    assert "Published revision 3" in out and "Total revenue: 210.0 -> 335.0" in out
    store = app.state.store
    latest = dw.serialization.archive.read(
        __import__("io").BytesIO(store.read_archive(report_id, 3))
    )
    assert latest.get("trend").name == "Revenue (board view)"
    changes = json.loads(store.one("SELECT changes FROM revisions WHERE number = 3")["changes"])
    assert changes["kpis"][0]["delta"] == 125
    assert "report.downloaded" in {r["action"] for r in store.all("SELECT action FROM audit")}
