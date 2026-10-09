"""The short paths: one call or one command for the common tasks, and clear messages."""

import json

import plotly.graph_objects as go
import pytest
from test_editing import analysis

import datawalk as dw
from datawalk import export as ex
from datawalk.cli import main

built = pytest.mark.skipif(
    not (ex.STATIC / "library" / "index.json").exists() or not (ex.VIEWER / "viewer.js").exists(),
    reason="needs the web build (npm run build)",
)


def test_save_creates_missing_folders(tmp_path):
    path = analysis().save(tmp_path / "a" / "b" / "r.dwk")
    assert path.exists()


@built
def test_report_export_picks_the_format_from_the_path(tmp_path, capsys):
    r = analysis()
    html, site = r.export(tmp_path / "r.html", tmp_path / "site", yes=True)
    assert html.read_text().startswith("<!doctype html>") and (site / "index.html").exists()
    assert "Export review: Study" in capsys.readouterr().out
    # A new export replaces an earlier export in the same folder, never other folders.
    r.export(tmp_path / "site", yes=True)
    (tmp_path / "other").mkdir()
    (tmp_path / "other" / "keep.txt").write_text("x")
    with pytest.raises(ex.ExportError, match="not an earlier DataWalk export"):
        r.export(tmp_path / "other", yes=True)
    with pytest.raises(ex.ExportError, match="unknown export format"):
        r.export(tmp_path / "r.docx", yes=True)


def test_export_without_confirmation_outside_a_terminal(tmp_path, monkeypatch):
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    with pytest.raises(ex.ExportError, match="confirm it"):
        analysis().export(tmp_path / "r.html")
    assert not (tmp_path / "r.html").exists()


@built
def test_cli_export_defaults_to_html(tmp_path):
    analysis().save(tmp_path / "r.dwk")
    with pytest.raises(SystemExit) as e:
        main(["export", str(tmp_path / "r.dwk"), "--yes"])
    assert e.value.code == 0 and (tmp_path / "r.html").exists()


@built
def test_preview_only_all_draws_the_missing_images(tmp_path):
    pytest.importorskip("playwright")
    r = analysis(("a",))
    r.add(go.Figure(go.Scatter(x=[1, 2], y=[3, 4])), key="p", room="Main")  # no preview yet
    r.add_kpi("k", "Count", 3, room="Main")
    try:
        plan = ex.plan_export(r, [("html", tmp_path / "r.html")], ex.ExportOptions({"all"}))
    except ex.ExportError as e:
        pytest.skip(str(e))  # no browser here
    assert {"p", "k"} <= set(plan.notes[0].split(": ")[1].rstrip(".").split(", "))
    levels = plan.bundle.data["export"]["levels"]
    assert set(levels.values()) == {"preview"} and plan.bundle.data["payloads"] == {}
    assert r._previews[r.get("p").id].startswith(b"\x89PNG")


@built
def test_policy_without_data_exports_images_automatically(tmp_path):
    pytest.importorskip("playwright")
    r = analysis(("a",))
    r.add_text("note", "Findings stay **text**.", room="Main")
    r.classify("Strictly confidential")
    with pytest.raises(Exception, match="HTML exports are not allowed"):
        ex.plan_export(r, [("html", tmp_path / "r.html")], ex.ExportOptions(watermark="W"))
    try:
        plan = ex.plan_export(r, [("pdf", tmp_path / "r.pdf")], ex.ExportOptions(watermark="W"))
    except ex.ExportError as e:
        pytest.skip(str(e))
    assert "preview image" in plan.notes[0]
    levels = {k: lvl for k, lvl in plan.bundle.data["export"]["levels"].items()}
    assert levels[r.get("a").id] == "preview" and levels[r.get("note").id] == "data"


def test_import_explains_empty_and_skipped_outputs(tmp_path, capsys):
    empty = tmp_path / "never_run.ipynb"
    empty.write_text(
        json.dumps(
            {
                "nbformat": 4,
                "nbformat_minor": 5,
                "metadata": {},
                "cells": [
                    {"cell_type": "markdown", "id": "m", "metadata": {}, "source": "## Room"},
                    {
                        "cell_type": "code",
                        "id": "c",
                        "metadata": {},
                        "source": "plot()",
                        "execution_count": None,
                        "outputs": [],
                    },
                ],
            }
        )  # fmt: skip
    )
    with pytest.raises(SystemExit) as e:
        main(["import", str(empty)])
    assert e.value.code == 1 and "Run the notebook" in capsys.readouterr().err
    assert not (tmp_path / "never_run.dwk").exists()
    png = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    )  # fmt: skip
    mixed = tmp_path / "mixed.ipynb"
    mixed.write_text(
        json.dumps(
            {
                "nbformat": 4,
                "nbformat_minor": 4,
                "metadata": {},
                "cells": [
                    {
                        "cell_type": "code",
                        "metadata": {},
                        "source": "x",
                        "execution_count": 1,
                        "outputs": [
                            {
                                "output_type": "display_data",
                                "data": {"image/png": png},
                                "metadata": {},
                            },
                            {
                                "output_type": "display_data",
                                "data": {"text/html": "<div>map</div>", "text/plain": "map"},
                                "metadata": {},
                            },
                            {"output_type": "stream", "name": "stdout", "text": "log"},
                        ],
                    },
                ],
            }
        )  # fmt: skip
    )
    with pytest.raises(SystemExit) as e:
        main(["import", str(mixed)])
    out = capsys.readouterr().out
    assert e.value.code == 0 and "1 items in 1 rooms" in out
    assert "Not shown: 1 text output, 1 text/html" in out and "no cell ids" in out


