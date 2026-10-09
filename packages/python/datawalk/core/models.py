"""Report data model. The JSON form of these models is the Python/TypeScript contract."""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal
from uuid import uuid4

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

SCHEMA_VERSION = "0.3.0"

THEMES = (
    "executive_office",
    "home_office",
    "light_gallery",
    "dark_gallery",
    "industrial_loft",
    "minimalist_studio",
    "museum_atrium",
    "futuristic_lab",
    "metaverse_pavilion",
    "data_command_center",
)


def _theme_id(value: Any) -> Any:
    """ "Executive Office", "executive-office", and "executive_office" name one theme."""
    return re.sub(r"[\s-]+", "_", value.strip().lower()) if isinstance(value, str) else value


ThemeId = Annotated[Literal[THEMES], BeforeValidator(_theme_id)]

# interactive = original chart is re-rendered with full interaction (mode A)
# structured  = faithful preview image plus extracted series data (mode B)
# static      = preview image only; no data is recoverable (mode C)
Mode = Literal["interactive", "structured", "static"]

Id = Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]


def new_id() -> str:
    return uuid4().hex


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Axis(Model):
    label: str = ""
    scale: str = "linear"


class AxesInfo(Model):
    title: str = ""
    x: Axis = Field(default_factory=Axis)
    y: Axis = Field(default_factory=Axis)
    z: Axis | None = None
    legend: list[str] = []


class Provenance(Model):
    """Where an imported visualization comes from (notebooks, files, MLflow runs)."""

    kind: Literal["notebook", "file", "mlflow"]
    path: str  # as given to the importer
    sha256: str = ""  # of the source file at import time
    cell_id: str | None = None  # notebook cell id
    output_index: int | None = None  # notebook output within the cell
    execution_count: int | None = None
    code: str = ""  # cell source, for "Show source" in the inspector


class Source(Model):
    """Data that the adapter extracts. A source refresh replaces all of it."""

    library: str
    chart_type: str
    mode: Mode = "static"
    title: str | None = None
    axes: list[AxesInfo] = []
    aspect: float = Field(gt=0)
    default_name: str = ""
    limitations: list[str] = []
    has_preview: bool = False
    has_payload: bool = False
    provenance: Provenance | None = None


class Explanation(Model):
    what_it_shows: str = ""
    inputs: str = ""
    units: str = ""
    data_source: str = ""
    findings: list[str] = []
    interpretation: str = ""
    methodology: str = ""
    assumptions: str = ""
    limitations: str = ""
    author: str = ""


class Overrides(Model):
    """Data that the user owns. A source refresh never changes it."""

    name: str | None = None
    description: str = ""
    explanation: Explanation = Field(default_factory=Explanation)
    # Fields edited in the editor ("name", "description", "explanation.findings", ...).
    # On a rerun these keep the edited value; other fields take the script's new value.
    edited: list[str] = []


class Visualization(Model):
    id: Id = Field(default_factory=new_id)
    key: str = Field(min_length=1, max_length=200)
    source: Source
    overrides: Overrides = Field(default_factory=Overrides)
    status: Literal["active", "removed"] = "active"

    @property
    def name(self) -> str:
        return self.overrides.name or self.source.default_name


Wall = Literal["north", "east", "south", "west"]
Surface = Literal["north", "east", "south", "west", "floor"]


class Placement(Model):
    """A manual position in normalized coordinates, so it survives room resizing and
    theme changes. On a wall: u along the wall (left to right as seen from inside), v up.
    On the floor (3D exhibits): u from west to east, v from north to south."""

    wall: Surface  # "floor" for freestanding 3D exhibits
    u: float = Field(ge=0, le=1)
    v: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=20)  # meters; the height follows the aspect ratio
    locked: bool = False


class Room(Model):
    id: Id = Field(default_factory=new_id)
    key: str | None = None  # the name given in Python; an editor rename does not change it
    name: str = Field(min_length=1)
    description: str = ""
    theme: ThemeId | None = None  # None = use the report theme
    items: list[Id] = []  # visualization and dashboard ids, in display order
    placements: dict[Id, Placement] = {}  # items without an entry are placed automatically


