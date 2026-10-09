"""Financial Market Research: the DataWalk demo (25 visualizations from synthetic data).

Run:  uv run python examples/financial_research.py [--port 8765] [--no-browser] [--save out.dwk]
The same as `datawalk demo`. The report itself is built in datawalk/demo.py.
"""

import argparse

import matplotlib

matplotlib.use("Agg")

from datawalk.demo import build  # noqa: E402

report = build()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int)
    p.add_argument("--no-browser", action="store_true")
    p.add_argument("--save", help="save to this .dwk file (keeps earlier edits in it)")
    p.add_argument("--view-only", action="store_true", help="stakeholder view, no editor")
    args = p.parse_args()
    if args.save:
        print("Saved", report.save(args.save))
    report.show(port=args.port, open_browser=not args.no_browser, edit=not args.view_only)
