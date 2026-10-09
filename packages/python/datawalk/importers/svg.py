"""SVG sanitizing: an allowlist of drawing elements; no scripts, event handlers, foreign
content, animation, or references outside the image (except embedded raster data URLs)."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

SVG = "http://www.w3.org/2000/svg"
XLINK = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", XLINK)

ALLOWED = {
    "svg", "g", "defs", "symbol", "use", "path", "rect", "circle", "ellipse", "line",
    "polyline", "polygon", "text", "tspan", "textPath", "title", "desc", "clipPath", "mask",
    "pattern", "linearGradient", "radialGradient", "stop", "image", "marker", "style",
    "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feComposite",
    "feFlood", "feMerge", "feMergeNode", "feMorphology", "feComponentTransfer", "feFuncA",
    "feFuncR", "feFuncG", "feFuncB", "feDropShadow",
}  # fmt: skip
SAFE_REF = re.compile(r"^(#|data:image/(png|jpeg|gif|webp);base64,)", re.I)
URL = re.compile(r"url\(\s*['\"]?\s*([^)'\"\s]*)", re.I)


class UnsafeSvg(ValueError):
    pass


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _clean_css(css: str) -> str:
    css = re.sub(r"@import[^;]*;?", "", css, flags=re.I)
    return URL.sub(lambda m: m.group(0) if SAFE_REF.match(m.group(1) or "#") else "url(#", css)


def _clean(el: ET.Element) -> None:
    for child in list(el):
        if not isinstance(child.tag, str) or _local(child.tag) not in ALLOWED:
            el.remove(child)  # comments, processing instructions, unknown or active elements
        else:
            _clean(child)
    for name in list(el.attrib):
        local = _local(name).lower()
        value = el.attrib[name]
        if local.startswith("on"):
            del el.attrib[name]
        elif local == "href" and not SAFE_REF.match(value.strip()):
            del el.attrib[name]
        elif local == "style" or "url(" in value.lower():
            el.attrib[name] = _clean_css(value)
    if _local(el.tag) == "style":  # text only: CSS after a child element is CSS too
        css = "".join(el.itertext())
        el[:] = []
        el.text = _clean_css(css)


def sanitize(text: str) -> tuple[str, float]:
    """Return the sanitized SVG and its aspect ratio (width / height)."""
    if re.search(r"<!(DOCTYPE|ENTITY)", text, re.I):
        # Matplotlib writes a DOCTYPE without entities: drop it; refuse entity declarations.
        if re.search(r"<!ENTITY", text, re.I):
            raise UnsafeSvg("SVG with entity declarations")
        text = re.sub(r"<!DOCTYPE[^>]*>", "", text, flags=re.I)
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        raise UnsafeSvg(f"not valid SVG: {e}") from None
    if _local(root.tag) != "svg":
        raise UnsafeSvg("the root element is not <svg>")
    _clean(root)
    return ET.tostring(root, encoding="unicode"), _aspect(root)


def _length(v: str | None) -> float | None:
    m = re.match(r"\s*([\d.]+)", v or "")
    return float(m.group(1)) if m and float(m.group(1)) > 0 else None


def _aspect(root: ET.Element) -> float:
    w, h = _length(root.get("width")), _length(root.get("height"))
    if not (w and h):
        box = [float(x) for x in re.split(r"[\s,]+", (root.get("viewBox") or "").strip()) if x]
        w, h = (box[2], box[3]) if len(box) == 4 and box[2] > 0 and box[3] > 0 else (4.0, 3.0)
    return w / h
