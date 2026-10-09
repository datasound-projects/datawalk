from __future__ import annotations

import sys
from typing import Any

from .matplotlib import MatplotlibAdapter


class SeabornAdapter(MatplotlibAdapter):
    """Figure-level Seaborn objects (FacetGrid, PairGrid, JointGrid).

    Axes-level Seaborn functions return Matplotlib Axes; the Matplotlib adapter handles those.
    """

    name = "seaborn"
    summary = (
        "FacetGrid, PairGrid and JointGrid. Uses the Matplotlib adapter on the underlying "
        "figure; facet titles are kept as axes titles."
    )

    def supports(self, obj: Any) -> bool:
        return (
            "seaborn" in sys.modules
            and type(obj).__module__.startswith("seaborn.")
            and hasattr(obj, "figure")
        )

    @staticmethod
    def figure(obj: Any) -> Any:
        return MatplotlibAdapter.figure(obj.figure)
