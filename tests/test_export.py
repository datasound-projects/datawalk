import re

import pandas as pd
import pytest
from test_editing import analysis

import datawalk as dw
from datawalk import export as ex
from datawalk.cli import main

built = pytest.mark.skipif(
    not (ex.STATIC / "library" / "index.json").exists() or not (ex.VIEWER / "viewer.js").exists(),
    reason="needs the web build (npm run build)",
)


def report():
    r = analysis()
    r.add_kpi("k", "Count", 3, room="Main")
    r.attach_dataset(pd.DataFrame({"x": [1, 2, 3]}), "points", visualizations=["a"])
    r.link(["a", "b"], name="Shared x")
    return r


def test_review_levels_points_and_datasets():
    r = report()
    rows = {x.key: x for x in ex.review(r)}
    assert (rows["a"].level, rows["a"].points, rows["a"].datasets) == ("data", 3, [])
    assert (rows["k"].level, rows["k"].points) == ("data", 1)
    rows = {x.key: x for x in ex.review(r, ex.ExportOptions({"b"}, include_datasets=True))}
    assert (rows["a"].level, rows["a"].points, rows["a"].datasets) == ("datasets", 6, ["points"])
    assert (rows["b"].level, rows["b"].points) == ("preview", 0)
    assert "preview only" in ex.format_review(list(rows.values()))


def test_point_count_plotly_typed_arrays():
    payload = {
        "kind": "plotly",
        "figure": {"data": [{"x": {"dtype": "f8", "bdata": "A" * 32}, "y": [[1, 2], [3]]}]},
    }
    assert ex.point_count(payload) == 3  # 24 bytes of f8 = 3 values; the nested list also has 3


@built
def test_prepare_removes_what_the_review_excludes():
    r = report()
    b = ex.prepare(r, ex.ExportOptions({"b"}, watermark="Copy for A. Reader"))
    doc = b.data["report"]
    by_key = {v["key"]: v for v in doc["visualizations"]}
    b_id = by_key["b"]["id"]
    assert b_id not in b.data["payloads"] and by_key["b"]["source"]["has_payload"] is False
    assert doc["links"] == []  # a link needs data in all its charts
    assert doc["datasets"] == [] and b.data["datasets"] == {}  # datasets only on request
    e = b.data["export"]
    assert e["revision"] == r.revision and e["watermark"] == "Copy for A. Reader"
    assert re.fullmatch(r"sha256:[0-9a-f]{64}", e["hash"])
    assert "themes/executive_office/theme.json" in b.assets
    with pytest.raises(ex.ExportError, match="Unknown keys"):
        ex.prepare(r, ex.ExportOptions({"nope"}))


@built
def test_html_is_self_contained(tmp_path):
    r = report()
    path, size = ex.write_html(
        ex.prepare(r, ex.ExportOptions(include_datasets=True)), tmp_path / "r.html"
    )
    html = path.read_text()
    assert size == len(html.encode())
    assert "Content-Security-Policy" in html and "default-src 'none'" in html
    # No URL outside the file in the markup: every asset and data item is inline.
    markup = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.S)
    assert not re.search(r"https?:", markup)
    assert '"library/index.json":"data:application/json;base64,' in html
    assert "data:text/csv;base64," in html


@built
def test_site_and_cli_review(tmp_path, capsys, monkeypatch):
    r = report()
    r.save(tmp_path / "r.dwk")
    # Without a terminal the review must be confirmed explicitly.
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    with pytest.raises(SystemExit) as e:
        main(["export", str(tmp_path / "r.dwk"), "--site", str(tmp_path / "site")])
    assert e.value.code == 1 and not (tmp_path / "site").exists()
    assert "Export review: Study" in capsys.readouterr().out
    with pytest.raises(SystemExit) as e:
        main(
            ["export", str(tmp_path / "r.dwk"), "--site", str(tmp_path / "site"), "--html", "--yes"]
        )
    assert e.value.code == 0
    assert (tmp_path / "r.html").exists()
    assert {p.name for p in (tmp_path / "site").iterdir()} >= {
        "index.html",
        "viewer.js",
        "data",
        "library",
        "themes",
    }
    loaded = dw.Report.load(tmp_path / "r.dwk")
    assert len(list((tmp_path / "site" / "data" / "payloads").iterdir())) == len(loaded._payloads)


@built
def test_pdf(tmp_path):
    pytest.importorskip("playwright")
    page, _ = ex.write_html(ex.prepare(report()), tmp_path / "r.html")
    try:
        pdf = ex.write_pdf(page, tmp_path / "r.pdf", "letter")
    except ex.ExportError as e:
        pytest.skip(str(e))  # no browser on this machine
    data = pdf.read_bytes()
    assert data.startswith(b"%PDF") and b"/MediaBox [0 0 612 792]" in data


@built
def test_export_endpoints_need_token_and_confirmation():
    from fastapi.testclient import TestClient

    from datawalk.server import create_app

    client = TestClient(create_app(report(), token="t"), base_url="http://127.0.0.1")
    auth = {"Authorization": "Bearer t"}
    assert client.post("/api/export/review", json={}).status_code == 403
    review = client.post("/api/export/review", json={"preview_only": ["a"]}, headers=auth).json()
    assert (
        review["error"] is None and {r["key"]: r["level"] for r in review["rows"]}["a"] == "preview"
    )
    assert client.post("/api/export/html", json={}, headers=auth).status_code == 422
    res = client.post("/api/export/html", json={"confirmed": True, "watermark": "W"}, headers=auth)
    assert res.status_code == 200 and 'filename="Study.html"' in res.headers["content-disposition"]
    assert '"watermark":"W"' in res.text


def test_classification_policy_limits_exports(tmp_path, monkeypatch, capsys):
    from datawalk.policy import PolicyError, check_export, policy

    assert (
        policy("Confidential").describe()
        == "Confidential: no public links, no datasets, watermark required"
    )
    with pytest.raises(PolicyError, match="Unknown classification"):
        policy("Top secret")
    with pytest.raises(PolicyError, match="HTML exports are not allowed"):
        check_export("Strictly confidential", "html", False, True, "W")
    with pytest.raises(PolicyError, match="preview image"):
        check_export("Strictly confidential", "pdf", False, False, "W")
    check_export("Strictly confidential", "pdf", False, True, "W")  # allowed
    custom = tmp_path / "policy.json"
    custom.write_text('{"labels": {"Team only": {"formats": ["pdf"]}}}')
    monkeypatch.setenv("DATAWALK_POLICY", str(custom))
    assert policy("Team only").formats == ("pdf",)
    monkeypatch.delenv("DATAWALK_POLICY")
    r = report()
    r.classify("Confidential")
    r.save(tmp_path / "c.dwk")
    with pytest.raises(SystemExit) as e:
        main(
            ["export", str(tmp_path / "c.dwk"), "--html", "--datasets", "--watermark", "W", "--yes"]
        )
    assert e.value.code == 1 and "Leave out the datasets" in capsys.readouterr().err
