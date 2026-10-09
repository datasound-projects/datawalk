"""What changed between two revisions: added, removed, and updated visualizations, and the
change of every key figure (KPI)."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from datawalk import Report


def _fingerprint(report: Report, vid: str) -> str:
    payload = report._payloads.get(vid)
    data = (
        json.dumps(payload, sort_keys=True).encode() if payload else report._previews.get(vid, b"")
    )
    return hashlib.sha256(data).hexdigest()


def changes(old: Report | None, new: Report) -> dict[str, Any]:
    now = {v.key: v for v in new.visualizations if v.status == "active"}
    before = {v.key: v for v in old.visualizations if v.status == "active"} if old else {}
    updated = []
    kpis = []
    for key in sorted(now.keys() & before.keys()):
        a, b = before[key], now[key]
        if _fingerprint(old, a.id) != _fingerprint(new, b.id) or a.overrides != b.overrides:
            updated.append({"key": key, "name": b.name})
        if b.source.chart_type == "kpi":
            pa, pb = old._payloads.get(a.id) or {}, new._payloads.get(b.id) or {}
            if pa.get("value") != pb.get("value"):
                delta = None
                if isinstance(pa.get("value"), int | float) and isinstance(
                    pb.get("value"), int | float
                ):
                    delta = pb["value"] - pa["value"]
                kpis.append(
                    {
                        "key": key,
                        "name": b.name,
                        "before": pa.get("display"),
                        "after": pb.get("display"),
                        "delta": delta,
                        "unit": pb.get("unit", ""),
                    }
                )
    return {
        "added": [{"key": k, "name": now[k].name} for k in sorted(now.keys() - before.keys())],
        "removed": [{"key": k, "name": before[k].name} for k in sorted(before.keys() - now.keys())],
        "updated": updated,
        "kpis": kpis,
    }
