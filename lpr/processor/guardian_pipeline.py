"""Camino de decisión del Guardián por frame, COMPARTIDO por el worker y el replay.

    frame -> motion gating (MOG2 + retención) -> YOLO track (personas) -> GuardianRules

El worker (`guardian_worker.py`) solo agrega captura RTSP, hilo de zonas y envío
al backend; `lpr/tools/guardian_replay.py` agrega lectura de clips y puntaje.
Ambos llaman a `GuardianPipeline.process(frame, now)`, así que lo que se mide en
el replay es lo que corre en producción (incluido el gating).

El modelo es el `yolo11n.pt` local de `lpr/` (misma ruta que `vehicle_tracker.py`):
nunca se descargan pesos en runtime.
"""
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, List, Optional, Sequence

import cv2
import numpy as np

from lpr.processor.guardian_rules import AnomalyDecision, Detection

PERSON_CLASS = 0
DEFAULT_IMGSZ = 960
DEFAULT_MOTION_PIXELS = 150
# Si hubo personas en los últimos N s se corre YOLO aunque MOG2 no vea movimiento:
# una persona quieta (merodeo) se funde con el fondo y dejaba al Guardián ciego.
DEFAULT_RETENTION_SECONDS = 10.0
_LOCAL_MODEL = Path(__file__).resolve().parents[1] / 'yolo11n.pt'


def default_model_path() -> Path:
    return _LOCAL_MODEL


def load_model(path: Optional[Path] = None) -> Any:
    """Carga YOLO desde un archivo LOCAL. Sin archivo lanza FileNotFoundError
    (el worker lo convierte en salida para que el supervisor reintente) en vez
    de dejar que ultralytics intente descargar pesos."""
    model_path = Path(path) if path else default_model_path()
    if not model_path.is_file():
        raise FileNotFoundError(model_path)
    # Debe fijarse ANTES de importar ultralytics (lo lee al importar).
    os.environ.setdefault('YOLO_AUTOINSTALL', 'False')
    from ultralytics import YOLO  # perezoso: CI y tests no lo tienen
    return YOLO(str(model_path))


def effective_device(model: Any, requested: Optional[str]) -> str:
    """Dispositivo REAL del predictor si ya se creó; si no, el pedido o 'auto'."""
    predictor = getattr(model, 'predictor', None)
    device = getattr(getattr(predictor, 'model', None), 'device', None)
    if device is not None:
        return str(device)
    return requested or 'auto'


def reset_tracker(model: Any) -> None:
    """Olvida los ids de ByteTrack (un clip nuevo no debe heredar tracks)."""
    try:
        for tracker in getattr(getattr(model, 'predictor', None), 'trackers', None) or []:
            tracker.reset()
    except Exception:
        logging.exception('No se pudo reiniciar el tracker del Guardián')


@dataclass
class GateDecision:
    run: bool
    motion: bool
    retained: bool


class MotionGate:
    """MOG2 + retención. `check` se llama en CADA frame muestreado (el fondo se
    aprende siempre); `note_people` recuerda cuándo se vio gente por última vez."""

    def __init__(self, pixel_threshold: int = DEFAULT_MOTION_PIXELS,
                 retention_seconds: float = DEFAULT_RETENTION_SECONDS,
                 subtractor: Any = None) -> None:
        self.pixel_threshold = int(pixel_threshold)
        self.retention_seconds = float(retention_seconds)
        self._sub = subtractor or cv2.createBackgroundSubtractorMOG2(
            history=500, varThreshold=25, detectShadows=False)
        self._kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        self._last_people: Optional[float] = None

    def note_people(self, now: float) -> None:
        self._last_people = now

    def check(self, frame: np.ndarray, now: float, zone_polygons_px: Sequence[np.ndarray]) -> GateDecision:
        mask = self._sub.apply(frame)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, self._kernel)
        motion = False
        if not zone_polygons_px:
            motion = int(np.count_nonzero(mask)) > self.pixel_threshold
        else:
            # Solo cuenta el movimiento dentro de las zonas definidas.
            from lpr.utils.zones import polygon_mask
            for poly in zone_polygons_px:
                inter = cv2.bitwise_and(mask, polygon_mask(mask.shape[:2], poly))
                if int(np.count_nonzero(inter)) > self.pixel_threshold:
                    motion = True
                    break
        retained = (self._last_people is not None
                    and 0.0 <= now - self._last_people <= self.retention_seconds)
        return GateDecision(run=motion or retained, motion=motion, retained=retained)


@dataclass
class FrameResult:
    decisions: List[AnomalyDecision] = field(default_factory=list)
    ran_inference: bool = False
    motion: bool = False
    retained: bool = False
    people: int = 0
    inference_ms: float = 0.0


def extract_detections(results: Any) -> List[Detection]:
    """Resultado de `model.track` -> [(track_id, (x1,y1,x2,y2), conf)]; las cajas
    sin id (aún sin track) se ignoran, igual que antes."""
    out: List[Detection] = []
    if not results:
        return out
    boxes = results[0].boxes
    if boxes is None:
        return out
    for box in boxes:
        if box.id is None:
            continue
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        out.append((int(box.id.item()), (x1, y1, x2, y2), float(box.conf.item())))
    return out


def count_people(results: Any) -> int:
    if not results or results[0].boxes is None:
        return 0
    return len(results[0].boxes)


class GuardianPipeline:
    def __init__(self, model: Any, rules: Any, gate: MotionGate,
                 device: Optional[str] = None, imgsz: int = DEFAULT_IMGSZ) -> None:
        self.model = model
        self.rules = rules
        self.gate = gate
        self.device = device
        self.imgsz = int(imgsz)

    def process(self, frame: np.ndarray, now: float) -> FrameResult:
        h, w = frame.shape[:2]
        gate = self.gate.check(frame, now, self.rules.zone_pixel_polygons((w, h)))
        if not gate.run:
            # Sin YOLO no hay evidencia de ausencia, pero la memoria igual se acota.
            self.rules.purge(now)
            return FrameResult(motion=gate.motion, retained=gate.retained)

        started = time.perf_counter()
        # classes=[0] (solo personas), persist=True (ids entre frames); imgsz=960 es un
        # buen balance velocidad/alcance; device explícito (LPR_DEVICE) o auto.
        results = self.model.track(frame, classes=[PERSON_CLASS], persist=True, tracker='bytetrack.yaml',
                                   verbose=False, imgsz=self.imgsz, device=self.device)
        ms = (time.perf_counter() - started) * 1000.0
        people = count_people(results)
        if people:
            self.gate.note_people(now)
        decisions = self.rules.update(now, extract_detections(results), (w, h))
        return FrameResult(decisions=decisions, ran_inference=True, motion=gate.motion,
                           retained=gate.retained, people=people, inference_ms=ms)
