# Sources

DataWalk imports charts, tables, and text from Python objects, files, notebooks, and MLflow
runs. Each import keeps the most exact form of the content that it can recover. DataWalk
never claims data that it cannot recover. The inspector shows the mode of each chart and
its limitations.

| Mode | Meaning |
|---|---|
| Interactive (A) | The original chart: zoom, pan, hover, and exact values |
| Structured (B) | An image and exactly recovered values (Matplotlib lines and scatter points), or a table, KPI, or text |
| Static (C) | An image only. No data values are available |

## Python objects

Give the object to `report.add(obj, key=..., room=...)`. The key must be stable between
runs: a rerun matches charts by key. A key is part of the chart's link (`#viz-<key>`): use
letters, digits, `_`, `-`, `.`, or `/`, and no spaces, `#`, `?`, or `%`. A key that the
report has already is an error; `update=True` replaces its source and keeps the editor
changes.

| Library | Objects | Mode | Extra |
|---|---|---|---|
| Plotly | `go.Figure`, Plotly Express | A | `datawalk[plotly]` |
| Matplotlib | `Figure`, `SubFigure`, `Axes` | B (lines, scatter) or C | `datawalk[matplotlib]` |
| Seaborn | `FacetGrid`, `PairGrid`, `JointGrid`, axes-level plots | Same as Matplotlib | `datawalk[seaborn]` |
| pandas | `DataFrame` (10,000 rows at most) | Table | pandas |
| pandas | `Styler` (the values; colors and number formats are not kept) | Table | pandas |
| Altair | Any chart (Vega-Lite) | A | altair |
| Bokeh | A plot or layout (`json_item`) | A | bokeh (see below) |

Plotly `scatter3d` and `surface` figures also stand in the room as native 3D exhibits.

**Altair and Vega-Lite.** The viewer renders the specification with Vega. The viewer loads
no external data. Keep the data inline in the specification (the Altair default). A chart
that loads data from a URL shows a limitation in the inspector and can be empty.

**Bokeh.** The viewer renders the chart with BokehJS of the same version as the Python
`bokeh` package that made the chart. The viewer takes BokehJS from the `bokeh` package on the
machine that serves or exports the report. Install the same version there, for example
`pip install bokeh==3.10.0`. A single-file export contains BokehJS (about 1.5 MB).
DataWalk removes JavaScript callbacks (`CustomJS` and other models with code) from Bokeh
charts: a report must not run code in the viewer of the person who opens it. Zoom, pan,
hover, and selections work; callbacks do not.

## Other content

| Call | Content |
|---|---|
| `report.add_kpi(key, label, value, unit=, fmt=, delta=, delta_fmt=, higher_is_better=)` | A key figure |
| `report.add_kpis(path_or_df, mapping, room=)` | KPIs from a DataFrame, CSV, or Excel file, by explicit mapping (see below) |
| `report.add_text(key, markdown, name=, room=, links=)` | A text panel: narrative, context, or an agenda |
| `report.add_dashboard(name, keys, room=)` | Several charts on one display |
| `report.add_summary(kpis, findings, author=, date=, data_cutoff=)` | The executive summary room (see below) |
| `report.attach_dataset(df, key, name=, visualizations=)` | A CSV download for the charts (in exports only on request) |
| `report.link(keys, name=)` | Charts that share x values: a selection in one shows in all |

**KPIs by explicit mapping.** DataWalk does not guess which number is a KPI. Name the
column and the reduction:

```python
report.add_kpis(
    "sales.csv",
    {
        "revenue": {
            "label": "Revenue, 12 months",
            "column": "revenue",
            "agg": "sum",
            "unit": "k EUR",
        },
        "last": {"label": "Last month", "column": "revenue", "delta_row": -2, "fmt": ",.1f"},
    },
)
```

`agg` is `last` (default), `first`, `sum`, `mean`, `min`, `max`, or `count`. `row` takes one
row (for example `-1`). `delta_agg` or `delta_row` gives the comparison value for the change.
A misspelled setting, a sum or mean of a text column, and a row that does not exist are
errors, never a wrong number. The other settings are `label`, `unit`, `fmt`, `delta_fmt`, and
`higher_is_better`.

**Text panels.** Markdown supports headings, paragraphs, lists, bold, italic, code, and
links. DataWalk never interprets HTML in Markdown: it shows raw HTML as text. Links keep only
`http(s)`, `mailto`, and in-page targets.

