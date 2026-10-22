from PIL import Image
import cv2
import numpy as np
import io
import math
from typing import Tuple
import base64


def frame_to_pil(img: np.ndarray) -> Image.Image:
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return Image.fromarray(img_rgb)


def pil_to_base64(img: Image.Image, quality: int = 80) -> str:
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=quality)
    return base64.b64encode(buf.getvalue()).decode('ascii')


def pil_from_array(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(arr)


# Margins kept around the leveled plate so the OCR never sees clipped glyph edges.
_ROT_MARGIN_W = 1.05
_ROT_MARGIN_H = 1.10


def rotated_plate_crop(frame: np.ndarray, box: Tuple[int, int, int, int], deg: float) -> np.ndarray:
    """Crop the plate `box` (x1, y1, x2, y2) leveled by rotating `deg` degrees
    counter-clockwise (OpenCV convention) around the box center.

    The detector box is the axis-aligned bounding box of a tilted plate, so a
    plain crop of it carries background in the corners and a tilted plate. Here
    a region around the box (side = its largest dimension, so no corner is cut)
    is rotated and cropped back to the plate's own extent: for a plate of size
    W x H tilted by t, bw = W cos t + H sin t and bh = W sin t + H cos t, which is
    solved for W and H. The region is clamped to the frame. `deg == 0` (or a box
    too degenerate to rotate) returns exactly `frame[y1:y2, x1:x2]`.
    """
    x1, y1, x2, y2 = box
    plain = frame[y1:y2, x1:x2]
    if deg == 0 or plain.size == 0:
        return plain
    bw, bh = x2 - x1, y2 - y1
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    th = math.radians(abs(deg))
    c2 = math.cos(2 * th)
    if c2 > 0.2:
        width = (bw * math.cos(th) - bh * math.sin(th)) / c2
        height = (bh * math.cos(th) - bw * math.sin(th)) / c2
    else:
        width = height = 0.0
    if width < 10 or height < 4:
        # The box is not consistent with a plate tilted by `deg`: estimate the extent.
        width, height = bw * math.cos(th), max(6.0, bh * 0.45)

    fh, fw = frame.shape[:2]
    m = int(max(bw, bh))
    rx1, ry1 = max(0, int(cx - m)), max(0, int(cy - m))
    rx2, ry2 = min(fw, int(cx + m)), min(fh, int(cy + m))
    sub = frame[ry1:ry2, rx1:rx2]
    if sub.size == 0:
        return plain
    center = (cx - rx1, cy - ry1)
    matrix = cv2.getRotationMatrix2D(center, float(deg), 1.0)
    rotated = cv2.warpAffine(sub, matrix, (sub.shape[1], sub.shape[0]), flags=cv2.INTER_CUBIC)
    half_w = width / 2.0 * _ROT_MARGIN_W
    half_h = height / 2.0 * _ROT_MARGIN_H
    sh, sw = rotated.shape[:2]
    out = rotated[max(0, int(center[1] - half_h)):min(sh, int(center[1] + half_h)),
                  max(0, int(center[0] - half_w)):min(sw, int(center[0] + half_w))]
    return out if out.size else plain
