import base64
import json
import shutil
from pathlib import Path

import pytest

import datawalk as dw
from datawalk.core.models import ReportModel
from datawalk.importers import NotebookError, from_notebook
from datawalk.importers.content import dataresource, html_table
from datawalk.importers.svg import UnsafeSvg, sanitize

EXAMPLE = Path(__file__).parents[1] / "examples" / "notebook" / "retail_analysis.ipynb"
PNG = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000020000000108060000"
        "00f478d4fa0000000d49444154789c63f8cf00010600050001a5f645400000000049454e44ae426082"
    )
).decode()


def nb(cells):
    return {"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": cells}


def md(text, **meta):
    return {
        "cell_type": "markdown",
        "id": f"m{abs(hash(text)) % 10**6}",
        "metadata": meta,
        "source": text,
    }


def code(cid, outputs, **meta):
    return {
        "cell_type": "code",
        "id": cid,
        "metadata": meta,
        "source": "plot()",
        "execution_count": 1,
        "outputs": outputs,
    }


def png_out():
    return {"output_type": "display_data", "data": {"image/png": PNG}, "metadata": {}}


def write(tmp_path, cells, name="a.ipynb"):
    path = tmp_path / name
    path.write_text(json.dumps(nb(cells)))
    return path


def test_example_notebook_maps_sections_to_rooms():
    r = dw.Report.from_notebook(EXAMPLE)
    assert r.name == "Retail Sales Analysis"
    assert [x.name for x in r.rooms] == ["Sales Overview", "Customer Segments", "Forecast"]
    by = {v.id: v for v in r.visualizations}
    modes = {
        by[i].source.library: by[i].source.mode for room in r.rooms for i in room.items if i in by
    }
    assert modes == {
        "plotly": "interactive",
        "table": "structured",
        "datawalk": "structured",
        "svg": "static",
        "markdown": "structured",
        "vega-lite": "interactive",
    }
    line = next(v for v in r.visualizations if v.source.library == "plotly")
    assert line.overrides.description == "Revenue per month. Hover a point for the exact value."
    assert r.rooms[0].description == "Monthly revenue in thousand EUR, all stores."
    group = r.dashboard("Segment profiles")
    assert [by[i].source.mode for i in group.items] == ["static", "static"]  # matplotlib PNGs
    kpi = r.get("total_revenue")
    assert r._payloads[kpi.id]["unit"] == "k EUR" and isinstance(
        r._payloads[kpi.id]["value"], float
    )
    p = line.source.provenance
    assert (p.kind, p.cell_id, p.output_index) == ("notebook", line.key.split("-")[0], 0)
    assert len(p.sha256) == 64 and "px.line" in p.code
    # Stream outputs (print) are not charts.
    assert len([v for v in r.visualizations if v.status == "active"]) == 8


def test_reimport_keeps_editor_changes(tmp_path):
    archive = tmp_path / "retail.dwk"
    shutil.copy(EXAMPLE, tmp_path / "nb.ipynb")
    first = dw.Report.from_notebook(tmp_path / "nb.ipynb")
    first.save(archive)
    # Editor changes: rename a chart and a room, move a chart, change a theme.
    report = dw.Report.load(archive)
    doc = ReportModel.model_validate_json(report.model_dump_json())
    line = next(v for v in doc.visualizations if v.source.library == "plotly")
    line.overrides.name = "Revenue (edited)"
    doc.rooms[0].name = "Overview (edited)"
    doc.rooms[0].theme = "dark_gallery"
    doc.rooms[0].items.remove(line.id)
    doc.rooms[2].items.append(line.id)
    report.apply_presentation(doc)
    report.save(archive)
    # Re-import the re-executed notebook: the code changed the title in between.
    nb_path = tmp_path / "nb.ipynb"
    data = json.loads(nb_path.read_text())
    for cell in data["cells"]:
        cell["source"] = "".join(cell["source"]).replace(
            "'Monthly Revenue'", "'Monthly Revenue 2026'"
        )
    nb_path.write_text(json.dumps(data))
    try:
        import nbclient  # noqa: F401
    except ImportError:  # no kernel here: change the stored output the way a rerun would
        for cell in data["cells"]:
            for out in cell.get("outputs", []):
                fig = out.get("data", {}).get("application/vnd.plotly.v1+json")
                if fig:
                    fig["layout"]["title"]["text"] = "Monthly Revenue 2026"
        nb_path.write_text(json.dumps(data))
        again = dw.Report.from_notebook(nb_path)
    else:
        again = dw.Report.from_notebook(nb_path, execute=True, timeout=120)
    again.save(archive)
    final = dw.Report.load(archive)
    edited = final.get(line.key)
    assert edited.name == "Revenue (edited)"
    assert final.rooms[0].name == "Overview (edited)" and final.rooms[0].theme == "dark_gallery"
    assert edited.id in final.rooms[2].items and edited.id not in final.rooms[0].items
    assert edited.source.title == "Monthly Revenue 2026"  # new output, edited name kept


