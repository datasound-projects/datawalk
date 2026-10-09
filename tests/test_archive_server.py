import json
import zipfile

import matplotlib.pyplot as plt
import pandas as pd
import plotly.express as px
import pytest
import seaborn as sns
from fastapi.testclient import TestClient

import datawalk as dw
from datawalk.cli import schema
from datawalk.serialization.archive import ENTRY
from datawalk.server import create_app

SCHEMA_FILE = "packages/schema/generated/report.schema.json"


@pytest.fixture
def mixed_report():
    r = dw.Report("Mixed")
    fig, ax = plt.subplots()
    ax.plot([1, 2, 3], [3, 1, 2])
    r.add(fig, key="mpl", room="One", description="desc")
    df = pd.DataFrame({"g": ["a", "a", "b", "b"], "x": [1, 2, 1, 2], "y": [1, 2, 2, 1]})
    r.add(sns.relplot(df, x="x", y="y", col="g"), key="sns", room="One")
    r.add(px.line(x=[1, 2], y=[2, 1], title="Plotly"), key="ply", room="Two")
    r.get("ply").overrides.explanation.findings = ["Falls"]
    return r


def test_round_trip_preserves_everything(mixed_report, tmp_path):
    path = mixed_report.save(tmp_path / "r.dwk")
    loaded = dw.Report.load(path)
    assert loaded.model_dump() == mixed_report.model_dump()
    assert loaded._payloads == mixed_report._payloads
    assert loaded._previews == mixed_report._previews
    assert loaded.revision == 1 and loaded.get("ply").overrides.explanation.findings == ["Falls"]


def _zip(tmp_path, entries):
    path = tmp_path / "bad.dwk"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return path


def test_archive_rejects_unsafe_content(mixed_report, tmp_path):
    manifest = json.dumps({"format": "datawalk-archive", "schema_version": "0.2.0"})
    good = mixed_report.model_dump_json()
    cases = {
        "traversal": {"manifest.json": manifest, "report.json": good, "../evil.json": "{}"},
        "bomb": {
            "manifest.json": manifest,
            "report.json": good,
            f"visualizations/{'a' * 32}.json": "0" * 50_000_000,
        },
        "orphan": {
            "manifest.json": manifest,
            "report.json": good,
            f"previews/{'b' * 32}.png": b"\x89PNG\r\n\x1a\n",
        },
        "pickle": {"manifest.json": manifest, "report.json": b"\x80\x04K\x01."},
        "version": {"manifest.json": manifest.replace("0.2.0", "0.1.0"), "report.json": good},
    }
    for name, entries in cases.items():
        with pytest.raises(ValueError):
            dw.Report.load(_zip(tmp_path, entries))
        print("rejected", name)
    vid = mixed_report.visualizations[0].id
    not_png = {"manifest.json": manifest, "report.json": good, f"previews/{vid}.png": b"<svg>"}
    with pytest.raises(dw.ArchiveError, match="not a PNG"):
        dw.Report.load(_zip(tmp_path, not_png))
    assert ENTRY.fullmatch("visualizations/../../x.json") is None


def test_server_serves_report_and_rejects_foreign_hosts(mixed_report):
    client = TestClient(create_app(mixed_report), base_url="http://127.0.0.1")
    report = client.get("/api/report").json()
    assert [r["name"] for r in report["rooms"]] == ["One", "Two"]
    mpl, _, ply = (v["id"] for v in report["visualizations"])
    assert client.get(f"/api/visualizations/{mpl}/preview.png").content.startswith(b"\x89PNG")
    assert client.get(f"/api/visualizations/{ply}/payload").json()["kind"] == "plotly"
    assert client.get(f"/api/visualizations/{ply}/preview.png").status_code == 404
    assert "default-src 'self'" in client.get("/api/report").headers["content-security-policy"]
    assert client.post("/api/report").status_code == 405  # viewer is read-only
    evil = TestClient(create_app(mixed_report), base_url="http://attacker.example")
    assert evil.get("/api/report").status_code == 400


def test_committed_schema_is_current():
    with open(SCHEMA_FILE) as f:
        assert json.load(f) == json.loads(json.dumps(schema())), (
            "Run: uv run datawalk schema " + SCHEMA_FILE
        )


def test_contract_example_covers_every_field():
    """The same file is parsed strictly by the TypeScript (Zod) schema in apps/web."""
    from pydantic import TypeAdapter

    from datawalk.core.models import Payload, ReportModel

    with open("packages/schema/generated/example-report.json") as f:
        ex = json.load(f)
    assert ReportModel.model_validate(ex["report"]).model_dump(mode="json") == ex["report"]
    for p in ex["payloads"]:
        assert TypeAdapter(Payload).validate_python(p).model_dump(mode="json") == p


def test_contract_example_is_current():
    """The decode cases must match what the installed plotly.py emits."""
    import runpy

    with open("packages/schema/generated/example-report.json") as f:
        committed = json.load(f)
    make = runpy.run_path("packages/schema/make_example.py")
    assert committed["decode"] == make["decode_cases"](), (
        "Run: uv run python packages/schema/make_example.py"
    )
