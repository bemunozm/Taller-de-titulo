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

Ids canonicos: ByteTrack puede abrir un id NUEVO para el mismo vehiculo (oclusion,
confianza baja de noche). `update()` reenlaza: si nace un id crudo cerca de uno
perdido hace poco (`relink_seconds`), hereda su id CANONICO y la trayectoria sigue.
Todo lo de afuera (asociacion de patentes, trayectorias, voto) usa ids canonicos.
"""
import hashlib
import logging
import math
import os
import re
import tempfile
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
# Configuracion propia de ByteTrack (umbrales explicitos) y su fallback de ultralytics.
_TRACKER_TEMPLATE = Path(__file__).resolve().with_name('bytetrack_vigilia.yaml')
FALLBACK_TRACKER = 'bytetrack.yaml'
# Reenlace de ids: el centro nuevo debe caer a menos de K diagonales de la caja perdida,
# y el area de ambas cajas no puede diferir mas de 2x.
RELINK_DISTANCE_DIAGONALS = 1.0
RELINK_AREA_RATIO = (0.5, 2.0)
# Muestras recientes (t, x, y) del borde inferior para estimar la velocidad al predecir
# donde estaria un vehiculo perdido.
VELOCITY_SAMPLES = 5
# Los ids canonicos salen de un contador interno monotonico (nunca se reinicia, ni al
# reconfigurar ni al hacer reset): no pueden colisionar con los de un tracker anterior ni
# con los de un id crudo reaparecido, sin importar cuantos ids genere ByteTrack.


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


def track_buffer_for(lost_seconds: float, sample_fps: float) -> int:
    """`track_buffer` de ByteTrack (en cuadros PROCESADOS) para tolerar `lost_seconds`."""
    return max(1, math.ceil(float(lost_seconds) * float(sample_fps)))


def render_tracker_yaml(track_buffer: Optional[int] = None,
                        overrides: Optional[Dict[str, Any]] = None) -> str:
    """Texto del yaml de ByteTrack: la plantilla con `track_buffer` (y `overrides`
    opcionales, p. ej. umbrales de un barrido) resueltos. Sin dependencia de PyYAML."""
    text = _TRACKER_TEMPLATE.read_text(encoding='utf-8').replace(chr(13) + chr(10), chr(10))
    values: Dict[str, Any] = dict(overrides or {})
    if track_buffer is not None:
        values['track_buffer'] = int(track_buffer)
    for key, value in values.items():
        text, n = re.subn(rf'(?m)^{re.escape(key)}:.*$', f'{key}: {value}', text)
        if n != 1:
            raise ValueError(f'clave de ByteTrack desconocida: {key}')
    return text


def write_tracker_yaml(text: str) -> str:
    """Escribe el yaml en un directorio propio del tmp (0700; nombre por contenido:
    idempotente entre workers) y devuelve la ruta que ultralytics acepta en `tracker=`.
    Se escribe a un archivo temporal 0600 (`mkstemp`) y se reemplaza de forma atomica:
    otro worker nunca lee un yaml a medias, y uno existente corrupto o distinto se pisa."""
    directory = Path(tempfile.gettempdir()) / 'vigilia-lpr'
    directory.mkdir(mode=0o700, exist_ok=True)
    digest = hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]
    path = directory / f'bytetrack-{digest}.yaml'
    try:
        if path.is_file() and path.read_text(encoding='utf-8') == text:
            return str(path)
    except (OSError, UnicodeDecodeError):
        pass  # ilegible o corrupto: se reescribe
    fd, tmp_name = tempfile.mkstemp(prefix=f'{path.name}.', suffix='.tmp', dir=str(directory))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as handle:
            handle.write(text)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return str(path)


class _Track:
    __slots__ = ('points', 'last_seen', 'box', 'cls', 'raw_ids', 'recent')

    def __init__(self, box: Box, now: float, cls: Optional[int] = None) -> None:
        self.points: List[PathPoint] = []
        self.last_seen = now
        self.box = box
        self.cls = cls
        self.raw_ids: List[int] = []  # ids de ByteTrack que alimentaron este id canonico
        self.recent: List[PathPoint] = []  # ultimas muestras (t, x, y_inferior) para la velocidad

    def predicted_bottom(self, now: float) -> Tuple[float, float]:
        """Borde inferior central esperado en `now`: ultima posicion + velocidad media de
        las muestras recientes * tiempo perdido (sin velocidad medible, la ultima posicion)."""
        t, x, y = self.recent[-1] if self.recent else (self.last_seen, (self.box[0] + self.box[2]) / 2.0, self.box[3])
        if len(self.recent) >= 2:
            t0, x0, y0 = self.recent[0]
            if t > t0:
                dt = max(0.0, now - t)
                return x + (x - x0) / (t - t0) * dt, y + (y - y0) / (t - t0) * dt
        return x, y


def _area(box: Box) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _center(box: Box) -> Tuple[float, float]:
    return (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0


class VehicleTracker:
    def __init__(
        self,
        model_ref: Optional[str] = None,
        classes: Sequence[int] = VEHICLE_CLASSES,
        imgsz: int = 640,
        device: Optional[str] = None,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        sample_fps: Optional[float] = None,
        lost_seconds: float = 3.0,
        relink_seconds: float = 2.0,
        tracker_overrides: Optional[Dict[str, Any]] = None,
        model: Any = None,
        model_loader: Callable[[str], Any] = _load_ultralytics_model,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.classes = list(classes)
        self.imgsz = int(imgsz)
        self.device = device
        self.ttl_seconds = float(ttl_seconds)
        self.sample_fps = None if sample_fps is None else float(sample_fps)
        self.lost_seconds = float(lost_seconds)
        self.relink_seconds = max(0.0, float(relink_seconds))
        self.tracker_overrides = dict(tracker_overrides or {})
        self._tracker_ref: Optional[str] = None
        self._clock = clock
        # Trayectorias por id CANONICO + mapa id crudo (ByteTrack) -> canonico.
        self._tracks: Dict[int, _Track] = {}
        self._canon: Dict[int, int] = {}
        self._owner: Dict[int, int] = {}      # canonico -> id crudo que lo tiene hoy
        self._consumed: set = set()           # canonicos cuyo vehiculo ya emitio: no se heredan
        self._counter = 0
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
    def tracker_config(self) -> str:
        """Ruta del yaml de ByteTrack con `track_buffer = ceil(lost_seconds * sample_fps)`
        (se escribe una vez). Si no se puede escribir, el yaml por defecto de ultralytics."""
        if self._tracker_ref is None:
            buffer = None if self.sample_fps is None else track_buffer_for(self.lost_seconds, self.sample_fps)
            try:
                self._tracker_ref = write_tracker_yaml(render_tracker_yaml(buffer, self.tracker_overrides))
            except (OSError, ValueError):
                logging.exception('No se pudo escribir el yaml de ByteTrack: se usa el de ultralytics')
                self._tracker_ref = FALLBACK_TRACKER
        return self._tracker_ref

    def update(self, image: Any, offset: Offset = (0, 0),
               now: Optional[float] = None) -> List[Tuple[int, Box]]:
        """Un cuadro (o el recorte de la zona con su `offset` (x, y) en el cuadro
        completo). Devuelve `[(track_id, (x1, y1, x2, y2))]` en coordenadas del
        CUADRO COMPLETO, con ids CANONICOS, y agrega el punto a la trayectoria."""
        t = self._clock() if now is None else float(now)
        self._expire(t)
        if not self.available:
            return []
        kwargs: Dict[str, Any] = dict(classes=self.classes, persist=True, tracker=self.tracker_config(),
                                      verbose=False, imgsz=self.imgsz)
        if self.device is not None:
            kwargs['device'] = self.device
        try:
            results = self._model.track(image, **kwargs)
        except Exception:
            # Un fallo puntual (OOM, frame raro) no tumba el worker: se pierde ese cuadro.
            logging.exception('Fallo el seguimiento de vehiculos en este cuadro')
            return []
        detections: List[Tuple[int, Box, Optional[int]]] = []
        if not results or getattr(results[0], 'boxes', None) is None:
            return []
        ox, oy = offset
        for box in results[0].boxes:
            if getattr(box, 'id', None) is None:
                continue  # ByteTrack aun no confirma este objeto
            raw_id = int(box.id.item())
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
            cls = getattr(box, 'cls', None)
            try:
                cls_id = None if cls is None else int(cls.item() if hasattr(cls, 'item') else cls)
            except (TypeError, ValueError):
                cls_id = None
            detections.append((raw_id, (x1 + ox, y1 + oy, x2 + ox, y2 + oy), cls_id))
        found: List[Tuple[int, Box]] = []
        for canonical, raw_id, frame_box, cls_id in self._canonicalize(detections, t):
            track = self._tracks.get(canonical)
            if track is None:
                track = self._tracks[canonical] = _Track(frame_box, t, cls_id)
            if raw_id not in track.raw_ids:
                track.raw_ids.append(raw_id)
            track.box = frame_box
            track.last_seen = t
            if cls_id is not None:
                track.cls = cls_id
            # Borde inferior central: donde el vehiculo toca el piso.
            track.points.append((t, (frame_box[0] + frame_box[2]) / 2.0, frame_box[3]))
            del track.points[:-MAX_PATH_POINTS]
            track.recent.append(track.points[-1] if track.points else
                                (t, (frame_box[0] + frame_box[2]) / 2.0, frame_box[3]))
            del track.recent[:-VELOCITY_SAMPLES]
            found.append((canonical, frame_box))
        return found

    def _mint(self) -> int:
        """Id canonico fresco: contador monotonico, unico durante toda la vida del tracker."""
        self._counter += 1
        return self._counter

    def mark_consumed(self, canonical: int) -> None:
        """El vehiculo ya emitio su patente: si se pierde, un id nuevo NO puede heredarlo
        (el auto que aparezca donde se fue ese no es el mismo, y en modo acceso no abriria)."""
        if canonical in self._tracks:
            self._consumed.add(canonical)

    def _canonicalize(self, detections: Sequence[Tuple[int, Box, Optional[int]]],
                      t: float) -> List[Tuple[int, int, Box, Optional[int]]]:
        """Asigna id canonico a cada deteccion `(crudo, caja, clase)` del cuadro.

        Invariante: dos ids crudos vivos en el mismo cuadro NUNCA comparten canonico.
        Un id crudo conocido conserva su canonico; si dos lo comparten (el viejo reaparecio
        despues de ser heredado) lo conserva el HEREDERO (`_owner`) y el otro recibe un
        canonico sintetico nuevo. Un id NUEVO hereda el canonico de un track perdido hace
        <= `relink_seconds`, no consumido, si el borde inferior de su caja cae cerca de la
        posicion PREDICHA del perdido (y area y clase coinciden; ver constantes RELINK_*,
        conservador a proposito: un auto que frena justo antes de perderse puede no
        reengancharse, y es preferible a mezclar los votos de dos autos): gana el
        mas cercano, un canonico perdido se hereda una sola vez y nunca se roba uno que
        sigue vivo en este cuadro."""
        assigned: Dict[int, int] = {}
        taken: set = set()
        groups: Dict[int, List[int]] = {}
        for raw_id, _box, _cls in detections:
            canonical = self._canon.get(raw_id)
            if canonical is not None:
                groups.setdefault(canonical, []).append(raw_id)
        for canonical, raws in groups.items():
            keeper = self._owner.get(canonical)
            if keeper not in raws:
                keeper = raws[0]
            assigned[keeper] = canonical
            taken.add(canonical)
            for raw_id in raws:
                if raw_id == keeper:
                    continue
                fresh = self._mint()
                old = self._tracks.get(canonical)
                if old is not None and raw_id in old.raw_ids:
                    old.raw_ids.remove(raw_id)
                self._canon[raw_id] = fresh
                self._owner[fresh] = raw_id
                assigned[raw_id] = fresh
                taken.add(fresh)
        pending = [d for d in detections if d[0] not in assigned]
        pairs: List[Tuple[float, int, int]] = []
        if self.relink_seconds > 0:
            lo, hi = RELINK_AREA_RATIO
            for raw_id, box, cls_id in pending:
                area = _area(box)
                bottom = ((box[0] + box[2]) / 2.0, box[3])
                for canonical, lost in self._tracks.items():
                    if canonical in taken or canonical in self._consumed:
                        continue
                    if t - lost.last_seen > self.relink_seconds:
                        continue
                    if cls_id is not None and lost.cls is not None and cls_id != lost.cls:
                        continue
                    lost_area = _area(lost.box)
                    if lost_area <= 0 or area <= 0 or not lo <= area / lost_area <= hi:
                        continue
                    diagonal = math.hypot(lost.box[2] - lost.box[0], lost.box[3] - lost.box[1])
                    reach = RELINK_DISTANCE_DIAGONALS * diagonal
                    px, py = lost.predicted_bottom(t)
                    dist = math.hypot(bottom[0] - px, bottom[1] - py)
                    if dist <= reach:
                        pairs.append((dist, raw_id, canonical))
        for _dist, raw_id, canonical in sorted(pairs):
            if raw_id in assigned or canonical in taken:
                continue
            assigned[raw_id] = canonical
            taken.add(canonical)
            self._owner[canonical] = raw_id
            logging.debug('Reenlace de vehiculo: id crudo %d hereda el canonico %d', raw_id, canonical)
        out: List[Tuple[int, int, Box, Optional[int]]] = []
        for raw_id, box, cls_id in detections:
            canonical = assigned.get(raw_id)
            if canonical is None:
                canonical = self._mint()  # vehiculo nuevo
                self._owner[canonical] = raw_id
            self._canon[raw_id] = canonical
            out.append((canonical, raw_id, box, cls_id))
        return out

    def current(self, now: float) -> List[Tuple[int, Box]]:
        """Vehiculos vistos en el cuadro `now` (el ultimo `update`): `[(id canonico, caja)]`."""
        return [(tid, tr.box) for tid, tr in self._tracks.items() if tr.last_seen == now]

    def path(self, track_id: int) -> Sequence[PathPoint]:
        track = self._tracks.get(track_id)
        return track.points if track else ()

    def paths(self) -> Dict[int, Sequence[PathPoint]]:
        """Trayectorias por id canonico de los vehiculos VIVOS (no expirados por el TTL):
        sus llaves son el conjunto "vivo" que usa el `PlateTracker`."""
        return {tid: tr.points for tid, tr in self._tracks.items()}

    def raw_ids(self) -> Dict[int, Tuple[int, ...]]:
        """Ids crudos de ByteTrack por id canonico (telemetria)."""
        return {tid: tuple(tr.raw_ids) for tid, tr in self._tracks.items()}

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
        self._clear_state()
        predictor = getattr(self._model, 'predictor', None)
        for tracker in getattr(predictor, 'trackers', None) or []:
            try:
                tracker.reset()
            except Exception:
                logging.debug('No se pudo reiniciar un tracker de ultralytics', exc_info=True)

    def _clear_state(self) -> None:
        """Olvida todo; el contador de canonicos sigue, asi que los nuevos nunca repiten un viejo."""
        self._tracks.clear()
        self._canon.clear()
        self._owner.clear()
        self._consumed.clear()

    @property
    def track_buffer(self) -> Optional[int]:
        return None if self.sample_fps is None else track_buffer_for(self.lost_seconds, self.sample_fps)

    def reconfigure(self, sample_fps: Optional[float]) -> bool:
        """Cambia `sample_fps` SIN recargar el modelo: solo si cambia el `track_buffer` efectivo
        se reinicia en sitio el tracker de ultralytics (sin tocar sus callbacks); los ids
        crudos nuevos reciben canonicos frescos del contador monotonico. Las pistas de patente ligadas a vehiculos de antes dejan de estar vivas
        (las confirmadas pendientes se emiten, el resto se cierra). Devuelve si hubo reinicio."""
        old_buffer = self.track_buffer
        self.sample_fps = None if sample_fps is None else float(sample_fps)
        if self.track_buffer == old_buffer:
            return False
        self._tracker_ref = None
        self._clear_state()
        predictor = getattr(self._model, 'predictor', None)
        # En sitio y sin tocar los callbacks: borrar `predictor.trackers` haria que
        # `Model.track` registre otro par de callbacks y ByteTrack avanzaria 2 veces por
        # cuadro. Si aun no hay trackers, el yaml nuevo se usara en su primera creacion.
        for tracker in getattr(predictor, 'trackers', None) or []:
            try:
                buffer = self.track_buffer
                if buffer is not None:
                    tracker.args.track_buffer = buffer
                    tracker.max_time_lost = buffer  # ultralytics: frame_rate=30 => max_time_lost = track_buffer
                tracker.reset()
            except Exception:
                logging.exception('No se pudo reconfigurar el tracker de ultralytics')
        return True

    def _expire(self, now: float) -> None:
        for tid in [tid for tid, tr in self._tracks.items() if now - tr.last_seen > self.ttl_seconds]:
            for raw_id in self._tracks.pop(tid).raw_ids:
                if self._canon.get(raw_id) == tid:
                    del self._canon[raw_id]
            self._owner.pop(tid, None)
            self._consumed.discard(tid)