**Executive summary.** `add_summary` adds the first room of the report. The KPI wall faces
the entrance. Up to three findings stand on text panels, and each one links to its
supporting charts. A panel shows the author, the date, and the data cut-off date.
DataWalk never writes findings: without findings, the room shows the KPIs only. A text
panel without a name takes its first Markdown heading as its name.

```python
report.add_summary(
    kpis=["revenue", "accuracy"],
    findings=[
        ("Volatility doubled in Q3.", ["volatility"]),
        ("The model beats the baseline by 4 points.", ["model_comparison"]),
    ],
    author="Risk team",
    date="2026-10-01",
    data_cutoff="2026-09-30",
)
```

## Files

Give a file path (a `pathlib.Path` or a string with a suffix) to `report.add`:

| Suffix | Result |
|---|---|
| `.png`, `.jpg`, `.jpeg` | Static chart (JPEG becomes PNG; needs Pillow) |
| `.svg` | Static vector chart. DataWalk removes scripts, event handlers, foreign content, and external references |
| `.csv`, `.tsv`, `.xlsx`, `.xls` | Table (Excel needs `datawalk[excel]`). DataFrames and tables keep 10,000 rows at most; the inspector says when rows are left out |
| `.md` | Text panel |
| `.json` | A Plotly figure (`{"data", "layout"}`) or a Vega-Lite specification (`$schema`) |

The inspector shows the file path and its SHA-256 hash.

## Jupyter notebooks

```bash
datawalk import analysis.ipynb -o analysis.dwk
```

```python
report = dw.Report.from_notebook("analysis.ipynb")
```

One command opens a notebook as a 3D report: `datawalk open analysis.ipynb`. It imports the
notebook into `analysis.dwk` (next to the notebook) and opens it. Add `--edit` for the
editor.

DataWalk reads the stored outputs. It does not run code unless you add `--execute`
(`execute=True`). Then it runs the notebook with nbclient in a separate process, in the
notebook's folder (relative data paths work as in Jupyter), with a timeout (`--timeout`,
default 600 s). Execution needs `datawalk[notebook]`.

A notebook without outputs that DataWalk can show (never run, or only text and errors) is
an error, and nothing is written. After an import, DataWalk lists the outputs that it did not
show (for example `Not shown: 2 text output, 1 error`).

| Notebook element | Result |
|---|---|
| H1 heading | Report name (unless you give one) |
| H2 heading | Room. Text in the same cell becomes the room description |
| H3 heading | Dashboard group (when it holds two or more outputs) |
| Markdown before an output | Description of that output (its first sentence names an untitled image or table) |
| `image/png`, `image/jpeg`, `image/svg+xml` | Static chart (SVG is sanitized) |
| `application/vnd.plotly.v1+json` | Interactive Plotly chart |
| `application/vnd.vegalite.v5+json` (v3 to v6) | Interactive Vega-Lite chart |
| pandas HTML, `application/vnd.dataresource+json` | Table |
| Stream output, errors | Not imported |
| Code | Hidden. The inspector has **Show source** |

Cell metadata gives explicit control:

```json
{"datawalk": {"key": "revenue_kpi", "room": "Overview", "name": "Revenue", "skip": false,
               "kpi": {"label": "Revenue", "unit": "EUR", "fmt": ",.0f"}, "text": false}}
```

`kpi` takes the cell's `text/plain` result as the value. `text: true` on a Markdown cell makes
a text panel.

The key of an output is `<cell id>-<output index>`. Import the re-executed notebook into the
same `.dwk` file: the import updates the charts by key, and the editor changes stay. This
needs cell ids (nbformat 4.5 and later; Jupyter adds them when it saves). Without cell ids,
keys follow the cell positions, so a new cell changes them; DataWalk warns about this.
The inspector shows the notebook path, the cell id, the execution count, and the file hash.

## Other tools (Tier 2)

| Source | Path |
|---|---|
| Quarto | Render with `keep-ipynb: true`, then import the `.ipynb` file |
| Jupyter Book | Import the source notebooks (`.ipynb`) of the book |
| R Markdown and R | Save charts as Plotly JSON (`plotly::plotly_json`), Vega-Lite JSON, or images, and add the files |
| PDF pages | `report.add_pdf(path, pages=[1, 2], room=...)`: each page becomes a static chart. Needs `datawalk[pdf-import]` |
| MLflow | `report.add_mlflow_run("mlruns/0/<run id>")` or a run id (needs `mlflow`): metrics become KPIs (last value, change since the first step), logged images and figures become charts, parameters become a table |
| Power BI, Tableau | Export to PDF or images, and add those (DataWalk does not read their files) |

## Write an adapter

See [CONTRIBUTING.md](../CONTRIBUTING.md#write-an-adapter).
