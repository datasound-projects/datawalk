import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import pytest
import seaborn as sns
from plotly.subplots import make_subplots

import datawalk as dw
from datawalk.adapters import find_adapter


def test_matplotlib_metadata_and_series():
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.plot([1, 2, 3], [4, 5, 6], label="price")
    ax.axhline(5)  # reference line: not data
    ax.scatter([1, 2], [3, 4], label="trades")
    ax.set(title="Correlation", xlabel="returns", ylabel="volatility", yscale="log")
    ax.legend()
    imp = find_adapter(fig).import_(fig)
    s = imp.source
    assert (s.library, s.title, s.mode, s.aspect) == (
        "matplotlib",
        "Correlation",
        "structured",
        2.0,
    )
    assert s.axes[0].y.scale == "log" and s.axes[0].legend == ["price", "trades"]
    assert [(x["name"], x["kind"]) for x in imp.payload["series"]] == [
        ("price", "line"),
        ("trades", "scatter"),
    ]
    assert imp.payload["series"][0]["y"] == [4.0, 5.0, 6.0]
    assert imp.preview_png.startswith(b"\x89PNG")


def test_matplotlib_dates_and_categories_keep_real_values():
    fig, (a, b) = plt.subplots(1, 2)
    a.plot(pd.date_range("2024-01-01", periods=2), [1.0, np.nan])
    b.plot(["low", "high"], [1, 2])
    b.scatter(["low", "high"], [1, 2])  # categorical positions: not extracted
    series = find_adapter(fig).serialize(fig)["series"]
    assert series[0]["x"][0].startswith("2024-01-01") and series[0]["y"] == [1.0, None]
    assert series[1]["x"] == ["low", "high"]
    assert len(series) == 2


def test_matplotlib_image_only_is_static_and_says_so():
    fig, ax = plt.subplots()
    sns.heatmap(np.eye(3), ax=ax)  # adds an untitled colorbar axes
    ax.set_title("Correlations")
    s = find_adapter(ax).import_(ax).source  # an Axes resolves to its figure
    assert (s.mode, s.chart_type, s.has_payload) == ("static", "heatmap", False)
    assert s.title == "Correlations"
    assert "heatmap cells" in s.limitations[0]


def test_seaborn_grid_keeps_facets():
    df = pd.DataFrame({"x": [1, 2, 3, 4], "y": [1, 3, 2, 4], "g": ["a", "a", "b", "b"]})
    grid = sns.relplot(df, x="x", y="y", col="g")
    imp = find_adapter(grid).import_(grid)
    assert imp.source.library == "seaborn"
    assert [a.title for a in imp.source.axes] == ["g = a", "g = b"]
    assert imp.source.mode == "structured"


def test_plotly_figure_is_interactive():
    fig = make_subplots(rows=1, cols=2)
    fig.add_trace(go.Scatter(x=[1, 2], y=[3, 4], mode="markers", name="a"), 1, 1)
    fig.add_trace(go.Bar(x=["p", "q"], y=[1, 2], name="b"), 1, 2)
    fig.update_layout(title="<b>Model</b> comparison", xaxis_title="Recall", yaxis2_type="log")
    imp = find_adapter(fig).import_(fig)
    s = imp.source
    assert (s.title, s.mode, s.chart_type, s.has_preview) == (
        "Model comparison",
        "interactive",
        "scatter",
        False,
    )
    assert [a.legend for a in s.axes] == [["a"], ["b"]]
    assert s.axes[0].x.label == "Recall" and s.axes[1].y.scale == "log"
    assert imp.payload["figure"]["data"][1]["type"] == "bar"


def test_plotly_3d_axes():
    fig = px.scatter_3d(x=[1, 2], y=[3, 4], z=[5, 6], labels={"x": "a", "y": "b", "z": "c"})
    s = find_adapter(fig).extract_metadata(fig)
    assert s.axes[0].z.label == "c" and s.chart_type == "scatter3d"


def test_unsupported_object_is_rejected():
    with pytest.raises(TypeError, match="No adapter"):
        dw.Report("r").add(object(), key="x")
