"""Seguimiento de VEHICULOS con ByteTrack (ultralytics) para la direccion.

La patente se lee pocas veces por paso, pero el vehiculo es un objeto grande y
estable: su trayectoria existe aunque la patente no se lea en todos los cuadros.
Este wrapper delgado le pide a ultralytics `model.track(persist=True,
tracker='bytetrack.yaml')` (el mismo patron del Guardian) sobre el rectangulo de
la zona de deteccion, reproyecta las cajas al cuadro completo y guarda la
trayectoria del punto "borde inferior central" de cada `track_id`.

Diseno para tests: ultralytics se importa de forma perezosa y el modelo se puede
inyectar (`model=`), asi que la logica (reproyeccion, trayectorias, TTL) se
prueba con un doble. Si el modelo no carga, el tracker queda `available=False`,
`update()` devuelve [] y la direccion cae a `width`/`none`: nunca tumba al worker.
"""
import logging
import os
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from lpr.utils.direction import DirectionLine, PathPoint

Box = Tuple[float, float, float, float]
Offset = Tuple[int, int]

# COCO: car, motorcycle, bus, truck.
VEHICLE_CLASSES = (2, 3, 5, 7)
# Puntos maximos por trayectoria (un auto detenido mucho rato no crece sin tope).
MAX_PATH_POINTS = 400
# Segundos sin ver un track tras los cuales se olvida su trayectoria.
DEFAULT_TTL_SECONDS = 10.0
_LOCAL_MODEL = Path(__file__).resolve().parents[1] / 'yolo11n.pt'


def default_model_ref() -> str:
    """El `yolo11n.pt` que ya vive en `lpr/` (el del Guardian). Nunca un nombre
    suelto: ver `VehicleTracker` (no se descargan pesos en runtime)."""
    return str(_LOCAL_MODEL)


def _load_ultralytics_model(model_ref: str) -> Any:
    # ultralytics auto-instala paquetes con pip en runtime salvo que se lo
    # impida; `lapx` ya esta declarado en requirements. Debe fijarse ANTES de
    # importarlo (lo lee al importar); `setdefault` respeta lo que defina el operador.
    os.environ.setdefault('YOLO_AUTOINSTALL', 'False')
    from ultralytics import YOLO  # perezoso: CI y tests no lo tienen
    return YOLO(model_ref)


class _Track:
    __slots__ = ('points', 'last_seen', 'box')

    def __init__(self, box: Box, now: float) -> None:
        self.points: List[PathPoint] = []
        self.last_seen = now
        self.box = box


class VehicleTracker:
    def __init__(
        self,
        model_ref: Optional[str] = None,
        classes: Sequence[int] = VEHICLE_CLASSES,
        imgsz: int = 640,
        device: Optional[str] = None,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        model: Any = None,
        model_loader: Callable[[str], Any] = _load_ultralytics_model,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.classes = list(classes)
        self.imgsz = int(imgsz)
        self.device = device
        self.ttl_seconds = float(ttl_seconds)
        self._clock = clock
        self._tracks: Dict[int, _Track] = {}
        self._line_key: Optional[DirectionLine] = None
        self._model: Any = model
        self.available = model is not None
        if model is None:
            ref = model_ref or default_model_ref()
            # Pesos SOLO desde un archivo local: pasarle a ultralytics un nombre que
            # no existe lo haria descargarlo de internet (y cargar un .pt es
            # deserializar un pickle). Sin archivo, el tracker se degrada.
            if not Path(ref).is_file():
                logging.error('Modelo de vehiculos no encontrado (%s): no se descarga nada en runtime; '
                              'la direccion por linea queda desactivada (copia los pesos o define '
                              'LPR_VEHICLE_MODEL con una ruta local)', Path(ref).name)
                return
            try:
                self._model = model_loader(ref)
                self.available = True
            except Exception:
                # Degradacion segura: sin vehiculos las direcciones caen a width/none.
                logging.exception('No se pudo cargar el modelo de vehiculos (%s): la direccion por '
                                  'linea queda desactivada en este worker', Path(ref).name)

    # ------------------------------------------------------------------
    def update(self, image: Any, offset: Offset = (0, 0),
               now: Optional[float] = None) -> List[Tuple[int, Box]]:
        """Un cuadro (o el recorte de la zona con su `offset` (x, y) en el cuadro
        completo). Devuelve `[(track_id, (x1, y1, x2, y2))]` en coordenadas del
        CUADRO COMPLETO y agrega el punto a la trayectoria de cada track."""
        t = self._clock() if now is None else float(now)
        self._expire(t)
        if not self.available:
            return []
        kwargs: Dict[str, Any] = dict(classes=self.classes, persist=True, tracker='bytetrack.yaml',
                                      verbose=False, imgsz=self.imgsz)
        if self.device is not None:
            kwargs['device'] = self.device
        try:
            results = self._model.track(image, **kwargs)
        except Exception:
            # Un fallo puntual (OOM, frame raro) no tumba el worker: se pierde ese cuadro.
            logging.exception('Fallo el seguimiento de vehiculos en este cuadro')
            return []
        found: List[Tuple[int, Box]] = []
        if not results or getattr(results[0], 'boxes', None) is None:
            return found
        ox, oy = offset
        for box in results[0].boxes:
            if getattr(box, 'id', None) is None:
                continue  # ByteTrack aun no confirma este objeto
            track_id = int(box.id.item())
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
            frame_box = (x1 + ox, y1 + oy, x2 + ox, y2 + oy)
            track = self._tracks.get(track_id)
            if track is None:
                track = self._tracks[track_id] = _Track(frame_box, t)
            track.box = frame_box
            track.last_seen = t
            # Borde inferior central: donde el vehiculo toca el piso.
            track.points.append((t, (frame_box[0] + frame_box[2]) / 2.0, frame_box[3]))
            del track.points[:-MAX_PATH_POINTS]
            found.append((track_id, frame_box))
        return found

    def path(self, track_id: int) -> Sequence[PathPoint]:
        track = self._tracks.get(track_id)
        return track.points if track else ()

    def paths(self) -> Dict[int, Sequence[PathPoint]]:
        return {tid: tr.points for tid, tr in self._tracks.items()}

    def sync_line(self, line: Optional[DirectionLine]) -> None:
        """Si la linea de direccion cambia, las trayectorias acumuladas dejan de
        ser comparables con la linea nueva: se descartan (los ids de ByteTrack
        siguen; solo se reinicia el historial de puntos)."""
        if line != self._line_key:
            if self._line_key is not None or line is not None:
                for track in self._tracks.values():
                    track.points.clear()
            self._line_key = line

    def reset(self) -> None:
        """Olvida trayectorias y el estado interno de ByteTrack (otro clip/stream)."""
        self._tracks.clear()
        predictor = getattr(self._model, 'predictor', None)
        for tracker in getattr(predictor, 'trackers', None) or []:
            try:
                tracker.reset()
            except Exception:
                logging.debug('No se pudo reiniciar un tracker de ultralytics', exc_info=True)

    def _expire(self, now: float) -> None:
        for tid in [tid for tid, tr in self._tracks.items() if now - tr.last_seen > self.ttl_seconds]:
            del self._tracks[tid]
