"""Detector de vehiculos liviano para el modo reposo (sin seguimiento).

Corre sobre el sub-stream (640x360) a ~2 fps con el mismo `yolo11n.pt` que el
`VehicleTracker`, pero con `model.predict` y una instancia PROPIA del modelo
(compartirla con el tracker corromperia el estado `persist` de ByteTrack). Solo
devuelve cajas: quien decide si hay movimiento en la zona es `rest_mode.MotionGate`.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, List, Optional, Sequence, Tuple

from lpr.processor.vehicle_tracker import VEHICLE_CLASSES, _load_ultralytics_model, default_model_ref

Box = Tuple[float, float, float, float]


class VehicleBoxDetector:
    def __init__(self, model_ref: Optional[str] = None, device: Optional[str] = None, imgsz: int = 640,
                 conf: float = 0.3, classes: Sequence[int] = VEHICLE_CLASSES, model: Any = None,
                 model_loader: Callable[[str], Any] = _load_ultralytics_model) -> None:
        self.device = device
        self.imgsz = int(imgsz)
        self.conf = float(conf)
        self.classes = list(classes)
        self._model = model
        self.available = model is not None
        if model is None:
            ref = model_ref or default_model_ref()
            if not Path(ref).is_file():
                logging.error('Modelo de vehiculos no encontrado (%s): sin deteccion de presencia', Path(ref).name)
                return
            try:
                self._model = model_loader(ref)
                self.available = True
            except Exception:
                logging.exception('No se pudo cargar el modelo de vehiculos para el modo reposo')

    def detect(self, image: Any) -> List[Box]:
        if not self.available:
            return []
        kwargs: dict = dict(classes=self.classes, conf=self.conf, imgsz=self.imgsz, verbose=False)
        if self.device is not None:
            kwargs['device'] = self.device
        try:
            results = self._model.predict(image, **kwargs)
        except Exception:
            logging.exception('Fallo la deteccion de presencia en este cuadro')
            return []
        if not results or getattr(results[0], 'boxes', None) is None:
            return []
        return [tuple(float(v) for v in box.xyxy[0].tolist()) for box in results[0].boxes]  # type: ignore[misc]
