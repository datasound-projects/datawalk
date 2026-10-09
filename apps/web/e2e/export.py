"""Export the demo report for browser tests: e2e/export.py <out-dir>
Writes report.html (single file) and site/ (static site), both with a watermark, the
datasets, and one chart reduced to its preview image."""

import runpy
import sys
from pathlib import Path

import datawalk as dw
from datawalk.export import ExportOptions, prepare, write_html, write_site

out = Path(sys.argv[1])
demo = Path(__file__).resolve().parents[3] / "examples" / "financial_research.py"
report = runpy.run_path(str(demo))["report"]
bundle = prepare(
    report, ExportOptions({"returns_dist"}, include_datasets=True, watermark="E2E copy")
)
write_html(bundle, out / "report.html")
write_site(bundle, out / "site")

# A report without Plotly and Vega-Lite charts gets the lite viewer.
import matplotlib.pyplot as plt  # noqa: E402

lite = dw.Report("Lite Report")
fig, ax = plt.subplots()
ax.plot([1, 3, 2])
ax.set_title("Line")
lite.add(fig, key="line", room="Main")
lite.add_kpi("count", "Count", 42, room="Main")
write_html(prepare(lite), out / "lite.html")
