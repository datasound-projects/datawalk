"""The .dwk archive: a ZIP file with a fixed, validated layout.

    manifest.json               format id and schema version
    report.json                 the report model (names, rooms, overrides, source metadata)
    visualizations/<id>.json    chart payloads
    previews/<id>.png           preview images
    datasets/<id>.csv           attached datasets (exported only on request)
    brand/logo.png              customer brand logo (optional)

Reading treats the file as untrusted: only known entry names, bounded sizes, JSON only.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import TypeAdapter

from ..core.models import SCHEMA_VERSION, Payload

READABLE = {"0.2", "0.3"}

if TYPE_CHECKING:
    from ..reports.report import Report

FORMAT = "datawalk-archive"
LEGACY_FORMATS = {"vizatrium-archive"}  # DataWalk's earlier name: .vza files read as before
ENTRY = re.compile(
    r"(manifest|report)\.json|visualizations/[0-9a-f]{32}\.json|previews/[0-9a-f]{32}\.png"
    r"|datasets/[0-9a-f]{32}\.csv|brand/logo\.png"
)
MAX_ENTRIES = 10_000
MAX_ENTRY_BYTES = 256 * 2**20
MAX_TOTAL_BYTES = 1024 * 2**20
MAX_RATIO = 200  # uncompressed / compressed, for entries above 1 MiB
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_payload = TypeAdapter(Payload)


class ArchiveError(ValueError):
    pass


def write(report: Report, path: Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".dwk.tmp")
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
            manifest = {"format": FORMAT, "schema_version": SCHEMA_VERSION}
            zf.writestr("manifest.json", json.dumps(manifest))
            zf.writestr("report.json", report.model_dump_json(indent=1))
            for vid, payload in report._payloads.items():
                zf.writestr(f"visualizations/{vid}.json", json.dumps(payload))
            for vid, png in report._previews.items():
                zf.writestr(f"previews/{vid}.png", png, compress_type=zipfile.ZIP_STORED)
            for did, csv in report._datasets.items():
                zf.writestr(f"datasets/{did}.csv", csv)
            if report._brand_logo:
                zf.writestr("brand/logo.png", report._brand_logo, compress_type=zipfile.ZIP_STORED)
        os.replace(tmp, path)  # atomic: an interrupted save never corrupts the old file
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return path


def read(path: Path) -> Report:
    from ..reports.report import Report

    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        raise ArchiveError(f"{path} is not a DataWalk archive") from e
    with zf:
        infos = zf.infolist()
        if len(infos) > MAX_ENTRIES:
            raise ArchiveError("too many archive entries")
        for info in infos:
            if not ENTRY.fullmatch(info.filename):
                raise ArchiveError(f"unexpected archive entry {info.filename!r}")
            if info.file_size > 2**20 and info.file_size > MAX_RATIO * max(info.compress_size, 1):
                raise ArchiveError(f"suspicious compression ratio in {info.filename!r}")

        total = 0

        def load(name: str) -> bytes:
            nonlocal total
            # Do not trust header sizes: read at most the limit plus one byte.
            with zf.open(name) as f:
                data = f.read(MAX_ENTRY_BYTES + 1)
            total += len(data)
            if len(data) > MAX_ENTRY_BYTES or total > MAX_TOTAL_BYTES:
                raise ArchiveError("archive content exceeds size limits")
            return data

        names = {i.filename for i in infos}
        if not {"manifest.json", "report.json"} <= names:
            raise ArchiveError("archive is missing manifest.json or report.json")
        manifest = json.loads(load("manifest.json"))
        if manifest.get("format") not in {FORMAT, *LEGACY_FORMATS}:
            raise ArchiveError("not a DataWalk archive")
        # 0.x: a minor version change can break the format. READABLE lists the versions that
        # this version reads (0.3 only added fields with defaults to 0.2).
        version = ".".join(str(manifest.get("schema_version", "")).split(".")[:2])
        if version not in READABLE:
            raise ArchiveError(f"unsupported schema version {manifest.get('schema_version')!r}")

        doc = json.loads(load("report.json"))
        doc["schema_version"] = SCHEMA_VERSION  # migrated: the fields above have defaults
        report = Report.model_validate(doc)
        ids = {v.id for v in report.visualizations}
        dataset_ids = {d.id for d in report.datasets}
        if "brand/logo.png" in names:
            logo = load("brand/logo.png")
            if not logo.startswith(PNG_MAGIC) or report.brand is None:
                raise ArchiveError("brand/logo.png is not a PNG image of the report's brand")
            report._brand_logo = logo
        for name in sorted(names - {"manifest.json", "report.json", "brand/logo.png"}):
            folder, file = name.split("/")
            vid = file.split(".")[0]
            if vid not in (dataset_ids if folder == "datasets" else ids):
                raise ArchiveError(f"{name!r} does not belong to the report")
            data = load(name)
            if folder == "datasets":
                report._datasets[vid] = data
            elif folder == "previews":
                if not data.startswith(PNG_MAGIC):
                    raise ArchiveError(f"{name!r} is not a PNG image")
                report._previews[vid] = data
            else:
                report._payloads[vid] = _payload.validate_json(data).model_dump()
        return report
