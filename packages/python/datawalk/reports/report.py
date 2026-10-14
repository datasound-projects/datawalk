from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from pydantic import PrivateAttr

from ..adapters import Imported, find_adapter
from ..core.models import (
    Brand,
    Dashboard,
    Dataset,
    Explanation,
    Link,
    Overrides,
    ReportModel,
    Room,
    Source,
    ThemeId,
    TourStop,
    Visualization,
)
from ..core.naming import default_name

DEFAULT_ROOM = "Gallery"
SUMMARY_ROOM = "Summary"
MAX_FINDINGS = 3


class MergeConflict(ValueError):
    """A key now holds a different kind of chart. DataWalk does not guess."""


class RevisionConflict(ValueError):
    """The report changed since the editor loaded it."""


def _merge_overrides(old: Overrides, new: Overrides) -> Overrides:
    """Rerun merge: fields edited in the editor keep their value. Other fields take the
    script's new value, or keep the earlier value when the script sets nothing."""

    def pick(field: str, a: Any, b: Any) -> Any:
        if field in old.edited:
            return a
        return b if b not in (None, "", []) else a

    ex = {
        f: pick(f"explanation.{f}", getattr(old.explanation, f), getattr(new.explanation, f))
        for f in Explanation.model_fields
    }
    return Overrides(
        name=pick("name", old.name, new.name),
        description=pick("description", old.description, new.description),
        explanation=Explanation(**ex),
        edited=list(old.edited),
    )


def _edited_fields(old: Overrides, new: Overrides) -> list[str]:
    """Field paths whose value differs between two overrides."""
    out = [f for f in ("name", "description") if getattr(old, f) != getattr(new, f)]
    out += [
        f"explanation.{f}"
        for f in Explanation.model_fields
        if getattr(old.explanation, f) != getattr(new.explanation, f)
    ]
    return out


def _default_index(df: Any) -> bool:
    import pandas as pd

    return isinstance(df.index, pd.RangeIndex) and df.index.start == 0 and df.index.step == 1


def _format_number(value: Any) -> str:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return str(value)
    if isinstance(value, int):
        return f"{value:,}"
    if math.isfinite(value) and abs(value) >= 100:
        return f"{value:,.2f}"
    return f"{value:.4g}"