class Dashboard(Model):
    """Several visualizations shown together on one display."""

    id: Id = Field(default_factory=new_id)
    key: str | None = None
    name: str = Field(min_length=1)
    description: str = ""
    items: list[Id] = []  # visualization ids


class Dataset(Model):
    """A table that the analyst attached for download. Exports include it only on request."""

    id: Id = Field(default_factory=new_id)
    key: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1)
    description: str = ""
    columns: list[str] = []
    rows: int = Field(ge=0)
    visualizations: list[Id] = []  # charts that this data supports


class Link(Model):
    """Visualizations that share x values (dates or ids), declared by the analyst.
    Selecting or zooming an x range in one of them applies it to the others."""

    id: Id = Field(default_factory=new_id)
    key: str | None = None
    name: str = Field(min_length=1)
    items: list[Id] = Field(min_length=2)
    on: Literal["x"] = "x"


HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


class Brand(Model):
    """A customer's brand for customer-facing reports: logo, display frame and plaque colors."""

    name: str = ""
    frame: HexColor | None = None  # display frames
    plaque: HexColor | None = None  # name plaques under the displays
    plaque_text: HexColor | None = None
    accent: HexColor | None = None  # buttons and links of the viewer
    has_logo: bool = False


class TourStop(Model):
    """One stop of the guided tour: a visualization, dashboard, 3D exhibit, or room."""

    id: Id = Field(default_factory=new_id)
    ref: Id  # visualization, dashboard, or room id
    notes: str = ""  # speaker notes: presenter view and PPTX notes, never on the walls
    duration: float | None = Field(default=None, gt=0, le=3600)  # seconds, for auto-play


class ReportModel(Model):
    schema_version: str = SCHEMA_VERSION
    id: Id = Field(default_factory=new_id)
    name: str = Field(min_length=1)
    description: str = ""
    author: str = ""
    date: str = ""  # report date, as the analyst writes it (ISO 8601 recommended)
    data_cutoff: str = ""  # last date that the data covers
    # Classification label ("Confidential"): shown in every view and export; its policy
    # (datawalk.policy) limits exports and links.
    classification: str = Field(default="", max_length=60)
    theme: ThemeId = "executive_office"
    revision: int = 0
    visualizations: list[Visualization] = []
    dashboards: list[Dashboard] = []
    rooms: list[Room] = []
    links: list[Link] = []
    datasets: list[Dataset] = []
    tour: list[TourStop] = []  # empty: the default order (rooms in order, items in room order)
    brand: Brand | None = None
    # Report-level data that a person edited in the editor ("tour"). A rerun keeps it.
    edited: list[str] = []

    @model_validator(mode="after")
    def _check_references(self):
        ids = [v.id for v in self.visualizations]
        keys = [v.key for v in self.visualizations]
        dash = [d.id for d in self.dashboards]
        if len(set(ids)) != len(ids) or len(set(keys)) != len(keys):
            raise ValueError("visualization ids and keys must be unique")
        if len(set(dash)) != len(dash) or set(dash) & set(ids):
            raise ValueError("dashboard ids must be unique")
        for d in self.dashboards:
            if unknown := set(d.items) - set(ids):
                raise ValueError(
                    f"dashboard {d.name!r} references unknown visualizations {unknown}"
                )
        for ds in self.datasets:
            if unknown := set(ds.visualizations) - set(ids):
                raise ValueError(f"dataset {ds.name!r} references unknown visualizations {unknown}")
        if len({d.key for d in self.datasets}) != len(self.datasets):
            raise ValueError("dataset keys must be unique")
        for link in self.links:
            if unknown := set(link.items) - set(ids):
                raise ValueError(f"link {link.name!r} references unknown visualizations {unknown}")
        known = set(ids) | set(dash)
        rooms = {r.id for r in self.rooms}
        for stop in self.tour:
            if stop.ref not in known | rooms:
                raise ValueError(f"tour stop {stop.id} references an unknown item {stop.ref}")
        for room in self.rooms:
            if unknown := set(room.items) - known:
                raise ValueError(f"room {room.name!r} references unknown items {unknown}")
            if stray := set(room.placements) - set(room.items):
                raise ValueError(f"room {room.name!r} has placements for absent items {stray}")
        return self


