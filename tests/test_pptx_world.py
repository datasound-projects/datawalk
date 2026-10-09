import json
import struct
import zipfile

import pytest
from test_editing import analysis

from datawalk import export as ex
from datawalk.export.pptx import needs_images, write_pptx

pptx = pytest.importorskip("pptx")


def report():
    r = analysis()
    r.add_kpi("k", "Count", 3, room="Main")
    r.get("a").overrides.explanation.findings = ["A rises."]
    r.tour_stop("a").notes = "Say this."
    return r


def slides(path):
    deck = pptx.Presentation(str(path))
    return [
        (
            next(
                (sh.text_frame.text for sh in s.shapes if sh.has_text_frame and sh.text_frame.text),
                "",
            ),
            sum(1 for sh in s.shapes if sh.shape_type == 13),
            s.notes_slide.notes_text_frame.text if s.has_notes_slide else "",
            " ".join(sh.text_frame.text for sh in s.shapes if sh.has_text_frame),
        )
        for s in deck.slides
    ]


def test_pptx_one_slide_per_stop_with_notes_and_native_text(tmp_path):
    r = report()
    assert needs_images(r) == []  # Matplotlib charts carry their own preview images
    out = write_pptx(r, tmp_path / "d.pptx", {}, watermark="Board copy")
    s = slides(out)
    assert len(s) == 1 + len(r.tour_stops())  # title slide, then the tour
    title, pics, notes, text = s[2]  # room, then chart "a"
    assert (pics, notes) == (1, "Say this.") and "A rises." in text and "Board copy" in text
    kpi = next(x for x in s if x[0].startswith("Count"))
    assert "3" in kpi[3] and kpi[1] == 0  # the value as text, not as a picture


def test_pptx_respects_preview_only_and_templates(tmp_path):
    r = report()
    r._previews[r.get("k").id] = r._previews[r.get("a").id]  # a KPI with a preview image
    out = write_pptx(r, tmp_path / "p.pptx", {}, levels={r.get("k").id: "preview"})
    kpi = next(x for x in slides(out) if x[0] == "Count")
    assert kpi[1] == 1 and "3" not in kpi[3].replace("Count", "")  # image only, no value
    # A .potx template: the deck uses its layouts.
    template = tmp_path / "t.potx"
    pptx.Presentation().save(str(tmp_path / "t.pptx"))
    with zipfile.ZipFile(tmp_path / "t.pptx") as src, zipfile.ZipFile(template, "w") as dst:
        for item in src.infolist():
            data = src.read(item)
            if item.filename == "[Content_Types].xml":
                data = data.replace(
                    b"presentationml.presentation.main+xml", b"presentationml.template.main+xml"
                )
            dst.writestr(item, data)
    out = write_pptx(r, tmp_path / "t_out.pptx", {}, template=template)
    assert len(slides(out)) == 1 + len(r.tour_stops())


built = pytest.mark.skipif(
    not (ex.STATIC / "library" / "index.json").exists() or not (ex.VIEWER / "viewer.js").exists(),
    reason="needs the web build (npm run build)",
)


@built
def test_world_files(tmp_path):
    pytest.importorskip("playwright")
    r = report()
    page, _ = ex.write_html(ex.prepare(r), tmp_path / "r.html")
    try:
        glb = ex.write_world(page, tmp_path / "w.glb", "glb")
    except ex.ExportError as e:
        pytest.skip(str(e))
    data = glb.read_bytes()
    assert data[:4] == b"glTF"
    length = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20 : 20 + length])
    assert "KHR_materials_unlit" in doc.get("extensionsUsed", [])
    nodes = {n.get("name"): n for n in doc["nodes"]}
    assert "Room: Main" in nodes and nodes["Chart: Chart a"]["extras"]["findings"] == ["A rises."]
    usdz = ex.write_world(page, tmp_path / "w.usdz", "usdz")
    with zipfile.ZipFile(usdz) as z:
        usda = z.read(z.namelist()[0]).decode()
    assert 'upAxis = "Y"' in usda and "ChartCharta" in usda
