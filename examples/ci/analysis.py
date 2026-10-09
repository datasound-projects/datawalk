"""Example analysis for the report-as-code recipe. It reads data.csv (month, revenue).

python analysis.py --save report.dwk
"""

import argparse

import pandas as pd
import plotly.express as px

import datawalk as dw

p = argparse.ArgumentParser()
p.add_argument("--save", required=True)
p.add_argument("--data", default="data.csv")
args = p.parse_args()

sales = pd.read_csv(args.data)
report = dw.Report("Monthly Revenue", description="Rebuilt by CI from data.csv.")
trend = px.line(sales, x="month", y="revenue", title="Revenue Trend")
report.add(trend, key="trend", room="Revenue")
total = float(sales["revenue"].sum())
report.add_kpi("total", "Total revenue", total, unit="k EUR", fmt=",.1f", room="Revenue")
report.save(args.save)  # merges with the pulled revision: presentation edits stay
print("Saved", args.save)
