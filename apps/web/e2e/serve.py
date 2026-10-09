"""Serve a report for browser tests: serve.py PORT [notebook|sources]. The fixed editor token
is "e2e-token". The report is saved to a temporary archive, so editor saves are real."""

import runpy
import sys
import tempfile
from pathlib import Path

import uvicorn

import datawalk as dw
from datawalk.server import create_app

examples = Path(__file__).resolve().parents[3] / "examples"
if sys.argv[2:] == ["notebook"]:  # the notebook importer example
    report = dw.Report.from_notebook(examples / "notebook" / "retail_analysis.ipynb")
elif sys.argv[2:] == ["sources"]:  # Altair, Bokeh, Styler, files, MLflow, PDF
    report = runpy.run_path(str(examples / "other_sources.py"))["report"]
else:
    report = runpy.run_path(str(examples / "financial_research.py"))["report"]
report.save(Path(tempfile.mkdtemp()) / "e2e.dwk")
uvicorn.run(
    create_app(report, token="e2e-token"),
    host="127.0.0.1",
    port=int(sys.argv[1]),
    log_level="warning",
)
