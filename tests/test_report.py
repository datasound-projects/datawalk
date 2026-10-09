import matplotlib.pyplot as plt
import plotly.graph_objects as go
import pytest

import datawalk as dw


def scatter(title=None, xlabel="", ylabel=""):
    fig, ax = plt.subplots()
    ax.scatter([1, 2], [3, 4])
    ax.set(xlabel=xlabel, ylabel=ylabel)
    if title:
        ax.set_title(title)
    return fig


def test_naming_precedence():
    r = dw.Report("r")
    assert r.add(scatter("Correlation"), key="a").name == "Correlation"
    assert r.add(scatter(xlabel="returns", ylabel="volatility"), key="b").name == (
        "Volatility vs Returns"
    )
    assert r.add(scatter(), key="c").name == "Scatter Plot 01"
    assert r.add(scatter(), key="d").name == "Scatter Plot 02"
    assert r.add(scatter("T"), key="e", name="Custom").name == "Custom"


def test_duplicate_key_and_update_keeps_user_edits():
    r = dw.Report("r")
    v = r.add(scatter("Old"), key="k", room="A")
    with pytest.raises(ValueError, match="Duplicate key"):
        r.add(scatter("New"), key="k")
    v.overrides.name = "My name"
    v.overrides.explanation.findings = ["Stable"]
    r.move("k", "B")
    r.add(scatter("New"), key="k", room="Ignored", update=True)
    assert r.get("k").source.title == "New"
    assert r.get("k").name == "My name"
    assert r.get("k").overrides.explanation.findings == ["Stable"]
    assert [(room.name, len(room.items)) for room in r.rooms] == [("A", 0), ("B", 1)]


def test_rooms_and_themes():
    r = dw.Report("r", theme="dark_gallery")
    r.add(go.Figure(go.Scatter(y=[1, 2])), key="p", room="Market Overview")
    room = r.room("Market Overview")
    room.name = "Market Conditions"
    room.theme = "data_command_center"
    with pytest.raises(ValueError):
        room.theme = "not_a_theme"
    with pytest.raises(KeyError, match="Market Conditions"):
        r.room("Missing")
    with pytest.raises(ValueError):
        r.add_room("Market Conditions")


def test_capture_and_discover():
    plt.figure("price")
    plt.plot([1, 2])
    plt.figure()
    plt.plot([2, 1])
    r = dw.Report("r")
    assert [v.key for v in r.capture_matplotlib()] == ["price", "figure-2"]
    assert len(r.capture_matplotlib()) == 2 and len(r.visualizations) == 2  # updates, no dupes

    fig, ax = plt.subplots()
    ns = {"fig": fig, "ax": ax, "pfig": go.Figure(), "_hidden": fig, "n": 3}
    r2 = dw.Report("r2")
    assert r2.discover(ns) == {"fig": "matplotlib", "pfig": "plotly"}
    assert r2.visualizations == []
    r2.discover(ns, add=True)
    assert [v.key for v in r2.visualizations] == ["fig", "pfig"]


def test_auto_arrange_splits_overflow():
    r = dw.Report("r")
    for i in range(5):
        r.add(scatter(f"t{i}"), key=str(i), room="Big")
    r.auto_arrange(max_per_room=2)
    assert [(x.name, len(x.items)) for x in r.rooms] == [
        ("Big", 2),
        ("Big (2)", 2),
        ("Big (3)", 1),
    ]