class Report(ReportModel):
    """A collection of visualizations organized into walkable rooms."""

    _payloads: dict[str, dict[str, Any]] = PrivateAttr(default_factory=dict)
    _previews: dict[str, bytes] = PrivateAttr(default_factory=dict)
    _path: Path | None = PrivateAttr(default=None)  # the archive this object was loaded or saved as
    _datasets: dict[str, bytes] = PrivateAttr(default_factory=dict)  # dataset id -> CSV bytes
    _brand_logo: bytes | None = PrivateAttr(default=None)  # PNG
    _import_log: dict[str, Any] = PrivateAttr(default_factory=dict)  # what an import left out

    def __init__(self, name: str | None = None, /, **data: Any) -> None:
        if name is not None:
            data["name"] = name
        super().__init__(**data)

    # -- registry ---------------------------------------------------------

    def get(self, key: str) -> Visualization | None:
        return next((v for v in self.visualizations if v.key == key), None)

    def _require(self, key: str) -> Visualization:
        viz = self.get(key)
        if viz is None:
            raise KeyError(f"No visualization with key {key!r}")
        return viz

    def add(
        self,
        obj: Any,
        key: str,
        name: str | None = None,
        room: str | None = DEFAULT_ROOM,
        description: str | None = None,
        update: bool = False,
    ) -> Visualization:
        """Import a figure or DataFrame. room=None leaves it unassigned.

        With update=True, an existing key gets the new source data and keeps its
        user-defined name, description, explanation and room."""
        if isinstance(obj, str) and Path(obj).suffix and Path(obj).is_file():
            obj = Path(obj)  # a file name
        adapter = find_adapter(obj)
        if adapter is None and isinstance(obj, Path):
            raise TypeError(
                f"{obj}: DataWalk does not read {obj.suffix or 'files without a suffix'} files. "
                "It reads .png, .jpg, .svg, .csv, .tsv, .xlsx, .xls, .md, and chart .json files."
            )
        if adapter is None:
            raise TypeError(
                f"No adapter supports {type(obj).__module__}.{type(obj).__qualname__}. "
                "Run `datawalk adapters` to list supported objects."
            )
        if self.get(key) and not update:
            raise ValueError(
                f"Duplicate key {key!r}. Pass update=True to replace the source of the "
                "existing visualization."
            )
        return self._register(key, adapter.import_(obj), name, room, description)

    def add_kpi(
        self,
        key: str,
        label: str,
        value: float | int | str | None,
        unit: str = "",
        fmt: str | None = None,
        delta: float | None = None,
        delta_fmt: str | None = None,
        higher_is_better: bool = True,
        room: str | None = DEFAULT_ROOM,
        description: str | None = None,
        update: bool = False,
    ) -> Visualization:
        """Add a key figure. fmt and delta_fmt are format specs, for example ",.0f" or "+.1%"."""
        if self.get(key) and not update:
            raise ValueError(f"Duplicate key {key!r}. Pass update=True to replace it.")
        payload = {
            "kind": "kpi",
            "value": value,
            "display": format(value, fmt) if fmt else _format_number(value),
            "unit": unit,
            "delta": delta,
            "delta_display": ""
            if delta is None
            else format(delta, delta_fmt)
            if delta_fmt
            else f"{delta:+,.4g}",
            "higher_is_better": higher_is_better,
        }
        source = Source(
            library="datawalk",
            chart_type="kpi",
            mode="structured",
            title=label,
            aspect=1.6,
            has_payload=True,
        )
        return self._register(key, Imported(source, payload, None), None, room, description)

    def _register(
        self,
        key: str,
        imported: Imported,
        name: str | None,
        room: str | None,
        description: str | None,
    ) -> Visualization:
        existing = self.get(key)
        if not existing and re.search(r"[\s#?%]", key):
            raise ValueError(
                f"Key {key!r}: use no spaces, '#', '?', or '%' (keys are part of links)."
            )
        taken = {v.source.default_name for v in self.visualizations if v is not existing}
        imported.source.default_name = default_name(imported.source, taken)
        if existing:
            viz = existing
            viz.source = imported.source
            viz.status = "active"
        else:
            viz = Visualization(key=key, source=imported.source)
            self.visualizations.append(viz)
            if room is not None:
                self._room(room, create=True).items.append(viz.id)
        if name:
            viz.overrides.name = name
        if description:
            viz.overrides.description = description
        self._store(viz.id, imported.payload, imported.preview_png)
        return viz

    def _store(self, vid: str, payload: dict | None, preview: bytes | None) -> None:
        for store, value in ((self._payloads, payload), (self._previews, preview)):
            if value is None:
                store.pop(vid, None)
            else:
                store[vid] = value

    def capture_matplotlib(self, room: str = DEFAULT_ROOM) -> list[Visualization]:
        """Import every open Matplotlib figure. The key is the figure label, or
        `figure-<number>` when the figure has no label. Repeated captures update."""
        import matplotlib.pyplot as plt

        nums = plt.get_fignums()
        current = plt.gcf().number if nums else None
        added = []
        for num in nums:
            fig = plt.figure(num)
            key = fig.get_label() or f"figure-{num}"
            added.append(self.add(fig, key=key, room=room, update=True))
        if current is not None:
            plt.figure(current)
        return added

    def discover(self, namespace: dict[str, Any], add: bool = False) -> dict[str, str]:
        """Find supported visualizations in a namespace such as globals().

        Returns {variable name: adapter name} for review. Nothing is imported unless
        add=True, which uses the variable names as keys. An Axes is skipped when the
        namespace also holds its Figure."""
        found: dict[str, tuple[Any, Any]] = {}
        seen: set[int] = set()
        # Visit figures before axes so that a Figure wins over its Axes.
        items = sorted(namespace.items(), key=lambda kv: "Axes" in type(kv[1]).__name__)
        for var, obj in items:
            if var.startswith("_") or isinstance(obj, type):
                continue
            adapter = find_adapter(obj)
            if adapter is None:
                continue
            ident = id(getattr(adapter, "figure", lambda o: o)(obj))
            if ident in seen:
                continue
            seen.add(ident)
            found[var] = (obj, adapter)
        if add:
            for var, (obj, _) in found.items():
                self.add(obj, key=var, update=True)
        return {var: adapter.name for var, (_, adapter) in found.items()}

    def unassigned(self) -> list[Visualization]:
        """Active visualizations that no room or dashboard shows."""
        used = {i for r in self.rooms for i in r.items} | {
            i for d in self.dashboards for i in d.items
        }
        return [v for v in self.visualizations if v.status == "active" and v.id not in used]

    # -- rooms and dashboards --------------------------------------------

    def _room(self, name: str, create: bool = False) -> Room:
        # The Python name (key) wins, so code keeps working after an editor rename.
        room = next((r for r in self.rooms if r.key == name), None) or next(
            (r for r in self.rooms if r.name == name), None
        )
        if room is None:
            if not create:
                names = ", ".join(repr(r.name) for r in self.rooms) or "none"
                raise KeyError(f"No room named {name!r}. Rooms: {names}")
            room = Room(key=name, name=name)
            self.rooms.append(room)
        return room

    def room(self, name: str) -> Room:
        return self._room(name)

    def add_room(self, name: str, theme: ThemeId | None = None, description: str = "") -> Room:
        if any(name in (r.key, r.name) for r in self.rooms):
            raise ValueError(f"Room {name!r} already exists")
        room = Room(key=name, name=name, theme=theme, description=description)
        self.rooms.append(room)
        return room

    def remove_room(self, name: str) -> None:
        """Delete a room. Its visualizations stay in the report, unassigned."""
        self.rooms.remove(self._room(name))

    def _detach(self, item_id: str) -> None:
        for r in self.rooms:
            if item_id in r.items:
                r.items.remove(item_id)
                r.placements.pop(item_id, None)

    def move(self, key: str, room: str | None) -> None:
        """Move a visualization to a room (None: unassign it)."""
        viz = self._require(key)
        self._detach(viz.id)
        if room is not None:
            self._room(room, create=True).items.append(viz.id)

    def add_dashboard(
        self, name: str, keys: list[str], room: str = DEFAULT_ROOM, description: str = ""
    ) -> Dashboard:
        """Group visualizations on one display. They leave the room as single displays.
        Calling it again with the same name updates the dashboard."""
        ids = [self._require(k).id for k in keys]
        dash = self.dashboard(name, missing_ok=True)
        if dash is None:
            dash = Dashboard(key=name, name=name, description=description, items=ids)
            self.dashboards.append(dash)
        else:
            dash.items = ids
        target = self._room(room, create=True)
        for vid in ids:
            if vid in target.items:
                target.items.remove(vid)
                target.placements.pop(vid, None)
        if not any(dash.id in r.items for r in self.rooms):
            target.items.append(dash.id)
        return dash

    def dashboard(self, name: str, missing_ok: bool = False) -> Dashboard | None:
        dash = next((d for d in self.dashboards if d.key == name), None) or next(
            (d for d in self.dashboards if d.name == name), None
        )
        if dash is None and not missing_ok:
            raise KeyError(f"No dashboard named {name!r}")
        return dash

    def attach_dataset(
        self,
        df: Any,
        key: str,
        name: str | None = None,
        description: str = "",
        visualizations: list[str] | None = None,
    ) -> Dataset:
        """Attach a pandas DataFrame for download, as CSV. It stays in the .dwk file, and an
        export includes it only when the author asks for datasets in the export review."""
        csv = df.to_csv(index=not _default_index(df)).encode()
        vids = [self._require(k).id for k in visualizations or []]
        ds = next((d for d in self.datasets if d.key == key), None)
        fields = dict(
            name=name or key,
            description=description,
            columns=[str(c) for c in df.columns],
            rows=len(df),
            visualizations=vids,
        )
        if ds is None:
            ds = Dataset(key=key, **fields)
            self.datasets.append(ds)
        else:
            for k, v in fields.items():
                setattr(ds, k, v)
        self._datasets[ds.id] = csv
        return ds

    def link(self, keys: list[str], name: str | None = None) -> Link:
        """Declare that these visualizations share x values (the same dates or ids).
        Viewers can then select a range in one and see it in all. Only visualizations
        with data qualify: interactive Plotly figures and extracted line/scatter series."""
        vizs = [self._require(k) for k in keys]
        if len(vizs) < 2:
            raise ValueError("A link needs at least two visualizations")
        for v in vizs:
            if v.source.mode == "static" or v.source.chart_type in ("kpi", "table"):
                raise ValueError(
                    f"{v.key!r} has no x data to link ({v.source.mode} {v.source.chart_type})"
                )
        name = name or " + ".join(keys)
        link = next((x for x in self.links if x.key == name), None)
        ids = [v.id for v in vizs]
        if link is None:
            link = Link(key=name, name=name, items=ids)
            self.links.append(link)
        else:
            link.items = ids
        return link

    # -- text, summary, tour ---------------------------------------------

    def add_text(
        self,
        key: str,
        markdown: str,
        name: str | None = None,
        room: str | None = DEFAULT_ROOM,
        links: list[str] | None = None,
        update: bool = False,
    ) -> Visualization:
        """Add a text panel: Markdown for narrative, context, or an agenda. Raw HTML is shown
        as text, never interpreted. links: keys of visualizations that the text refers to."""
        if self.get(key) and not update:
            raise ValueError(f"Duplicate key {key!r}. Pass update=True to replace it.")
        for k in links or []:
            self._require(k)
        lines = len(markdown.splitlines()) or 1
        heading = re.match(r"\s*#{1,6}\s+(.+)", markdown)  # the default name: the first heading
        source = Source(
            library="datawalk",
            chart_type="text",
            mode="structured",
            title=name or (heading.group(1).strip() if heading else None),
            aspect=max(1.0, min(2.2, 2.2 - 0.05 * lines)),
            has_payload=True,
        )
        payload = {"kind": "text", "markdown": markdown, "links": list(links or [])}
        return self._register(key, Imported(source, payload, None), name, room, None)

    def add_summary(
        self,
        kpis: list[str],
        findings: list[tuple[str, list[str]]] | None = None,
        author: str | None = None,
        date: str | None = None,
        data_cutoff: str | None = None,
        name: str = SUMMARY_ROOM,
    ) -> Room:
        """Add the executive summary as the first room, from content that the analyst gives:
        a KPI wall that faces the entrance, up to three findings that each link to their
        supporting charts, and the author, date, and data cut-off date.
        DataWalk never writes findings itself. Without findings, the room shows the KPIs."""
        findings = list(findings or [])
        if len(findings) > MAX_FINDINGS:
            raise ValueError(
                f"A summary shows at most {MAX_FINDINGS} findings, not {len(findings)}"
            )
        for finding in findings:
            if not (isinstance(finding, tuple | list) and len(finding) == 2):
                raise ValueError(
                    f"A finding is (text, [supporting keys]), for example "
                    f'("Revenue grows 12%.", ["revenue"]), not {finding!r}'
                )
            text, keys = finding
            if not text.strip() or not keys:
                raise ValueError("Each finding needs text and at least one supporting key")
        for field, value in (("author", author), ("date", date), ("data_cutoff", data_cutoff)):
            if value is not None:
                setattr(self, field, value)
        room = next((r for r in self.rooms if r.key == "summary"), None)
        if room is None:
            room = Room(key="summary", name=name)
        self.rooms = [room] + [r for r in self.rooms if r is not room]  # always the first room
        room.items, room.placements = [], {}
        if kpis:
            # First item: the automatic layout puts it on the north wall, facing the entrance.
            ids = [self._require(k).id for k in kpis]
            dash = self.dashboard("summary_kpis", missing_ok=True)
            if dash is None:
                dash = Dashboard(key="summary_kpis", name="Key figures", items=ids)
                self.dashboards.append(dash)
            dash.items = ids
            room.items.append(dash.id)
        for i, (text, keys) in enumerate(findings, 1):
            self.add_text(
                f"summary_finding_{i}",
                text,
                name=f"Finding {i}",
                room=room.key,
                links=keys,
                update=True,
            )
        for i in range(len(findings) + 1, MAX_FINDINGS + 1):  # fewer findings than last run
            if self.get(f"summary_finding_{i}"):
                self._detach(self._require(f"summary_finding_{i}").id)
        about = [
            f"**{label}:** {value}"
            for label, value in (
                ("Author", self.author),
                ("Date", self.date),
                ("Data cut-off", self.data_cutoff),
            )
            if value
        ]
        if about:
            self.add_text(
                "summary_about",
                "  \n".join(about),
                name="About this report",
                room=room.key,
                update=True,
            )
        return room

    def classify(self, label: str) -> None:
        """Set the classification label, for example "Confidential" (see datawalk.policy)."""
        from ..policy import policy

        policy(label)  # an unknown label raises
        self.classification = label

    def set_brand(self, brand: str | Path | dict[str, Any]) -> Brand:
        """Apply a customer brand file (JSON): {"name", "logo" (PNG or JPEG, relative to the
        file), "frame", "plaque", "plaque_text", "accent"} with colors as #rrggbb."""
        from ..importers.content import to_png

        base = Path(".")
        if not isinstance(brand, dict):
            base = Path(brand).parent
            brand = json.loads(Path(brand).read_text(encoding="utf-8"))
        spec = dict(brand)
        logo = spec.pop("logo", None)
        self._brand_logo = to_png((base / logo).read_bytes()) if logo else None
        self.brand = Brand(**spec, has_logo=self._brand_logo is not None)
        return self.brand

    def _resolve(self, ref: str) -> str:
        """Id of a visualization (key), dashboard (key or name), or room (key or name)."""
        if viz := self.get(ref):
            return viz.id
        if dash := self.dashboard(ref, missing_ok=True):
            return dash.id
        if room := next((r for r in self.rooms if ref in (r.key, r.name)), None):
            return room.id
        raise KeyError(f"No visualization, dashboard, or room {ref!r}")

    def default_tour(self) -> list[TourStop]:
        """Rooms in order (the summary room is first), each followed by its items."""
        active = {v.id for v in self.visualizations if v.status == "active"}
        shown = active | {d.id for d in self.dashboards if active & set(d.items)}
        stops = []
        for room in self.rooms:
            stops.append(TourStop(ref=room.id))
            stops += [TourStop(ref=i) for i in room.items if i in shown]
        return stops

    def tour_stops(self) -> list[tuple[TourStop, Room, Visualization | Dashboard | None]]:
        """The tour (or the default order) resolved to (stop, room, target); target None is the
        room itself. Stops whose target is removed or in no room are left out (as in the viewer)."""
        viz = {v.id: v for v in self.visualizations if v.status == "active"}
        dash = {d.id: d for d in self.dashboards if any(i in viz for i in d.items)}
        out = []
        for stop in self.tour or self.default_tour():
            room = next((r for r in self.rooms if r.id == stop.ref), None)
            if room:
                out.append((stop, room, None))
                continue
            target = viz.get(stop.ref) or dash.get(stop.ref)
            home = next((r for r in self.rooms if stop.ref in r.items), None)
            if target is None:
                continue
            if home is None and isinstance(target, Visualization):  # shown inside a dashboard
                home = next(
                    (
                        r
                        for r in self.rooms
                        for d in dash.values()
                        if d.id in r.items and target.id in d.items
                    ),
                    None,
                )
            if home is not None:
                out.append((stop, home, target))
        return out

    def set_tour(self, refs: list[str]) -> list[TourStop]:
        """Set the tour order: visualization keys, dashboard names, and room names."""
        old = {s.ref: s for s in self.tour}
        self.tour = [old.get(rid) or TourStop(ref=rid) for rid in (self._resolve(r) for r in refs)]
        return self.tour

    def tour_stop(self, ref: str) -> TourStop:
        """The tour stop for a key or name. Without a tour, the default order becomes the tour."""
        if not self.tour:
            self.tour = self.default_tour()
        rid = self._resolve(ref)
        stop = next((s for s in self.tour if s.ref == rid), None)
        if stop is None:
            group = next((d for d in self.dashboards if rid in d.items), None)
            where = f" It is in the dashboard {group.name!r}: use that name." if group else ""
            raise KeyError(f"{ref!r} is not a stop of the tour.{where}")
        return stop

    def auto_arrange(self, max_per_room: int = 12) -> None:
        """Split rooms that hold more than max_per_room items into continuation rooms
        ("Name (2)", ...). Wall placement is computed by the viewer."""
        result = []
        for room in self.rooms:
            ids = room.items
            result.append(room)
            if len(ids) <= max_per_room:
                continue
            chunks = [ids[i : i + max_per_room] for i in range(0, len(ids), max_per_room)]
            room.placements = {k: p for k, p in room.placements.items() if k in chunks[0]}
            room.items = chunks[0]
            for n, chunk in enumerate(chunks[1:], start=2):
                name = f"{room.name} ({n})"
                result.append(Room(key=name, name=name, theme=room.theme, items=chunk))
        self.rooms = result

    # -- persistence and editing -----------------------------------------

    def save(self, path: str | Path, merge: bool = True, accept_changes: bool = False) -> Path:
        """Write a .dwk archive.

        When the file exists and this object did not come from it, for example when an
        analysis script runs again, the presentation in the file is kept: names, notes,
        rooms, dashboards, placements and themes. Visualizations whose keys are gone are
        kept and marked "removed". Pass merge=False to overwrite."""
        from ..serialization.archive import read, write

        path = Path(path)
        if merge and path.exists() and self._path != path.resolve():
            s = self._merge_from(read(path), accept_changes)
            print(
                f"DataWalk: kept the presentation from {path.name} "
                f"({len(s['updated'])} updated, {len(s['added'])} new, "
                f"{len(s['removed'])} marked removed)."
            )
            if s["removed"] and not s["updated"]:
                print(
                    f"warning: no chart of this report matches a chart in {path.name}. Is it "
                    "the right file? (merge=False writes the report without its contents.)"
                )
        self.revision += 1
        write(self, path)
        self._path = path.resolve()
        return path

    def _merge_from(self, prev: Report, accept_changes: bool) -> dict[str, list[str]]:
        old = {v.key: v for v in prev.visualizations}
        new = {v.key: v for v in self.visualizations}
        both = old.keys() & new.keys()
        changed = sorted(
            k
            for k in both
            if (old[k].source.library, old[k].source.chart_type)
            != (new[k].source.library, new[k].source.chart_type)
        )
        if changed and not accept_changes:
            raise MergeConflict(
                f"These keys now hold a different kind of chart: {', '.join(changed)}. "
                "Use new keys, or pass accept_changes=True to save()."
            )
        id_map = {new[k].id: old[k].id for k in both}
        payloads, previews, merged = {}, {}, []

        def take(src: Report, src_id: str, dst_id: str) -> None:
            if src_id in src._payloads:
                payloads[dst_id] = src._payloads[src_id]
            if src_id in src._previews:
                previews[dst_id] = src._previews[src_id]

        for o in prev.visualizations:
            n = new.get(o.key)
            if n is None:
                merged.append(o.model_copy(update={"status": "removed"}))
                take(prev, o.id, o.id)
            else:
                overrides = _merge_overrides(o.overrides, n.overrides)
                merged.append(
                    Visualization(id=o.id, key=o.key, source=n.source, overrides=overrides)
                )
                take(self, n.id, o.id)
        for k, n in new.items():
            if k not in old:
                merged.append(n)
                take(self, n.id, n.id)

        script_rooms, script_dashboards = self.rooms, self.dashboards
        rooms = [r.model_copy(deep=True) for r in prev.rooms]
        dashboards = [d.model_copy(deep=True) for d in prev.dashboards]

        def room_like(script_room: Room) -> Room:
            for r in rooms:
                if script_room.key is not None and r.key == script_room.key:
                    return r
            match = next((r for r in rooms if r.name == script_room.name), None)
            if match is None:
                match = Room(key=script_room.key, name=script_room.name, theme=script_room.theme)
                rooms.append(match)
            return match

        added_ids = {new[k].id for k in new.keys() - old.keys()}
        for d in script_dashboards:
            prev_d = next((x for x in dashboards if d.key is not None and x.key == d.key), None)
            members = [id_map.get(i, i) for i in d.items]
            if prev_d is None:
                prev_d = d.model_copy(update={"items": members})
                dashboards.append(prev_d)
                home = next((r for r in script_rooms if d.id in r.items), None)
                if home is not None:
                    room_like(home).items.append(d.id)
            else:
                prev_d.items += [i for i in members if i in added_ids]
        for r in script_rooms:
            for i in r.items:
                if i in added_ids:
                    room_like(r).items.append(i)

        # Datasets are source data: the script's version wins; ids stay stable by key.
        prev_ds = {d.key: d for d in prev.datasets}
        datasets, dataset_bytes = [], {}
        for d in self.datasets:
            p = prev_ds.get(d.key)
            update = {"visualizations": [id_map.get(i, i) for i in d.visualizations]}
            if p:
                update["id"] = p.id
            nd = d.model_copy(update=update)
            datasets.append(nd)
            dataset_bytes[nd.id] = self._datasets[d.id]

        # Links: keep the earlier ones; add script links that are new (by key).
        links = [x.model_copy(deep=True) for x in prev.links]
        for x in self.links:
            if not any(p.key is not None and p.key == x.key for p in links):
                links.append(x.model_copy(update={"items": [id_map.get(i, i) for i in x.items]}))

        # A summary room that this run adds goes first, like add_summary() puts it.
        if script_rooms and script_rooms[0].key == "summary":
            summary = next((r for r in rooms if r.key == "summary"), None)
            if summary is not None and not any(r.key == "summary" for r in prev.rooms):
                rooms.remove(summary)
                rooms.insert(0, summary)

        # The tour is user-owned once a person edits it; until then the script's tour applies.
        known = {v.id for v in merged} | {d.id for d in dashboards} | {r.id for r in rooms}
        if "tour" in prev.edited:
            tour = [t for t in prev.tour if t.ref in known]
        else:
            ref_map = dict(id_map)
            for d in script_dashboards:
                match = next((x for x in dashboards if d.key is not None and x.key == d.key), None)
                ref_map[d.id] = match.id if match else d.id
            for r in script_rooms:
                match = next((x for x in rooms if r.key is not None and x.key == r.key), None)
                match = match or next((x for x in rooms if x.name == r.name), None)
                ref_map[r.id] = match.id if match else r.id
            tour = [
                t.model_copy(update={"ref": ref_map.get(t.ref, t.ref)})
                for t in self.tour
                if ref_map.get(t.ref, t.ref) in known
            ]
        # Report details: the script's values, except fields that a person edited.
        details = {
            f: getattr(prev if f in prev.edited else self, f)
            for f in ("author", "date", "data_cutoff", "classification")
        }

        # Assign in an order that keeps every intermediate state valid.
        self.tour = []
        self.rooms, self.dashboards, self.links, self.datasets = [], [], [], []
        self.visualizations = merged
        self.dashboards, self.rooms, self.links = dashboards, rooms, links
        self.datasets, self._datasets = datasets, dataset_bytes
        self.tour, self.edited = tour, list(prev.edited)
        # The brand comes from the script; without one in this run, the earlier brand stays.
        if self.brand is None:
            self.brand, self._brand_logo = prev.brand, prev._brand_logo
        for f, value in details.items():
            setattr(self, f, value)
        self.id, self.name, self.description = prev.id, prev.name, prev.description
        self.theme, self.revision = prev.theme, prev.revision
        self._payloads, self._previews = payloads, previews
        return {
            "updated": sorted(both),
            "added": sorted(new.keys() - old.keys()),
            "removed": sorted(old.keys() - new.keys()),
        }

    def apply_presentation(self, incoming: ReportModel) -> None:
        """Accept a report from the editor. Only user-owned data changes:
        names, notes, rooms, dashboards, placements, themes. Source data never changes.
        Visualizations marked "removed" may be deleted."""
        if incoming.revision != self.revision:
            raise RevisionConflict(
                f"The report is at revision {self.revision}; the editor sent {incoming.revision}."
            )
        theirs = {v.id: v for v in incoming.visualizations}
        mine = {v.id: v for v in self.visualizations}
        if unknown := theirs.keys() - mine.keys():
            raise ValueError(f"The editor cannot add visualizations: {sorted(unknown)}")
        dropped = mine.keys() - theirs.keys()
        if active := [mine[i].key for i in dropped if mine[i].status != "removed"]:
            raise ValueError(f"Only removed visualizations can be deleted, not {active}")
        links_before = list(self.links)
        datasets_before = list(self.datasets)
        # The server records which report-level data a person edited (see _merge_from).
        report_edited = set(self.edited)
        if [t.model_dump() for t in incoming.tour] != [t.model_dump() for t in self.tour]:
            report_edited.add("tour")
        for f in ("author", "date", "data_cutoff", "classification"):
            if getattr(incoming, f) != getattr(self, f):
                report_edited.add(f)
        self.tour = []
        self.rooms, self.dashboards, self.links, self.datasets = [], [], [], []
        self.visualizations = [v for v in self.visualizations if v.id not in dropped]
        for v in self.visualizations:
            incoming_overrides = theirs[v.id].overrides
            # The server, not the client, records which fields a person edited.
            edited = sorted(
                set(v.overrides.edited) | set(_edited_fields(v.overrides, incoming_overrides))
            )
            v.overrides = incoming_overrides.model_copy(update={"edited": edited})
        for vid in dropped:
            self._store(vid, None, None)
        self.dashboards, self.rooms = incoming.dashboards, incoming.rooms
        # The editor may remove links, never add or change them: links are declared in Python.
        kept = {x.id for x in incoming.links}
        remaining = {v.id for v in self.visualizations}
        links = []
        for x in links_before:
            items = [i for i in x.items if i in remaining]
            if x.id in kept and len(items) >= 2:
                links.append(x.model_copy(update={"items": items}))
        self.links = links
        # Datasets are source data: the editor does not change them.
        remaining_ids = {v.id for v in self.visualizations}
        self.datasets = [
            d.model_copy(
                update={"visualizations": [i for i in d.visualizations if i in remaining_ids]}
            )
            for d in datasets_before
        ]
        self.name, self.description, self.theme = (
            incoming.name,
            incoming.description,
            incoming.theme,
        )
        self.author, self.date, self.data_cutoff = (
            incoming.author,
            incoming.date,
            incoming.data_cutoff,
        )
        if incoming.classification != self.classification:
            from ..policy import policy

            policy(incoming.classification)  # only known labels
            self.classification = incoming.classification
        self.tour, self.edited = incoming.tour, sorted(report_edited)
        # The brand is not editable in the editor (it comes with its logo file from Python).
        self.revision += 1

    def add_kpis(
        self,
        source: Any,
        mapping: dict[str, dict[str, Any]],
        room: str | None = DEFAULT_ROOM,
        update: bool = False,
    ) -> list[Visualization]:
        """KPIs from a DataFrame, CSV, or Excel file, by explicit mapping:
        {"revenue": {"label": "Revenue", "column": "revenue", "agg": "sum", "unit": "EUR"}}.
        agg: last (default), first, sum, mean, min, max, count; or "row": index."""
        from ..importers.extra import kpis_from_table

        return kpis_from_table(self, source, mapping, room, update)

    def add_mlflow_run(
        self, run: str | Path, room: str | None = None, tracking_uri: str | None = None
    ) -> list[Visualization]:
        """An MLflow run: metrics become KPIs, logged figures become charts, parameters a
        table. run: a run directory (mlruns/<experiment>/<run>) or a run id (needs mlflow)."""
        from ..importers.extra import add_mlflow_run

        return add_mlflow_run(self, run, room, tracking_uri)

    def add_pdf(
        self,
        path: str | Path,
        pages: list[int] | None = None,
        key: str | None = None,
        room: str | None = DEFAULT_ROOM,
        update: bool = False,
    ) -> list[Visualization]:
        """PDF pages (1-based) as static charts, for example BI tool exports.
        Needs pypdfium2 (`datawalk[pdf-import]`)."""
        from ..importers.extra import add_pdf

        return add_pdf(self, path, pages, key, room, update)

    def export(
        self,
        *paths: str | Path,
        preview_only: str | list[str] | tuple[str, ...] = (),
        datasets: bool = False,
        watermark: str = "",
        paper: str = "a4",
        template: str | Path | None = None,
        seconds: float = 6.0,
        yes: bool = False,
    ) -> list[Path]:
        """Export the report for people without Python. The format follows each path:
        `.html` (one file), a folder (static site), `.pdf`, `.pptx`, `.glb`, `.usdz`, `.mp4`.

        Every export is a data release: DataWalk prints the export review first. Confirm it at
        the prompt, or pass yes=True after you read it. preview_only="all" (or a list of keys)
        exports charts as their images only."""
        from ..export import ExportOptions, confirm, plan_export, run_export, target_format

        keys = [preview_only] if isinstance(preview_only, str) else list(preview_only)
        plan = plan_export(
            self,
            [(target_format(p), Path(p)) for p in paths],
            ExportOptions(set(keys), datasets, watermark),
            paper=paper,  # type: ignore[arg-type]
            template=Path(template) if template else None,
            seconds=seconds,
        )
        print(plan.review, flush=True)
        if not yes and not confirm():
            print("Export cancelled.")
            return []
        return run_export(plan)

    @classmethod
    def from_notebook(
        cls,
        path: str | Path,
        name: str | None = None,
        execute: bool = False,
        timeout: int = 600,
    ) -> Report:
        """Build a report from a Jupyter notebook's stored outputs: H2 headings become rooms,
        H3 headings dashboards, Markdown before an output its description. Nothing runs
        unless execute=True (nbclient in a separate process, `datawalk[notebook]`)."""
        from ..importers.notebook import from_notebook

        return from_notebook(path, name=name, execute_first=execute, timeout=timeout)

    @classmethod
    def load(cls, path: str | Path) -> Report:
        from ..serialization.archive import read

        report = read(Path(path))
        report._path = Path(path).resolve()
        return report

    def show(
        self,
        port: int | None = None,
        open_browser: bool = True,
        block: bool | None = None,
        edit: bool = True,
        guide: bool = False,
        model: str | None = None,
    ) -> str:
        """Start the local viewer on 127.0.0.1 and return its URL.

        edit=True opens the editor. Editor changes apply to this object, and to the
        archive file when the report was saved or loaded. edit=False is the read-only
        stakeholder view. block=None blocks in scripts and runs in a background thread
        when an event loop is already running (Jupyter). guide=True adds the AI guide: a local
        model (Ollama) presents the report and answers questions (docs/guide.md). model="..."
        uses another Ollama model (and turns the guide on); it must be installed."""
        from ..server import serve

        return serve(
            self,
            port=port,
            open_browser=open_browser,
            block=block,
            edit=edit,
            guide=guide,
            model=model,
        )
