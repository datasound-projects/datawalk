import json

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import plotly.graph_objects as go
import pytest
from fastapi.testclient import TestClient

import datawalk as dw
from datawalk.core.models import Placement, ReportModel
from datawalk.server import create_app


def line(title):
    fig, ax = plt.subplots()
    ax.plot([1, 2, 3], [3, 1, 2])
    ax.set_title(title)
    return fig


def analysis(keys=("a", "b", "c")):
    """One run of an analysis script."""
    r = dw.Report("Study")
    for k in keys:
        r.add(line(f"Chart {k}"), key=k, room="Main")
    return r


def test_kpi_and_table():
    r = dw.Report("r")
    k = r.add_kpi("acc", "Accuracy", 0.8734, fmt=".1%", delta=0.012, delta_fmt="+.1%")
    assert (k.name, k.source.chart_type, k.source.mode) == ("Accuracy", "kpi", "structured")
    assert r._payloads[k.id] | {"value": 0} == {
        "kind": "kpi",
        "value": 0,
        "display": "87.3%",
        "unit": "",
        "delta": 0.012,
        "delta_display": "+1.2%",
        "higher_is_better": True,
    }
    assert r._payloads[r.add_kpi("n", "Rows", 1234567).id]["display"] == "1,234,567"

    df = pd.DataFrame(
        {"x": [1.5, np.nan], "when": pd.to_datetime(["2024-01-01", None]), "ok": [True, False]},
        index=pd.Index(["p", "q"], name="id"),
    )
    t = r.add(df, key="tbl")
    payload = r._payloads[t.id]
    assert t.name == "Table 01" and t.source.mode == "structured"
    assert payload["columns"] == ["id", "x", "when", "ok"]
    assert payload["rows"][0][:2] == ["p", 1.5] and payload["rows"][0][3] is True
    assert payload["rows"][1][1:3] == [None, None]


def test_dashboards_group_charts():
    r = analysis()
    d = r.add_dashboard("Overview", ["a", "b"], room="Main")
    main = r.room("Main")
    assert main.items == [r.get("c").id, d.id]
    assert r.add_dashboard("Overview", ["a"], room="Main") is d and d.items == [r.get("a").id]
    assert r.unassigned() == [r.get("b")]
    with pytest.raises(ValueError, match="unknown"):
        ReportModel.model_validate(r.model_dump() | {"dashboards": []})


def test_rerun_keeps_presentation(tmp_path):
    path = tmp_path / "study.dwk"
    first = analysis()
    first.save(path)

    # The user edits the report (in the editor, which calls apply_presentation).
    edited = dw.Report.load(path)
    edited.name = "Study (final)"
    edited.get("a").overrides.name = "Renamed A"
    edited.get("a").overrides.explanation.findings = ["A rises"]
    edited.room("Main").name = "Results"
    edited.add_room("Archive")
    edited.move("c", "Archive")
    edited.room("Results").placements[edited.get("a").id] = Placement(
        wall="east", u=0.3, v=0.5, width=2.0
    )
    edited.save(path)

    # The script runs again: "b" is gone, "d" is new.
    rerun = analysis(keys=("a", "c", "d"))
    rerun.get("a").overrides.description = "From the script"
    rerun.save(path)
    final = dw.Report.load(path)

    a, b, c, d = (final.get(k) for k in "abcd")
    assert final.name == "Study (final)" and final.id == first.id
    assert (a.name, a.overrides.description) == ("Renamed A", "From the script")
    assert a.overrides.explanation.findings == ["A rises"]
    assert b.status == "removed" and b.id in final._previews  # kept with its data
    results, archive = final.room("Main"), final.room("Archive")  # key still "Main"
    assert results.name == "Results"
    assert results.items == [a.id, b.id, d.id] and archive.items == [c.id]
    assert results.placements[a.id].wall == "east"
    assert final.revision == 3

    # Same key, different kind of chart: never attached silently.
    clash = analysis(keys=("a",))
    clash.add(go.Figure(go.Bar(y=[1])), key="c", room="Main")
    with pytest.raises(dw.MergeConflict, match="c"):
        clash.save(path)
    clash.save(path, accept_changes=True)


