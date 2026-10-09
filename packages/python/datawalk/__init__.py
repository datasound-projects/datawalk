"""DataWalk. Walk through your data. Share it. Explore your insights.

Turn plots, notebooks, dashboards, and presentations into immersive, walkable 3D worlds.
"""

from .core.models import THEMES
from .reports.report import MergeConflict, Report
from .serialization.archive import ArchiveError

__all__ = ["THEMES", "ArchiveError", "MergeConflict", "Report"]
__version__ = "0.1.0a2"
