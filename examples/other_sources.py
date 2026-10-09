"""Other sources: Altair, Bokeh, a pandas Styler, files, KPIs from a CSV file, an MLflow run,
and PDF pages, in one report. All data is randomly generated.

Run:  uv run python examples/other_sources.py [--port 8765] [--no-browser] [--save out.dwk]
Needs: altair, bokeh, pypdfium2 (dev dependencies of this repository).
"""

import argparse
import tempfile
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import altair as alt  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from bokeh.plotting import figure  # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402

import datawalk as dw  # noqa: E402

rng = np.random.default_rng(3)
work = Path(tempfile.mkdtemp())
report = dw.Report("Other Sources", description="Synthetic data from several tools and file types.")

# -- Libraries ----------------------------------------------------------------------
weeks = pd.DataFrame({"week": np.arange(1, 27), "orders": 200 + rng.normal(0, 15, 26).cumsum()})
chart = (
    alt.Chart(weeks, title="Orders per Week (Altair)")
    .mark_line(point=True)
    .encode(
        x=alt.X("week:Q", title="Week"),
        y=alt.Y("orders:Q", title="Orders"),
        tooltip=["week", "orders"],
    )
)
report.add(chart, key="altair_orders", room="Libraries")

p = figure(
    title="Response Time (Bokeh)", width=640, height=360, x_axis_label="Hour", y_axis_label="ms"
)
hours = np.arange(24)
p.line(hours, 120 + 40 * np.sin(hours / 24 * 2 * np.pi) + rng.normal(0, 5, 24), line_width=2)
report.add(p, key="bokeh_latency", room="Libraries")

regions = pd.DataFrame(
    {"region": ["North", "South", "East", "West"], "growth": rng.normal(0.03, 0.02, 4)}
)
report.add(
    regions.style.format({"growth": "{:.1%}"}).set_caption("Regional Growth (Styler)"),
    key="styler",
    room="Libraries",
)

# -- Files --------------------------------------------------------------------------
fig, ax = plt.subplots(figsize=(6, 3.5))
ax.hist(rng.normal(0, 1, 500), bins=30)
ax.set_title("Error Distribution")
fig.savefig(work / "error_distribution.png", dpi=120)
fig.savefig(work / "error_distribution.svg")
plt.close(fig)
(work / "notes.md").write_text(
    "# Agenda\n\n1. Orders and latency\n2. Regional growth\n3. Model run\n\n"
    "**Data:** synthetic, for the importer example."
)
sales = pd.DataFrame({"month": pd.date_range("2025-01-01", periods=12, freq="MS").strftime("%Y-%m"),
                      "revenue": (100 + rng.normal(3, 4, 12).cumsum()).round(1)})  # fmt: skip
sales.to_csv(work / "sales.csv", index=False)
report.add(work / "notes.md", key="agenda", room="Files")
report.add(work / "error_distribution.png", key="file_png", room="Files")
report.add(work / "error_distribution.svg", key="file_svg", room="Files")
report.add(work / "sales.csv", key="file_csv", room="Files")
report.add_kpis(
    work / "sales.csv",
    {
        "revenue_total": {
            "label": "Revenue, 12 months",
            "column": "revenue",
            "agg": "sum",
            "fmt": ",.0f",
        },
        "revenue_last": {
            "label": "Revenue, last month",
            "column": "revenue",
            "delta_row": -2,
            "fmt": ",.1f",
            "delta_fmt": "+.1f",
        },
    },
    room="Files",
)

# -- An MLflow run (file store layout) and PDF pages ----------------------------------
run = work / "mlruns" / "0" / "run1"
for d in ("metrics", "params", "artifacts"):
    (run / d).mkdir(parents=True)
(run / "meta.yaml").write_text("run_id: run1\nrun_name: churn-model\n")
(run / "metrics" / "auc").write_text("".join(f"0 {0.6 + 0.02 * i:.3f} {i}\n" for i in range(5)))
(run / "metrics" / "log_loss").write_text(
    "".join(f"0 {0.7 - 0.03 * i:.3f} {i}\n" for i in range(5))
)
(run / "params" / "max_depth").write_text("6")
(run / "params" / "learning_rate").write_text("0.05")
fig, ax = plt.subplots(figsize=(6, 3.5))
ax.plot([0.7 - 0.03 * i for i in range(5)])
ax.set(title="Training Loss", xlabel="Epoch", ylabel="Log loss")
fig.savefig(run / "artifacts" / "loss.png", dpi=120)
plt.close(fig)
report.add_mlflow_run(run, room="Model Run")

with PdfPages(work / "bi_export.pdf") as pdf:
    for region in ("North", "South"):
        fig, ax = plt.subplots(figsize=(8, 4.5))
        ax.bar(["Q1", "Q2", "Q3", "Q4"], rng.uniform(50, 100, 4))
        ax.set_title(f"BI export: {region}")
        pdf.savefig(fig)
        plt.close(fig)
report.add_pdf(work / "bi_export.pdf", room="Model Run")

if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--port", type=int)
    a.add_argument("--no-browser", action="store_true")
    a.add_argument("--save")
    args = a.parse_args()
    if args.save:
        print("Saved", report.save(args.save))
    report.show(port=args.port, open_browser=not args.no_browser)