def test_cell_metadata_controls_and_errors(tmp_path):
    path = write(
        tmp_path,
        [
            md("## Room A\n\nAbout A."),
            code("c1", [png_out()], datawalk={"key": "chart", "name": "My chart", "room": "Other"}),
            code("c2", [png_out()], datawalk={"skip": True}),
            code("c3", [{"output_type": "stream", "name": "stdout", "text": "hi"}]),
            md("Context for the agenda.", datawalk={"text": True, "key": "agenda"}),
        ],
    )
    r = from_notebook(path)
    assert r.get("chart").name == "My chart" and r.get("c2-0") is None
    assert r.get("chart").id in r.room("Other").items
    assert r._payloads[r.get("agenda").id]["markdown"] == "Context for the agenda."
    assert r.get("agenda").id in r.room("Room A").items
    old = tmp_path / "old.ipynb"
    old.write_text(json.dumps({"nbformat": 3, "worksheets": []}))
    with pytest.raises(NotebookError, match="nbconvert"):
        from_notebook(old)
    dup = write(
        tmp_path,
        [
            code("x", [png_out()], datawalk={"key": "k"}),
            code("y", [png_out()], datawalk={"key": "k"}),
        ],
        "dup.ipynb",
    )
    with pytest.raises(NotebookError, match="Two outputs"):
        from_notebook(dup)


def test_svg_sanitizer():
    dirty = (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'width="200" height="100" onload="alert(1)"><script>alert(2)</script>'
        "<foreignObject><div>x</div></foreignObject>"
        "<style>@import url(https://evil.example/x.css); .a{fill:url(https://evil.example/p)}"
        "<desc/>@import url(https://evil.example/tail.css);</style>"
        '<a href="javascript:alert(3)"><rect width="10" height="10" onclick="x()"/></a>'
        '<image xlink:href="https://evil.example/i.png"/>'
        '<image xlink:href="data:image/png;base64,AAAA"/><path d="M0 0" fill="url(#g)"/></svg>'
    )
    clean, aspect = sanitize(dirty)
    assert aspect == 2
    for bad in (
        "script",
        "alert",
        "foreignObject",
        "evil.example",
        "onclick",
        "onload",
        "@import",
        "<a",
    ):
        assert bad not in clean
    assert "data:image/png;base64,AAAA" in clean and 'fill="url(#g)"' in clean
    with pytest.raises(UnsafeSvg):
        sanitize('<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>')


def test_tables_from_html_and_dataresource():
    html = (
        '<table border="1" class="dataframe"><thead><tr><th></th><th>a</th><th>b</th></tr>'
        "<tr><th>month</th><th></th><th></th></tr></thead><tbody>"
        "<tr><th>2025-01</th><td>1,234.5</td><td>x</td></tr>"
        "<tr><th>2025-02</th><td>NaN</td><td>y</td></tr></tbody></table>"
    )
    t = html_table(html).payload
    assert t["columns"] == ["month", "a", "b"]
    assert t["rows"] == [["2025-01", 1234.5, "x"], ["2025-02", None, "y"]]
    assert html_table("<p>no table</p>") is None
    d = dataresource(
        {"schema": {"fields": [{"name": "k"}, {"name": "v"}]}, "data": [{"k": "a", "v": 2}]}
    )
    assert d.payload["rows"] == [["a", 2]]
