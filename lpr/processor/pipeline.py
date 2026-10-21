"""Detection and read stages shared by the worker and offline/preview tools.

`detect_plates` finds the plate boxes (optionally only inside the camera's
detection zone). `iter_plate_reads` then crops each box, applies the shape
filter, runs the OCR and normalizes/validates the text (with the positional
correction of the Chilean format). Everything after that (tracking + voting,
dedupe, emission) stays in `LprWorker`; `lpr/tools/replay_eval.py` runs these
same two functions so the regression harness cannot drift from production.

`iter_plate_reads` is a generator: the OCR of box N+1 only runs when the caller
asks for it. `process_frame` consumes all the boxes of a frame (the tracker
needs every one to associate them).
"""
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Iterator, List, Optional, Tuple

import numpy as np
from PIL import Image

from lpr.processor.plate_tracker import PlateEmission, PlateTracker, TrackObservation
from lpr.processor.rules import normalize_plate, resolve_plate
from lpr.utils.images import frame_to_pil
from lpr.utils.zones import bounding_rect, point_in_any, polygons_to_pixels

STATUS_SHAPE_REJECTED = 'shape-rejected'
STATUS_OCR_EMPTY = 'ocr-empty'
STATUS_NOT_PLAUSIBLE = 'not-plausible'
STATUS_OK = 'ok'


@dataclass
class PlateRead:
    box: Tuple[int, int, int, int]  # clamped x1, y1, x2, y2
    det_conf: float
    crop_w: int
    crop_h: int
    crop_ratio: float
    shape_ok: bool
    status: str
    pil_crop: Optional[Image.Image] = None
    raw_text: str = ''
    text: str = ''  # normalized (no padding, upper case)
    plate: Optional[str] = None  # `text` corrected to the plate format; None if it is not a plate
    ocr_conf: float = 0.0
    char_conf: List[float] = field(default_factory=list)


@dataclass
class Box:
    """Plate box with the same attributes as `Detection` (x1, y1, x2, y2,
    confidence). Lets this module stay free of ultralytics imports."""
    x1: int
    y1: int
    x2: int
    y2: int
    confidence: float


# Margin around the zone envelope so a plate crossing the edge is not cut.
ZONE_MARGIN = 0.05


