"""Shared zone geometry (Guardian intrusion zones and LPR detection zone).

Zones come from the backend as lists of polygons with normalized (0-1)
coordinates: ``[[{"x": 0.1, "y": 0.2}, ...], ...]``. This module converts them
to pixels for a given frame and answers point/rectangle questions. It only
depends on numpy and OpenCV so both workers (and the tests) can share it.
"""
from typing import Any, Iterable, List, Optional, Sequence, Tuple

import cv2
import numpy as np

Point = Tuple[float, float]
Rect = Tuple[int, int, int, int]  # x1, y1, x2, y2 (x2/y2 exclusive, for slicing)


def valid_polygons(zones: Optional[Iterable[Sequence[Any]]]) -> List[Sequence[Any]]:
    """Keep only polygons with at least 3 points (anything less encloses nothing)."""
    return [z for z in (zones or []) if z is not None and len(z) >= 3]


def polygon_to_pixels(polygon: Sequence[Any], width: int, height: int) -> np.ndarray:
    """Normalized polygon -> int32 Nx2 pixel array (truncating, as the Guardian always did)."""
    return np.array([[p['x'] * width, p['y'] * height] for p in polygon], dtype=np.int32)


def polygons_to_pixels(zones: Optional[Iterable[Sequence[Any]]], width: int, height: int) -> List[np.ndarray]:
    return [polygon_to_pixels(z, width, height) for z in valid_polygons(zones)]


def point_in_polygon(point: Point, polygon_px: np.ndarray) -> bool:
    """Inclusive point-in-polygon (border counts as inside), same as the Guardian's test."""
    return cv2.pointPolygonTest(polygon_px, (float(point[0]), float(point[1])), True) >= 0


def point_in_any(point: Point, polygons_px: Iterable[np.ndarray]) -> bool:
    return any(point_in_polygon(point, poly) for poly in polygons_px)


def polygon_mask(shape: Tuple[int, int], polygon_px: np.ndarray, value: int = 255) -> np.ndarray:
    """uint8 mask (height, width) with the polygon filled."""
    mask = np.zeros(shape, dtype=np.uint8)
    cv2.fillPoly(mask, [polygon_px], value)
    return mask


def bounding_rect(polygons_px: Iterable[np.ndarray], width: int, height: int,
                  margin: float = 0.05) -> Optional[Rect]:
    """Envelope rectangle of all polygons, grown by `margin` (fraction of the
    envelope size) and clamped to the frame. None when there are no polygons or
    the clamped rectangle is empty."""
    polys = list(polygons_px)
    if not polys:
        return None
    pts = np.concatenate(polys, axis=0)
    x1, y1 = pts.min(axis=0)
    x2, y2 = pts.max(axis=0)
    pad_x = int(round((x2 - x1) * margin))
    pad_y = int(round((y2 - y1) * margin))
    rx1, ry1 = max(0, int(x1) - pad_x), max(0, int(y1) - pad_y)
    rx2, ry2 = min(width, int(x2) + pad_x + 1), min(height, int(y2) + pad_y + 1)
    if rx2 <= rx1 or ry2 <= ry1:
        return None
    return rx1, ry1, rx2, ry2
