"""Classification labels and their export policies.

A report can have a label ("Confidential"). The label shows in every view and export. Each
label has an export policy. The organization can replace the built-in policies with a JSON
file in the DATAWALK_POLICY variable:

    {"labels": {"Confidential": {"public_links": false, "datasets": false, "watermark": true}}}

Policy fields (all optional; the default allows the action):
    public_links  hub links without sign-in
    datasets      attached datasets in exports
    data          chart data in exports (false: preview images only)
    watermark     a recipient watermark is required for every export
    formats       allowed export formats: html, site, pdf, pptx, glb, usdz, video
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

FORMATS = ("html", "site", "pdf", "pptx", "glb", "usdz", "video")

BUILT_IN = {
    "Public": {},
    "Internal": {"public_links": False},
    "Confidential": {"public_links": False, "datasets": False, "watermark": True},
    "Strictly confidential": {
        "public_links": False,
        "datasets": False,
        "data": False,
        "watermark": True,
        "formats": ["pdf", "pptx"],
    },
}


class PolicyError(ValueError):
    pass


@dataclass(frozen=True)
class Policy:
    label: str
    public_links: bool = True
    datasets: bool = True
    data: bool = True
    watermark: bool = False
    formats: tuple[str, ...] = field(default=FORMATS)

    def describe(self) -> str:
        rules = []
        if not self.public_links:
            rules.append("no public links")
        if not self.datasets:
            rules.append("no datasets")
        if not self.data:
            rules.append("preview images only")
        if self.watermark:
            rules.append("watermark required")
        if set(self.formats) != set(FORMATS):
            rules.append("exports: " + ", ".join(self.formats))
        return f"{self.label}: " + (", ".join(rules) if rules else "no export limits")


def labels() -> dict[str, dict]:
    path = os.environ.get("DATAWALK_POLICY")
    if not path:
        return BUILT_IN
    try:
        doc = json.loads(Path(path).read_text())
    except (OSError, ValueError) as e:
        raise PolicyError(f"DATAWALK_POLICY file {path}: {e}") from None
    if not isinstance(doc, dict) or not isinstance(doc.get("labels"), dict):
        raise PolicyError(f"{path}: expected {{'labels': {{...}}}}")
    return doc["labels"]


def check_labels() -> list[str]:
    """Problems in the label definitions (doctor). The labels replace the built-in ones."""
    problems = []
    for label in labels():
        try:
            policy(label)
        except PolicyError as e:
            problems.append(str(e))
    return problems


def policy(label: str) -> Policy | None:
    """The policy of a label; None for a report without a label."""
    if not label:
        return None
    spec = labels().get(label)
    if spec is None:
        raise PolicyError(f"Unknown classification {label!r}. Labels: {', '.join(labels())}")
    unknown = set(spec) - {"public_links", "datasets", "data", "watermark", "formats"}
    if unknown or not set(spec.get("formats", FORMATS)) <= set(FORMATS):
        raise PolicyError(
            f"Policy of {label!r} has unknown entries: {sorted(unknown) or spec['formats']}"
        )
    return Policy(label, **{k: tuple(v) if k == "formats" else bool(v) for k, v in spec.items()})


def check_export(
    label: str, fmt: str, datasets: bool, preview_only_all: bool, watermark: str
) -> None:
    """Refuse an export that the report's classification does not allow."""
    p = policy(label)
    if p is None:
        return
    if fmt not in p.formats:
        raise PolicyError(f"{p.describe()}. {fmt.upper()} exports are not allowed.")
    if datasets and not p.datasets:
        raise PolicyError(f"{p.describe()}. Leave out the datasets.")
    if not p.data and not preview_only_all:
        raise PolicyError(
            f"{p.describe()}. Export every chart as a preview image (--preview-only)."
        )
    if p.watermark and not watermark.strip():
        raise PolicyError(f"{p.describe()}. Give a recipient watermark (--watermark).")