def scaled_imgsz(imgsz: int, frame_side: int, crop_side: int) -> int:
    """`imgsz` for a crop that keeps the SAME scale as the full frame at `imgsz`
    (plates keep the pixel size the detector saw), rounded up to a multiple of
    the YOLO stride (32). Without it a small crop would be upscaled to `imgsz`,
    costing more and gaining nothing."""
    target = imgsz * crop_side / float(max(1, frame_side))
    return max(32, int(-(-target // 32)) * 32)


def detect_plates(detector: Callable[..., Iterable[Any]], frame: np.ndarray,
                  cfg: Any) -> List[Any]:
    """Run `detector(frame, min_conf)`, restricted to `cfg.zone` when set.

    With a zone the detector sees only the envelope rectangle of the zone, at
    the frame's native resolution (`imgsz` is scaled down to the crop so the
    plates keep their pixel size and the inference gets cheaper); the boxes are
    re-projected to frame coordinates and those whose center falls outside the
    polygon(s) are dropped (street traffic, fixed false positives). Only in the
    zone case the detector is called with an extra `imgsz=` keyword.
    """
    if getattr(cfg, 'detection_blocked', False):
        return []  # fail-closed: zone configured but invalid, nothing to look at
    min_conf = cfg.min_det_conf
    zone = getattr(cfg, 'zone', None)
    h, w = frame.shape[:2]
    polygons = polygons_to_pixels(zone, w, h) if zone else []
    rect = bounding_rect(polygons, w, h, ZONE_MARGIN) if polygons else None
    if rect is None:
        return list(detector(frame, min_conf) or [])

    rx1, ry1, rx2, ry2 = rect
    sub = np.ascontiguousarray(frame[ry1:ry2, rx1:rx2])
    imgsz = scaled_imgsz(int(getattr(cfg, 'detector_imgsz', 640)), max(h, w), max(sub.shape[:2]))
    boxes: List[Any] = []
    for det in detector(sub, min_conf, imgsz=imgsz) or []:
        box = Box(det.x1 + rx1, det.y1 + ry1, det.x2 + rx1, det.y2 + ry1, det.confidence)
        center = ((box.x1 + box.x2) / 2.0, (box.y1 + box.y2) / 2.0)
        if point_in_any(center, polygons):
            boxes.append(box)
    return boxes


def crop_shape_ok(cfg: Any, crop_w: int, crop_h: int) -> Tuple[bool, float]:
    """Shape filter: a tiny or odd-shaped crop is not readable and the OCR
    hallucinates with misleading confidence on it. Returns (ok, ratio)."""
    area = crop_w * crop_h
    ratio = (crop_w / crop_h) if crop_h > 0 else 0.0
    max_w = getattr(cfg, 'max_crop_w', None)  # optional cap (None = unlimited)
    ok = not (crop_w < cfg.min_crop_w or (max_w is not None and crop_w > max_w)
              or crop_h < cfg.min_crop_h
              or area < cfg.min_crop_area
              or ratio < cfg.min_crop_ratio
              or ratio > cfg.max_crop_ratio)
    return ok, ratio


def iter_plate_reads(
    frame: np.ndarray,
    detections: Iterable[Any],
    fast_ocr: Any,
    cfg: Any,
    *,
    save_only_on_plate: bool = False,
    diagnose_rejected: bool = False,
) -> Iterator[PlateRead]:
    """Yield one `PlateRead` per usable detection.

    `status` is `ok` only when the shape filter passed and the normalized text
    is plausible. With `diagnose_rejected=True` the OCR also runs on crops
    rejected by shape (for display/logging only; their status stays
    `shape-rejected`). The worker leaves it off, so production does no extra OCR.
    """
    h, w = frame.shape[:2]
    for det in detections:
        x1c, y1c = max(0, det.x1), max(0, det.y1)
        x2c, y2c = min(w - 1, det.x2), min(h - 1, det.y2)
        if x2c <= x1c or y2c <= y1c:
            continue

        crop_w, crop_h = x2c - x1c, y2c - y1c
        shape_ok, ratio = crop_shape_ok(cfg, crop_w, crop_h)
        read = PlateRead(
            box=(x1c, y1c, x2c, y2c), det_conf=det.confidence,
            crop_w=crop_w, crop_h=crop_h, crop_ratio=ratio,
            shape_ok=shape_ok, status=STATUS_SHAPE_REJECTED,
        )
        if not shape_ok and not diagnose_rejected:
            yield read
            continue

        read.pil_crop = frame_to_pil(frame[y1c:y2c, x1c:x2c])
        ocr_res = fast_ocr.recognize(np.array(read.pil_crop)) if fast_ocr else None
        read.raw_text = ocr_res.text if ocr_res else ''
        read.ocr_conf = ocr_res.confidence if ocr_res else 0.0
        read.char_conf = ocr_res.char_confidences if ocr_res else []
        read.text = normalize_plate(read.raw_text)
        if not shape_ok:
            yield read
            continue

        if save_only_on_plate and not read.raw_text.strip():
            read.status = STATUS_OCR_EMPTY
        else:
            read.plate = resolve_plate(read.text, read.char_conf)
            read.status = STATUS_OK if read.plate else STATUS_NOT_PLAUSIBLE
        yield read


def read_to_observation(read: PlateRead) -> TrackObservation:
    """A box that did not produce a valid plate still feeds the tracker (it
    keeps the track alive and contributes to the direction trend) but votes
    nothing. Shape-rejected boxes are not fed: they are not plates."""
    valid = read.status == STATUS_OK and bool(read.plate)
    return TrackObservation(
        box=tuple(float(v) for v in read.box),  # type: ignore[arg-type]
        text=read.plate if valid else None,
        ocr_conf=read.ocr_conf, det_conf=read.det_conf, ref=read,
    )


def make_tracker(cfg: Any, clock: Optional[Callable[[], float]] = None) -> PlateTracker:
    """Tracker configured from the camera's `WorkerConfig`."""
    kwargs = {} if clock is None else {'clock': clock}
    return PlateTracker(
        confirm_reads=getattr(cfg, 'confirm_reads', 3),
        max_gap_seconds=getattr(cfg, 'track_max_gap_seconds', 1.5),
        direction=getattr(cfg, 'direction', 'unknown'),
        min_winner_share=getattr(cfg, 'min_winner_share', 0.0),
        **kwargs,
    )


def process_frame(
    frame: np.ndarray,
    detector: Callable[[np.ndarray, float], Iterable[Any]],
    fast_ocr: Any,
    cfg: Any,
    tracker: PlateTracker,
    now: Optional[float] = None,
    *,
    save_only_on_plate: bool = False,
) -> Tuple[List[PlateRead], List[PlateEmission]]:
    """Full per-frame decision path shared by the worker and the replay harness:
    detect (zone aware) -> read (shape filter, OCR, plate format) -> tracker.
    Returns every read of the frame and the emissions the tracker triggered."""
    boxes = detect_plates(detector, frame, cfg)
    reads = list(iter_plate_reads(frame, boxes, fast_ocr, cfg, save_only_on_plate=save_only_on_plate))
    observations = [read_to_observation(r) for r in reads if r.status != STATUS_SHAPE_REJECTED]
    return reads, tracker.update(observations, now)
