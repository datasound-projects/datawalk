"""Write generated/example-report.json: the Python/TypeScript contract fixture.

Run: uv run python packages/schema/make_example.py
The report sets every field, so strict parsing on both sides catches drift.
"""

import json
from pathlib import Path

import numpy as np
import plotly.graph_objects as go

from datawalk.core.models import (
    AxesInfo,
    Axis,
    Brand,
    Dashboard,
    Dataset,
    Explanation,
    Link,
    Overrides,
    Placement,
    Provenance,
    ReportModel,
    Room,
    Source,
    TourStop,
    Visualization,
)

A, B, D, R = "a" * 32, "c" * 32, "d" * 32, "b" * 32


def decode_cases() -> list[dict]:
    """Plotly.py encodes numpy arrays as base64 typed arrays; the viewer decodes them."""
    arrays = [
        np.array([1.5, -2.25, 1e-300, 3e300]),
        np.array([1, -2, 3], dtype=np.int32),
        np.array([7, 8], dtype=np.uint8),
        np.array([0.5, 0.25], dtype=np.float32),
        np.arange(6, dtype=np.int16).reshape(2, 3),
    ]
    cases = []
    for arr in arrays:
        fig = go.Figure(go.Surface(z=arr) if arr.ndim == 2 else go.Scatter3d(x=arr, y=arr, z=arr))
        encoded = json.loads(fig.to_json())["data"][0]["z"]
        cases.append({"encoded": encoded, "values": arr.ravel().tolist(), "shape": list(arr.shape)})
    return cases


def main() -> None:
    source = Source(
        library="matplotlib",
        chart_type="line",
        mode="structured",
        title="Price",
        axes=[
            AxesInfo(
                title="Price",
                x=Axis(label="date", scale="linear"),
                y=Axis(label="USD", scale="log"),
                z=Axis(label="depth"),
                legend=["close"],
            )
        ],
        aspect=1.5,
        default_name="Price",
        limitations=["Bars are image-only"],
        has_preview=True,
        has_payload=True,
        provenance=Provenance(
            kind="notebook",
            path="analysis.ipynb",
            sha256="0" * 64,
            cell_id="abc",
            output_index=0,
            execution_count=3,
            code="plot()",
        ),
    )
    explanation = Explanation(
        what_it_shows="a",
        inputs="b",
        units="USD",
        data_source="synthetic",
        findings=["Up"],
        interpretation="c",
        methodology="d",
        assumptions="e",
        limitations="f",
        author="g",
    )
    report = ReportModel(
        id="0" * 31 + "1",
        name="Example",
        description="Contract fixture",
        author="Analytics team",
        date="2026-10-01",
        data_cutoff="2026-09-30",
        classification="Confidential",
        theme="dark_gallery",
        revision=2,
        visualizations=[
            Visualization(
                id=A,
                key="price",
                source=source,
                overrides=Overrides(
                    name="Bitcoin Price",
                    description="Daily",
                    explanation=explanation,
                    edited=["name", "explanation.findings"],
                ),
                status="removed",
            ),
            Visualization(id=B, key="acc", source=source),
        ],
        dashboards=[
            Dashboard(id=D, key="Overview", name="Overview", description="Two", items=[A, B])
        ],
        links=[Link(id="e" * 32, key="Market", name="Market", items=[A, B], on="x")],
        datasets=[
            Dataset(
                id="f" * 32,
                key="prices",
                name="Prices",
                description="Daily close",
                columns=["date", "close"],
                rows=2,
                visualizations=[A],
            )
        ],
        rooms=[
            Room(
                id=R,
                key="Market",
                name="Market",
                description="Overview",
                theme="executive_office",
                items=[A, D],
                placements={A: Placement(wall="east", u=0.25, v=0.5, width=2.0, locked=True)},
            )
        ],
        tour=[
            TourStop(id="9" * 32, ref=R, notes="Start here.", duration=8.5),
            TourStop(id="8" * 32, ref=D),
        ],
        brand=Brand(
            name="Contoso",
            frame="#112233",
            plaque="#ffffff",
            plaque_text="#111111",
            accent="#0055aa",
            has_logo=False,
        ),
        edited=["tour"],
    )
    payloads = [
        {
            "kind": "series",
            "series": [
                {
                    "axes": 0,
                    "name": "close",
                    "kind": "line",
                    "x": ["2024-01-01", 2.5],
                    "y": [1.0, None],
                }
            ],
        },
        {"kind": "plotly", "figure": {"data": [{"type": "scatter", "y": [1, 2]}], "layout": {}}},
        {
            "kind": "kpi",
            "value": 0.873,
            "display": "87.3%",
            "unit": "",
            "delta": 0.012,
            "delta_display": "+1.2%",
            "higher_is_better": True,
        },
        {
            "kind": "table",
            "columns": ["id", "x", "ok"],
            "rows": [["p", 1.5, True], ["q", None, False]],
            "total_rows": 2,
        },
        {"kind": "text", "markdown": "**Up** 3 %", "links": ["price"]},
        {"kind": "vegalite", "spec": {"mark": "bar", "data": {"values": [{"a": 1}]}}},
        {"kind": "svg", "svg": '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"/>'},
        {"kind": "bokeh", "item": {"root_id": "p1", "doc": {}}, "version": "3.10.0"},
    ]
    out = Path(__file__).parent / "generated" / "example-report.json"
    doc = {"report": report.model_dump(mode="json"), "payloads": payloads, "decode": decode_cases()}
    out.write_text(json.dumps(doc, indent=2) + "\n")


if __name__ == "__main__":
    main()
