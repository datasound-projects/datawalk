"""Write and execute examples/notebook/retail_analysis.ipynb, the notebook importer example.

Run:  uv run --extra notebook python examples/notebook/make_notebook.py
Then: uv run datawalk import examples/notebook/retail_analysis.ipynb -o retail.dwk
All data is randomly generated.
"""

from pathlib import Path

import nbformat
from nbclient import NotebookClient

md = nbformat.v4.new_markdown_cell
code = nbformat.v4.new_code_cell

cells = [
    md(
        "# Retail Sales Analysis\n\nSynthetic data for the notebook importer example. "
        "No number in this notebook describes a real business."
    ),
    code(
        "import numpy as np\nimport pandas as pd\nimport matplotlib.pyplot as plt\n"
        "import plotly.express as px\nimport plotly.io as pio\n"
        "from IPython.display import SVG, display\n\n"
        "pio.renderers.default = 'plotly_mimetype'  # store the figure JSON in the notebook\n"
        "rng = np.random.default_rng(7)\n"
        "months = pd.date_range('2025-01-01', periods=18, freq='MS')\n"
        "revenue = 120 + np.cumsum(rng.normal(2, 6, 18))\n"
        "sales = pd.DataFrame({'month': months, 'revenue': revenue.round(1)})"
    ),
    md("## Sales Overview\n\nMonthly revenue in thousand EUR, all stores."),
    md("Revenue per month. Hover a point for the exact value."),
    code(
        "px.line(sales, x='month', y='revenue', title='Monthly Revenue', "
        "labels={'revenue': 'Revenue (k EUR)'})"
    ),
    md("The last six months as a table."),
    code("sales.tail(6).set_index('month')"),
    code(
        "round(float(sales['revenue'].sum()), 1)",
        metadata={
            "datawalk": {
                "key": "total_revenue",
                "kpi": {"label": "Total revenue", "unit": "k EUR", "fmt": ",.1f"},
            }
        },
    ),
    md("## Customer Segments"),
    md("### Segment profiles"),
    md("Basket size per segment (synthetic)."),
    code(
        "seg = pd.DataFrame({'segment': ['Family', 'Single', 'Senior', 'Student'], "
        "'basket': [54.2, 31.0, 38.5, 22.9]})\n"
        "fig, ax = plt.subplots(figsize=(6, 4))\nax.bar(seg['segment'], seg['basket'])\n"
        "ax.set(title='Average Basket', ylabel='EUR')\nplt.show()"
    ),
    md("Visits per week and segment."),
    code(
        "fig, ax = plt.subplots(figsize=(6, 4))\n"
        "ax.bar(seg['segment'], [2.1, 3.4, 1.8, 2.7], color='#c0392b')\n"
        "ax.set(title='Weekly Visits', ylabel='Visits')\nplt.show()"
    ),
    md("### Loyalty"),
    md("Share of revenue from loyalty-card holders, as a vector image."),
    code(
        "import io\nfig, ax = plt.subplots(figsize=(5, 4))\n"
        "ax.pie([62, 38], labels=['Card holders', 'Others'], autopct='%1.0f%%')\n"
        "ax.set_title('Loyalty Share')\nbuf = io.StringIO()\nfig.savefig(buf, format='svg')\n"
        "plt.close(fig)\nSVG(buf.getvalue())"
    ),
    md("## Forecast"),
    md(
        "**Method.** A linear trend on the last 12 months. It ignores seasonality.",
        metadata={"datawalk": {"text": True, "name": "Forecast method"}},
    ),
    md("Trend forecast for the next six months (Vega-Lite)."),
    code(
        "t = np.arange(18)\nslope, icpt = np.polyfit(t[-12:], revenue[-12:], 1)\n"
        "future = pd.date_range(months[-1], periods=7, freq='MS')[1:]\n"
        "rows = [{'month': str(m.date()), 'revenue': float(v), 'kind': 'actual'} "
        "for m, v in zip(months, revenue)]\n"
        "rows += [{'month': str(m.date()), 'revenue': float(icpt + slope * (18 + i)), "
        "'kind': 'forecast'} for i, m in enumerate(future)]\n"
        "spec = {'$schema': 'https://vega.github.io/schema/vega-lite/v5.json', "
        "'title': 'Revenue Forecast', 'width': 600, 'height': 300, "
        "'data': {'values': rows}, 'mark': {'type': 'line', 'point': True}, "
        "'encoding': {'x': {'field': 'month', 'type': 'temporal', 'title': 'Month'}, "
        "'y': {'field': 'revenue', 'type': 'quantitative', 'title': 'Revenue (k EUR)'}, "
        "'color': {'field': 'kind', 'type': 'nominal'}}}\n"
        "display({'application/vnd.vegalite.v5+json': spec}, raw=True)"
    ),
    code("print('A stream output is not a chart and is not imported.')"),
]

nb = nbformat.v4.new_notebook(cells=cells)
nb.metadata["kernelspec"] = {"name": "python3", "display_name": "Python 3", "language": "python"}
out = Path(__file__).with_name("retail_analysis.ipynb")
NotebookClient(
    nb, timeout=120, kernel_name="python3", resources={"metadata": {"path": str(out.parent)}}
).execute()
nbformat.write(nb, out)
print("Wrote", out)