def test_open_imports_a_notebook(tmp_path, monkeypatch):
    shown = []
    monkeypatch.setattr(dw.Report, "show", lambda self, **kw: shown.append((self.name, kw)))
    nb = tmp_path / "analysis.ipynb"
    nb.write_bytes(
        (
            __import__("pathlib").Path(__file__).parents[1]
            / "examples/notebook/retail_analysis.ipynb"
        ).read_bytes()
    )
    with pytest.raises(SystemExit) as e:
        main(["open", str(nb), "--no-browser"])
    assert e.value.code == 0 and (tmp_path / "analysis.dwk").exists()
    assert shown[0][0] == "Retail Sales Analysis" and shown[0][1]["open_browser"] is False


def test_open_reports_a_broken_file_without_a_traceback(tmp_path, capsys):
    (tmp_path / "bad.dwk").write_bytes(b"nope")
    with pytest.raises(SystemExit) as e:
        main(["open", str(tmp_path / "bad.dwk")])
    assert e.value.code == 1 and "not a DataWalk archive" in capsys.readouterr().err


def test_publish_sends_the_token_only_over_https(tmp_path, capsys):
    analysis().save(tmp_path / "r.dwk")
    for hub in (
        "http://localhost@evil.example",  # the host is evil.example
        "http://127.0.0.1.evil.example",
        "http://evil.example",
        "https://user:secret@hub.example",
    ):
        with pytest.raises(SystemExit) as e:
            main(["publish", str(tmp_path / "r.dwk"), "--hub", hub, "--token", "t"])
        assert e.value.code == 2 and "use https://" in capsys.readouterr().err


def test_clear_messages_for_empty_and_missing_input(tmp_path, capsys):
    dw.Report("Empty").save(tmp_path / "empty.dwk")
    with pytest.raises(SystemExit) as e:
        main(["export", str(tmp_path / "empty.dwk"), "--yes"])
    assert e.value.code == 1 and "has no visualizations" in capsys.readouterr().err
    with pytest.raises(SystemExit) as e:
        main(["export", str(tmp_path / "nope.dwk"), "--yes"])
    assert e.value.code == 1 and "nope.dwk: no such file" in capsys.readouterr().err
    nb = tmp_path / "failed.ipynb"
    error = {"output_type": "error", "ename": "E", "evalue": "x", "traceback": []}
    cell = {"cell_type": "code", "id": "a", "metadata": {}, "source": "1/0"}
    nb.write_text(
        json.dumps(
            {
                "nbformat": 4,
                "nbformat_minor": 5,
                "metadata": {},
                "cells": [cell | {"execution_count": 1, "outputs": [error]}],
            }
        )
    )
    with pytest.raises(SystemExit) as e:
        main(["import", str(nb)])
    assert e.value.code == 1 and "(it has: 1 error)" in capsys.readouterr().err


def test_a_text_panel_is_named_after_its_heading():
    r = dw.Report("r")
    assert r.add_text("t", "## Key findings\n\nText").name == "Key findings"
    assert r.add_text("u", "Plain text", name="Notes").name == "Notes"


@built
def test_export_outputs_are_checked_before_the_review(tmp_path, capsys):
    analysis().save(tmp_path / "r.dwk")
    with pytest.raises(SystemExit) as e:  # never replaces the report itself
        main(["export", str(tmp_path / "r.dwk"), "--html", str(tmp_path / "r.dwk"), "--yes"])
    assert e.value.code == 1 and "never replaces a .dwk" in capsys.readouterr().err
    (tmp_path / "out").mkdir()
    with pytest.raises(SystemExit) as e:  # a folder: the file goes into it
        main(["export", str(tmp_path / "r.dwk"), "--html", str(tmp_path / "out"), "--yes"])
    assert e.value.code == 0 and (tmp_path / "out" / "r.html").exists()
    capsys.readouterr()
    with pytest.raises(SystemExit) as e:
        main(["--version"])
    assert e.value.code == 0 and capsys.readouterr().out.startswith("datawalk ")


def test_a_used_port_is_a_clear_error():
    import socket

    from datawalk.server import serve

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        with pytest.raises(OSError, match="is in use"):
            serve(dw.Report("r"), port=s.getsockname()[1], open_browser=False, block=False)
