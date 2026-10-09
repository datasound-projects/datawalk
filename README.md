# DataWalk

**Walk through your data. Share it. Explore your insights.**

Turn plots, notebooks, dashboards, and presentations into immersive, walkable 3D worlds.

DataWalk turns the charts that you make in Python, notebooks, and other tools into a
walkable 3D world in the browser. Analysts register charts in Python or import a notebook.
Stakeholders walk the rooms, inspect each chart, follow a guided tour, or read the same
report as a flat, accessible page. No installation is necessary to view an exported report.

> **Status: alpha (0.1.0.dev0).** All features in this file work and have tests. See
> [docs/production-readiness.md](docs/production-readiness.md) for the verified readiness
> criteria and the known limitations, and [docs/roadmap.md](docs/roadmap.md) for each phase.

## Quick start

```bash
pip install "datawalk[all]"   # every feature; smaller sets: docs/install.md
datawalk demo                 # a demo report (synthetic data) opens in the browser
```

> **Note:** The name `datawalk` on PyPI belongs to another project at this time. Until
> DataWalk is published, install it from a wheel or a source checkout: see
> [docs/install.md](docs/install.md).

From Python:

```python
import datawalk as dw

report = dw.Report("Bitcoin Research", theme="executive_office")
report.add(price_fig, key="price", name="Bitcoin Price", room="Market Overview")
report.add(corr_fig, key="correlations", room="Feature Analysis")
report.add_kpi("ret", "Total Return", 0.183, fmt="+.1%", room="Market Overview")
report.add(metrics_df, key="metrics", room="Model Evaluation")  # a pandas table
report.add_summary(kpis=["ret"], findings=[("Returns doubled in Q3.", ["price"])])
report.save("bitcoin-research.dwk")
report.show()  # opens the editor at http://127.0.0.1:<port>/
```

`datawalk demo` builds a demo report (25 visualizations in 4 rooms, synthetic data), saves
it as `datawalk-demo.dwk`, and opens the editor. Press Ctrl+C in the terminal to stop.

Open, export, or check a report:

```bash
datawalk open analysis.ipynb             # a Jupyter notebook as a 3D report (one command)
datawalk open report.dwk                 # stakeholder view (read-only)
datawalk open report.dwk --edit          # editor; Save writes to the file
datawalk export report.dwk               # one HTML file that works offline
datawalk doctor                          # check the environment and the extras
```

## What you can do

| Area | Features | Documentation |
|---|---|---|
| Sources | Matplotlib, Seaborn, Plotly, pandas, Altair, Bokeh, pandas Styler, Jupyter notebooks, PNG, JPEG, SVG, CSV, Excel, Markdown, Plotly and Vega-Lite JSON, MLflow runs, PDF pages | [docs/sources.md](docs/sources.md) |
| Rooms | 10 realistic themes (CC0 assets from Poly Haven), dashboards, KPIs, tables, text panels, 3D exhibits, executive summary room, linked views | [docs/architecture.md](docs/architecture.md) |
| Editor | Names, explanations, rooms, dashboards, themes, arrange mode, guided tour, export review, undo and redo | [docs/presenting.md](docs/presenting.md) |
| Presenting | Guided tour with a clicker, presenter view on a second screen, kiosk mode, screen-share mode, tour video | [docs/presenting.md](docs/presenting.md) |
| Sharing | Single HTML file, static site, PDF, PowerPoint, GLB and USDZ 3D files, flat view (WCAG 2.2 AA), mandatory export review, watermarks | [docs/exports.md](docs/exports.md) |
| Hub (optional) | Self-hosted server: OIDC and SAML sign-in, permissions, revisions with changes, comments, audit log, encryption at rest, embedding, live follow | [docs/hub.md](docs/hub.md) |
| Governance | Classification labels with export policies, report-as-code CI recipe, `datawalk doctor`, localization | [docs/governance.md](docs/governance.md) |

## Your edits survive analysis reruns

Rename charts, write findings, move charts between rooms, group dashboards, set the tour,
and arrange displays in the browser editor. Then run your analysis again.
`report.save(path)` finds the existing file and keeps the presentation. Charts whose keys
are gone stay in the report, marked "removed". A notebook import works the same way: import
the re-executed notebook into the same file, and the editor changes stay.

## Controls

| Input | Action |
|---|---|
| W A S D or arrow keys | Walk (left and right arrows turn) |
| Mouse | Look around (after you click **Enter room**) |
| E or left click | Inspect the chart under the crosshair |
| M | Room map; click a chart to stand in front of it |
| Tab (while walking) | Rooms and charts navigator; in the lobby and in dialogs, Tab moves the focus |
| Page Down / Page Up | Guided tour, next and previous stop (presentation clickers work) |
| P | Presenter view (during the tour) |
| Esc | Release the mouse, pause, close a dialog or the editor, or end the tour |

On phones and tablets, a report opens in the flat view. In 3D on a touch screen, drag to
look around and use the on-screen buttons (map, rooms, inspect, and the tour controls).

## Privacy and security

DataWalk needs no cloud service and no AI service. It never writes findings or summaries
itself: all text in a report comes from the analyst. The local server listens on
`127.0.0.1` only and is read-only without the editor token. Every export is a data release:
the export review shows what leaves the machine before anything is written. See
[docs/architecture.md](docs/architecture.md#security).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under the [MIT License](LICENSE). Asset
credits: [docs/credits.md](docs/credits.md).
