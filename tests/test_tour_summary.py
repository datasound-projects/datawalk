import json
import zipfile

import pytest
from fastapi.testclient import TestClient
from test_editing import analysis

import datawalk as dw
from datawalk.server import create_app


def with_summary(keys=("a", "b", "c")):
    r = analysis(keys)
    r.add_kpi("k", "Count", 3, room=None)
    r.add_summary(
        kpis=["k"],
        findings=[("A rises.", ["a"]), ("B and C agree.", ["b", "c"])],
        author="Team",
        data_cutoff="2026-09-30",
    )
    return r


def test_summary_room_is_first_and_uses_only_given_content():
    r = with_summary()
    room = r.rooms[0]
    assert (room.key, room.name) == ("summary", "Summary")
    dash = r.dashboard("summary_kpis")
    assert room.items[0] == dash.id and dash.items == [r.get("k").id]  # KPI wall first
    f1 = r.get("summary_finding_1")
    assert r._payloads[f1.id] == {"kind": "text", "markdown": "A rises.", "links": ["a"]}
    assert r._payloads[r.get("summary_finding_2").id]["links"] == ["b", "c"]
    assert r.get("summary_finding_3") is None  # no invented findings
    about = r._payloads[r.get("summary_about").id]["markdown"]
    assert about == "**Author:** Team  \n**Data cut-off:** 2026-09-30"
    with pytest.raises(ValueError, match="at most 3"):
        r.add_summary(kpis=[], findings=[("x", ["a"])] * 4)
    with pytest.raises(ValueError, match="supporting key"):
        r.add_summary(kpis=[], findings=[("x", [])])
    with pytest.raises(KeyError):
        r.add_summary(kpis=[], findings=[("x", ["nope"])])


def test_kpis_only_summary():
    r = analysis()
    r.add_kpi("k", "Count", 3, room=None)
    room = r.add_summary(kpis=["k"])
    assert [r.dashboard("summary_kpis").id] == room.items


def test_default_tour_and_set_tour():
    r = with_summary()
    tour = r.default_tour()
    assert tour[0].ref == r.rooms[0].id  # the summary room is the first stop
    assert [t.ref for t in tour[1:5]] == r.rooms[0].items  # KPI wall, 2 findings, about
    assert tour[5].ref == r.room("Main").id
    stops = r.set_tour(["k", "Main", "a"])
    assert [s.ref for s in stops] == [r.get("k").id, r.room("Main").id, r.get("a").id]
    r.tour_stop("a").notes = "Look at the peak."
    r.set_tour(["a", "b"])  # existing stops keep their notes
    assert r.tour[0].notes == "Look at the peak."
    with pytest.raises(KeyError):
        r.set_tour(["missing"])
    with pytest.raises(KeyError, match="not a stop"):
        r.tour_stop("c")


def test_tour_stop_without_tour_uses_default_order():
    r = analysis()
    r.tour_stop("b").duration = 5
    assert len(r.tour) == 4 and r.tour[2].duration == 5


def test_rerun_keeps_edited_tour_and_takes_script_details(tmp_path):
    path = tmp_path / "t.dwk"
    first = with_summary()
    first.set_tour(["a", "b"])
    first.save(path)
    # A rerun without edits: the script's tour and details apply.
    second = with_summary()
    second.set_tour(["c", "a"])
    second.data_cutoff = "2026-10-31"
    second.save(path)
    loaded = dw.Report.load(path)
    keys = {v.id: v.key for v in loaded.visualizations}
    assert [keys[s.ref] for s in loaded.tour] == ["c", "a"]
    assert loaded.data_cutoff == "2026-10-31"
    # An editor change: the tour and the author become user-owned.
    client = TestClient(create_app(loaded, token="t"), base_url="http://127.0.0.1")
    doc = json.loads(loaded.model_dump_json())
    doc["tour"] = [
        {"id": "f" * 32, "ref": loaded.get("b").id, "notes": "Edited.", "duration": None}
    ]
    doc["author"] = "Editor"
    res = client.put("/api/report", json=doc, headers={"Authorization": "Bearer t"})
    assert res.status_code == 200 and res.json()["edited"] == ["author", "tour"]
    third = with_summary()
    third.set_tour(["a"])
    third.save(path)
    final = dw.Report.load(path)
    assert [(s.ref, s.notes) for s in final.tour] == [(final.get("b").id, "Edited.")]
    assert final.author == "Editor" and final.data_cutoff == "2026-09-30"
    assert final.rooms[0].key == "summary"


def test_summary_added_by_a_later_run_goes_first(tmp_path):
    path = tmp_path / "s.dwk"
    analysis().save(path)
    with_summary().save(path)
    assert [r.key for r in dw.Report.load(path).rooms] == ["summary", "Main"]


def test_reads_schema_0_2_archives(tmp_path):
    path = tmp_path / "old.dwk"
    analysis().save(path)
    rewritten = tmp_path / "rewritten.dwk"
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(rewritten, "w") as dst:
        for info in src.infolist():
            data = src.read(info)
            if info.filename in ("manifest.json", "report.json"):
                doc = json.loads(data)
                doc["schema_version"] = "0.2.0"
                for field in ("tour", "edited", "author", "date", "data_cutoff"):
                    doc.pop(field, None)
                data = json.dumps(doc).encode()
            dst.writestr(info, data)
    old = dw.Report.load(rewritten)
    assert old.schema_version == "0.3.0"
    assert old.tour == [] and len(old.visualizations) == 3


def test_brand_file_round_trip_and_rerun(tmp_path):
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(2, 1))
    fig.savefig(tmp_path / "logo.png")
    (tmp_path / "brand.json").write_text(
        json.dumps(
            {
                "name": "Contoso",
                "logo": "logo.png",
                "frame": "#112233",
                "plaque": "#ffffff",
                "plaque_text": "#000000",
            }
        )
    )
    r = analysis()
    brand = r.set_brand(tmp_path / "brand.json")
    assert (brand.name, brand.has_logo, brand.frame) == ("Contoso", True, "#112233")
    r.save(tmp_path / "b.dwk")
    loaded = dw.Report.load(tmp_path / "b.dwk")
    assert loaded.brand == brand and loaded._brand_logo.startswith(b"\x89PNG")
    client = TestClient(create_app(loaded), base_url="http://127.0.0.1")
    assert client.get("/api/brand/logo.png").content == loaded._brand_logo
    analysis().save(tmp_path / "b.dwk")  # a rerun without set_brand keeps the brand
    assert dw.Report.load(tmp_path / "b.dwk").brand.name == "Contoso"
    with pytest.raises(ValueError):
        dw.Report("x").set_brand({"frame": "red"})


def test_reads_archives_from_the_earlier_name(tmp_path):
    """DataWalk was called Vizatrium: its .vza files open as before."""
    path = tmp_path / "old.vza"
    analysis().save(path)
    legacy = tmp_path / "legacy.vza"
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(legacy, "w") as dst:
        for info in src.infolist():
            data = src.read(info)
            if info.filename == "manifest.json":
                data = data.replace(b"datawalk-archive", b"vizatrium-archive")
            dst.writestr(info, data)
    assert len(dw.Report.load(legacy).visualizations) == 3
