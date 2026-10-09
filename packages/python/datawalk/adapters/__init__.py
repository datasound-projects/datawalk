"""Adapter registry. Third-party adapters register through the
`datawalk.adapters` entry-point group and are checked after the built-in adapters."""

from __future__ import annotations

from functools import cache
from importlib.metadata import entry_points
from typing import Any

from .base import Adapter, Imported
from .matplotlib import MatplotlibAdapter
from .pandas import PandasAdapter
from .plotly import PlotlyAdapter
from .seaborn import SeabornAdapter

__all__ = ["Adapter", "Imported", "adapters", "find_adapter"]


@cache
def adapters() -> tuple[Adapter, ...]:
    from ..importers.adapters import AltairAdapter, BokehAdapter, FileAdapter, StylerAdapter

    plugins = tuple(ep.load()() for ep in entry_points(group="datawalk.adapters"))
    builtin = (SeabornAdapter(), PlotlyAdapter(), MatplotlibAdapter(), PandasAdapter())
    return (*builtin, AltairAdapter(), BokehAdapter(), StylerAdapter(), FileAdapter(), *plugins)


def find_adapter(obj: Any) -> Adapter | None:
    return next((a for a in adapters() if a.supports(obj)), None)