# Payloads are stored and served apart from report.json because they can be large.


class Series(Model):
    axes: int = Field(ge=0)
    name: str
    kind: Literal["line", "scatter"]
    x: list[float | str | None]
    y: list[float | str | None]


class SeriesPayload(Model):
    kind: Literal["series"] = "series"
    series: list[Series]


class PlotlyPayload(Model):
    kind: Literal["plotly"] = "plotly"
    figure: dict[str, Any]


class KpiPayload(Model):
    kind: Literal["kpi"] = "kpi"
    value: float | str | None  # exact value
    display: str  # formatted value shown on the display
    unit: str = ""
    delta: float | None = None
    delta_display: str = ""
    higher_is_better: bool = True


class TextPayload(Model):
    """Markdown text for a wall panel. Rendered without HTML: raw HTML shows as text."""

    kind: Literal["text"] = "text"
    markdown: str = Field(max_length=20_000)
    links: list[str] = []  # keys of supporting visualizations (summary findings)


class VegaLitePayload(Model):
    """A Vega-Lite specification (Altair, notebooks). Rendered with vega-embed."""

    kind: Literal["vegalite"] = "vegalite"
    spec: dict[str, Any]


class SvgPayload(Model):
    """A sanitized SVG image: no scripts, event handlers, or external references."""

    kind: Literal["svg"] = "svg"
    svg: str = Field(max_length=20_000_000)


# Bokeh models that run JavaScript from the document: CustomJS, CustomJSHover,
# CustomJSTickFormatter, CustomJSFilter, CustomJSTransform, CustomJSExpr, the older
# FuncTickFormatter, and HTMLTemplateFormatter (an underscore template is code).
_BOKEH_CODE = {"code": "", "func": "", "v_func": "", "template": "<%- value %>"}


def bokeh_without_code(node: Any) -> bool:
    """Remove the JavaScript of these models in place (a report from someone else must not
    run code in the viewer). Returns True if there was code."""
    found = False
    if isinstance(node, dict):
        name = node.get("name") if node.get("type") == "object" else node.get("type")
        attrs = node.get("attributes")
        if (
            isinstance(name, str)
            and (
                name.startswith("CustomJS")
                or name in ("FuncTickFormatter", "HTMLTemplateFormatter")
            )
            and isinstance(attrs, dict)
        ):
            for key in _BOKEH_CODE.keys() & attrs.keys():
                found |= attrs[key] != _BOKEH_CODE[key]
                attrs[key] = _BOKEH_CODE[key]
        for value in node.values():
            found |= bokeh_without_code(value)
    elif isinstance(node, (list, tuple)):  # json_item() has tuples
        for value in node:
            found |= bokeh_without_code(value)
    return found


class BokehPayload(Model):
    """A Bokeh json_item. The viewer renders it with BokehJS of the same version, taken from
    the bokeh package on the machine that serves or exports the report. JavaScript callbacks
    are removed (see `bokeh_without_code`)."""

    kind: Literal["bokeh"] = "bokeh"
    item: dict[str, Any]
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")

    @field_validator("item")
    @classmethod
    def _no_code(cls, item: dict[str, Any]) -> dict[str, Any]:
        bokeh_without_code(item)
        return item


class TablePayload(Model):
    kind: Literal["table"] = "table"
    columns: list[str]
    rows: list[list[float | str | bool | None]]
    total_rows: int = Field(ge=0)  # rows in the source; more than len(rows) when truncated


Payload = Annotated[
    SeriesPayload
    | PlotlyPayload
    | KpiPayload
    | TablePayload
    | TextPayload
    | VegaLitePayload
    | SvgPayload
    | BokehPayload,
    Field(discriminator="kind"),
]