def test_editor_api(tmp_path):
    r = analysis()
    r.save(tmp_path / "s.dwk")
    token = "secret-token"
    client = TestClient(create_app(r, token), base_url="http://127.0.0.1")
    auth = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/session").json() == {"editable": False, "saves_to": None}
    assert client.get("/api/session", headers=auth).json() == {
        "editable": True,
        "saves_to": "s.dwk",
        "labels": ["Public", "Internal", "Confidential", "Strictly confidential"],
    }

    doc = client.get("/api/report").json()
    doc["visualizations"][0]["overrides"]["name"] = "Edited"
    doc["visualizations"][0]["source"]["title"] = "Tampered"  # source data is not editable
    doc["rooms"][0]["name"] = "Renamed"
    assert client.put("/api/report", content=json.dumps(doc)).status_code == 403
    res = client.put("/api/report", content=json.dumps(doc), headers=auth)
    assert res.status_code == 200 and res.json()["revision"] == 2
    saved = dw.Report.load(tmp_path / "s.dwk")
    assert saved.get("a").name == "Edited" and saved.get("a").source.title == "Chart a"
    assert saved.rooms[0].name == "Renamed"

    stale = client.put("/api/report", content=json.dumps(doc), headers=auth)
    assert stale.status_code == 409
    doc = res.json()
    doc["visualizations"].pop()  # an active visualization cannot be deleted
    doc["rooms"][0]["items"].pop()
    assert client.put("/api/report", content=json.dumps(doc), headers=auth).status_code == 422
    assert client.put("/api/report", content="{}", headers=auth).status_code == 422


def test_editor_edits_win_reruns_script_values_otherwise(tmp_path):
    path = tmp_path / "p.dwk"
    first = analysis()
    first.get("a").overrides.description = "Script v1"
    first.save(path)

    # An editor session renames "a" (recorded as edited by the server).
    report = dw.Report.load(path)
    doc = ReportModel.model_validate_json(report.model_dump_json())
    doc.visualizations[0].overrides.name = "Editor name"
    report.apply_presentation(doc)
    report.save(path)
    assert dw.Report.load(path).get("a").overrides.edited == ["name"]

    # The script changes both the name and the description.
    rerun = analysis()
    rerun.add(line("Chart a"), key="a", name="Script name", update=True)
    rerun.get("a").overrides.description = "Script v2"
    rerun.save(path)
    a = dw.Report.load(path).get("a")
    assert a.name == "Editor name"  # edited in the editor: kept
    assert a.overrides.description == "Script v2"  # not edited: the script's new value


def test_links_need_data_and_survive_reruns(tmp_path):
    r = analysis()
    link = r.link(["a", "b"], name="Shared time")
    assert link.items == [r.get("a").id, r.get("b").id]
    with pytest.raises(ValueError, match="at least two"):
        r.link(["a"])
    fig, ax = plt.subplots()
    ax.imshow(np.eye(2))
    r.add(fig, key="img", room="Main")
    with pytest.raises(ValueError, match="no x data"):
        r.link(["a", "img"])
    r.save(tmp_path / "l.dwk")
    again = analysis()
    again.save(tmp_path / "l.dwk")
    assert [x.name for x in dw.Report.load(tmp_path / "l.dwk").links] == ["Shared time"]


def test_preview_upload_needs_token_and_png(tmp_path):
    r = dw.Report("p")
    v = r.add(go.Figure(go.Scatter(y=[1, 2])), key="p")
    r.save(tmp_path / "p.dwk")
    client = TestClient(create_app(r, "t"), base_url="http://127.0.0.1")
    url = f"/api/visualizations/{v.id}/preview.png"
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 10
    assert client.put(url, content=png).status_code == 403
    auth = {"Authorization": "Bearer t"}
    assert client.put(url, content=b"<svg/>", headers=auth).status_code == 422
    assert client.put(url, content=png, headers=auth).status_code == 204
    assert client.get(url).content == png
    assert dw.Report.load(tmp_path / "p.dwk").get("p").source.has_preview


def test_datasets_round_trip_and_rerun(tmp_path):
    r = analysis()
    df = pd.DataFrame({"x": [1, 2], "y": [3.5, None]})
    ds = r.attach_dataset(df, "points", name="Points", visualizations=["a"])
    assert (ds.rows, ds.columns) == (2, ["x", "y"])
    r.save(tmp_path / "d.dwk")
    loaded = dw.Report.load(tmp_path / "d.dwk")
    assert loaded._datasets[ds.id].decode().splitlines() == ["x,y", "1,3.5", "2,"]
    client = TestClient(create_app(loaded), base_url="http://127.0.0.1")
    res = client.get(f"/api/datasets/{ds.id}.csv")
    assert res.status_code == 200 and 'filename="points.csv"' in res.headers["content-disposition"]
    # A rerun replaces the data and keeps the id.
    again = analysis()
    again.attach_dataset(pd.DataFrame({"x": [9]}), "points", visualizations=["a"])
    again.save(tmp_path / "d.dwk")
    final = dw.Report.load(tmp_path / "d.dwk")
    assert final.datasets[0].id == ds.id and final.datasets[0].rows == 1
