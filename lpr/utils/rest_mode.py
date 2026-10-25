"""Logica pura del modo reposo del LPR (sin PyAV, sin ultralytics, sin hilos de red).

El modo reposo existe para que un VPS compartido no decodifique 24/7 el stream HD
(HEVC 1080p) ni analice 8 fps cuando solo pasa un auto unos pocos % del tiempo:

- el stream HD se DEMUXA siempre (barato) a un anillo de paquetes (`PacketRing`);
- un sub-stream 640x360 se decodifica a ~2 fps y un detector de vehiculos liviano
  decide si hay un auto EN MOVIMIENTO dentro de la zona (`MotionGate`);
- al disparar (`RestStateMachine` -> activar) se decodifica el HD desde el ultimo
  keyframe del anillo (no se pierde el inicio del paso) y todo sigue por el camino
  de siempre; tras `idle_seconds` sin movimiento se libera lo pendiente y se vuelve
  a reposo.

Limitaciones conocidas (aceptadas por ahora):
- No hay deteccion de HD "congelado" (imagen repetida) en reposo ni activo: solo los
  timeouts de lectura del demux. El sub-stream si tiene el chequeo de imagen congelada.
- Calentamiento: un auto DETENIDO dentro de la zona al arrancar el worker (o tras
  cambiar la zona) se aprende como estatico durante `warmup_seconds` y no dispara; si
  arranca despues, si dispara. Un auto que ya se movia al arrancar puede tardar ~1 s.
- Un auto que avanza a menos de ~3 % del ancho cada 0.4 s (arrastrandose) no dispara.
- La red de seguridad del `ChangeDetector` activa con un cambio grande sostenido aunque
  YOLO no vea cajas: puede activar de mas (viento, personas); es el costo aceptado.

Este modulo solo tiene la logica testeable: anillo, regla de disparo, maquina de
estados, derivacion de la URL del sub-stream y telemetria. El I/O vive en
`utils/stream_reader.py` y el cableado en `processor/worker.py`.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Callable, Deque, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlsplit, urlunsplit

HD_SUFFIX = '-hd'


# ----------------------------------------------------------------------------
# URL del sub-stream
# ----------------------------------------------------------------------------
def derive_substream_url(url: Optional[str]) -> Optional[str]:
    """`rtsp://u:p@relay:8554/porton-hd` -> `rtsp://u:p@relay:8554/porton`.

    Solo se toca el ULTIMO segmento del path (las credenciales y el host quedan
    byte a byte como estaban). Devuelve None si el path no termina en `-hd` o si
    quitarlo dejaria un nombre vacio (no hay sub-stream derivable)."""
    if not url or not isinstance(url, str):
        return None
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if not parts.scheme or not parts.netloc:
        return None
    path = parts.path
    trailing = '/' if path.endswith('/') else ''
    core = path[:-1] if trailing else path
    head, _, last = core.rpartition('/')
    if not last.lower().endswith(HD_SUFFIX):
        return None
    base = last[:-len(HD_SUFFIX)]
    if not base:
        return None
    return urlunsplit((parts.scheme, parts.netloc, f'{head}/{base}{trailing}', parts.query, parts.fragment))


# ----------------------------------------------------------------------------
# Anillo de paquetes
# ----------------------------------------------------------------------------
class RingOverrun(Exception):
    """El cursor pidio un paquete que el anillo ya descarto."""

    def __init__(self, first_seq: int) -> None:
        super().__init__(f'packet already dropped (first available: {first_seq})')
        self.first_seq = first_seq


@dataclass(frozen=True)
class RingItem:
    seq: int
    ts: float
    key: bool
    size: int
    payload: Any


class PacketRing:
    """Anillo acotado de paquetes comprimidos, siempre alineado a GOPs.

    - Nunca guarda paquetes anteriores al primer keyframe (no se pueden decodificar).
    - Se descartan GOPs completos desde el mas viejo, asi el anillo SIEMPRE empieza
      en un keyframe. Se descarta el GOP mas viejo mientras (a) lo que quedaria siga
      cubriendo `max_seconds` o (b) se pasen `max_bytes` / `max_items`, pero nunca
      si quedaria menos de un GOP completo. Con GOP de 2 s y `max_seconds=5` el
      anillo cubre entre 5 y ~7 s (>= 2 GOPs).
    - `seq` crece monotonicamente y NO se reinicia con `clear()`: un cursor viejo se
      detecta como `RingOverrun` y el consumidor se resincroniza.
    """

    def __init__(self, max_seconds: float = 5.0, max_bytes: int = 48 * 1024 * 1024,
                 max_items: int = 4000) -> None:
        if max_seconds <= 0:
            raise ValueError('max_seconds must be > 0')
        self.max_seconds = float(max_seconds)
        self.max_bytes = int(max_bytes)
        self.max_items = int(max_items)
        self._items: Deque[RingItem] = deque()
        self._keys: Deque[int] = deque()  # seq de los keyframes presentes
        self._first_seq = 0
        self._next_seq = 0
        self._bytes = 0
        self._generation = 0
        self._closed = False
        self._cond = threading.Condition()

    # -- escritura ----------------------------------------------------------
    def append(self, ts: float, key: bool, size: int, payload: Any) -> Optional[int]:
        """Agrega un paquete. Devuelve su `seq`, o None si se descarto por ser
        previo al primer keyframe."""
        with self._cond:
            if not self._items and not key:
                return None
            seq = self._next_seq
            self._next_seq += 1
            self._items.append(RingItem(seq, float(ts), bool(key), int(size), payload))
            self._bytes += int(size)
            if key:
                self._keys.append(seq)
            self._trim()
            self._cond.notify_all()
            return seq

    def clear(self) -> None:
        """Reconexion: los paquetes viejos no sirven para el decoder nuevo."""
        with self._cond:
            self._items.clear()
            self._keys.clear()
            self._bytes = 0
            self._first_seq = self._next_seq
            self._generation += 1
            self._cond.notify_all()

    def close(self) -> None:
        with self._cond:
            self._closed = True
            self._cond.notify_all()

    def _drop_first_gop(self) -> None:
        end = self._keys[1]
        while self._items and self._items[0].seq < end:
            self._bytes -= self._items.popleft().size
        self._keys.popleft()
        self._first_seq = end

    def _reset_locked(self) -> None:
        self._items.clear()
        self._keys.clear()
        self._bytes = 0
        self._first_seq = self._next_seq
        self._generation += 1

    def _trim(self) -> None:
        # Un solo GOP gigante (sin 2.o keyframe) no se puede recortar por GOP: tope duro
        # al doble del presupuesto -> se vacia y se espera el proximo keyframe (H2).
        if len(self._keys) < 2 and (self._bytes > 2 * self.max_bytes or len(self._items) > 2 * self.max_items):
            self._reset_locked()
            return
        while len(self._keys) >= 2:
            newest = self._items[-1].ts
            second_key_ts = self._items[self._keys[1] - self._first_seq].ts
            over_budget = (self._bytes > self.max_bytes or len(self._items) > self.max_items)
            if newest - second_key_ts >= self.max_seconds or over_budget:
                self._drop_first_gop()
            else:
                break

    # -- lectura ------------------------------------------------------------
    @property
    def generation(self) -> int:
        return self._generation

    @property
    def first_seq(self) -> int:
        with self._cond:
            return self._first_seq

    @property
    def next_seq(self) -> int:
        with self._cond:
            return self._next_seq

    def __len__(self) -> int:
        with self._cond:
            return len(self._items)

    @property
    def total_bytes(self) -> int:
        with self._cond:
            return self._bytes

    def span_seconds(self) -> float:
        with self._cond:
            if len(self._items) < 2:
                return 0.0
            return self._items[-1].ts - self._items[0].ts

    def gop_count(self) -> int:
        with self._cond:
            return len(self._keys)

    def last_key_seq(self) -> Optional[int]:
        with self._cond:
            return self._keys[-1] if self._keys else None

    def key_after(self, seq: int) -> Optional[int]:
        """Seq del ultimo keyframe, solo si es posterior a `seq`."""
        with self._cond:
            if self._keys and self._keys[-1] > seq:
                return self._keys[-1]
            return None

    def get(self, seq: int) -> Optional[RingItem]:
        with self._cond:
            return self._get(seq)

    def _get(self, seq: int) -> Optional[RingItem]:
        if seq < self._first_seq:
            raise RingOverrun(self._first_seq)
        idx = seq - self._first_seq
        if idx >= len(self._items):
            return None
        return self._items[idx]

    def wait_get(self, seq: int, timeout: float) -> Optional[RingItem]:
        """Bloquea hasta que exista el paquete `seq` (o `timeout`). Lanza
        `RingOverrun` si ya fue descartado."""
        deadline = time.monotonic() + max(0.0, timeout)
        with self._cond:
            while True:
                item = self._get(seq)
                if item is not None:
                    return item
                remaining = deadline - time.monotonic()
                if remaining <= 0 or self._closed:
                    return None
                self._cond.wait(remaining)

    def wait_key_after(self, seq: int, timeout: float) -> Optional[int]:
        """Bloquea hasta que haya un keyframe con seq > `seq` (o `timeout`)."""
        deadline = time.monotonic() + max(0.0, timeout)
        with self._cond:
            while True:
                if self._keys and self._keys[-1] > seq:
                    return self._keys[-1]
                remaining = deadline - time.monotonic()
                if remaining <= 0 or self._closed:
                    return None
                self._cond.wait(remaining)


# ----------------------------------------------------------------------------
# Regla de disparo: vehiculo EN MOVIMIENTO dentro de la zona
# ----------------------------------------------------------------------------
Box = Tuple[float, float, float, float]


def _point_in_polygon(x: float, y: float, polygon: Sequence[Tuple[float, float]]) -> bool:
    """Ray casting; el borde cuenta como adentro (aprox. suficiente para un disparo)."""
    inside = False
    n = len(polygon)
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        # sobre un borde: adentro
        cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi)
        if abs(cross) < 1e-9 and min(xi, xj) - 1e-9 <= x <= max(xi, xj) + 1e-9 \
                and min(yi, yj) - 1e-9 <= y <= max(yi, yj) + 1e-9:
            return True
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def normalize_zone(zone: Any) -> List[List[Tuple[float, float]]]:
    """`lprSettings.zone` (lista de poligonos de {x, y} normalizados) -> listas de
    tuplas; descarta poligonos con menos de 3 puntos o malformados."""
    polygons: List[List[Tuple[float, float]]] = []
    for poly in zone or []:
        try:
            pts = [(float(p['x']), float(p['y'])) for p in poly]
        except (TypeError, KeyError, ValueError):
            continue
        if len(pts) >= 3:
            polygons.append(pts)
    return polygons


class MotionGate:
    """Dice si hay un vehiculo moviendose dentro de la zona.

    Regla (la del grabador de eventos que funciono en terreno): clase vehiculo
    (lo filtra el detector), borde inferior central dentro de la zona, alto de la
    caja >= `min_box_h` del cuadro y movimiento > `move_frac` del ancho.

    El movimiento NO se mide con un tracker (a 2 fps ByteTrack pierde el id de un
    auto que cruza rapido y nunca acumularia desplazamiento). Se usan dos listas:
    `candidatos` (detecciones de los ultimos ~1.5 s) y `estaticos` (cajas que ya se vieron
    quietas, `history_seconds`). Una deteccion es ESTATICA si hay una caja de tamano
    parecido a menos de `move_frac` del ancho y de al menos `min_age` segundos de
    antiguedad en `estaticos`, o en `candidatos` (y en ese caso se promueve a
    `estaticos`: lleva quieta `min_age`). Si no, el vehiculo es nuevo o se desplazo
    => en movimiento. Solo las cajas quietas entran a `estaticos`: la estela de un
    auto que cruza no "envenena" el historial y el siguiente auto por el mismo carril
    sigue disparando. Un auto estacionado (aunque la deteccion parpadee) siempre
    encuentra su caja vieja y nunca dispara; uno que llega a la zona, o arranca,
    dispara. Durante `warmup_seconds` solo aprende (los autos ya presentes al
    arrancar no cuentan como "llegadas").

    Todo en las unidades del cuadro que se le pase (el HD y el sub-stream tienen
    cada uno su propia instancia)."""

    CANDIDATE_SECONDS = 1.5    # un candidato solo se promueve con una 2.a vista cercana en el tiempo

    def __init__(self, zone: Any = None, min_box_h: float = 0.12, move_frac: float = 0.03,
                 min_age: float = 0.4, history_seconds: float = 30.0, warmup_seconds: float = 1.0,
                 size_ratio: Tuple[float, float] = (0.6, 1.7)) -> None:
        self.min_box_h = float(min_box_h)
        self.move_frac = float(move_frac)
        self.min_age = float(min_age)
        self.history_seconds = float(history_seconds)
        self.warmup_seconds = float(warmup_seconds)
        self.size_ratio = size_ratio
        self._polygons = normalize_zone(zone)
        self._zone_key = repr(zone)
        self._static: Deque[Tuple[float, float, float, float]] = deque()      # (t, cx, bottom, w)
        self._candidates: Deque[Tuple[float, float, float, float]] = deque()
        self._started: Optional[float] = None

    def set_zone(self, zone: Any) -> None:
        key = repr(zone)
        if key != self._zone_key:
            self._zone_key = key
            self._polygons = normalize_zone(zone)

    def reset(self) -> None:
        self._static.clear()
        self._candidates.clear()
        self._started = None

    def in_zone(self, cx: float, bottom: float, frame_w: float, frame_h: float) -> bool:
        if not self._polygons:
            return True  # sin zona: todo el cuadro
        nx, ny = cx / frame_w, bottom / frame_h
        return any(_point_in_polygon(nx, ny, poly) for poly in self._polygons)

    def update(self, boxes: Sequence[Box], frame_w: float, frame_h: float, t: float) -> bool:
        if frame_w <= 0 or frame_h <= 0:
            return False
        if self._started is None:
            self._started = t
        warming = (t - self._started) < self.warmup_seconds
        while self._static and t - self._static[0][0] > self.history_seconds:
            self._static.popleft()
        while self._candidates and t - self._candidates[0][0] > self.CANDIDATE_SECONDS:
            self._candidates.popleft()
        lo, hi = self.size_ratio
        reach = self.move_frac * frame_w
        moving = False
        new_static: List[Tuple[float, float, float, float]] = []
        new_candidates: List[Tuple[float, float, float, float]] = []

        def near(entries: Deque[Tuple[float, float, float, float]], cx: float, bottom: float, w: float) -> bool:
            return any(t - ht >= self.min_age and lo <= w / hw <= hi
                       and ((cx - hx) ** 2 + (bottom - hb) ** 2) ** 0.5 <= reach
                       for ht, hx, hb, hw in entries)

        for x1, y1, x2, y2 in boxes:
            if (y2 - y1) < self.min_box_h * frame_h:
                continue
            cx, bottom, w = (x1 + x2) / 2.0, float(y2), max(1.0, x2 - x1)
            if not self.in_zone(cx, bottom, frame_w, frame_h):
                continue
            entry = (t, cx, bottom, w)
            if near(self._static, cx, bottom, w):
                new_static.append(entry)            # refresca al auto estacionado
            elif near(self._candidates, cx, bottom, w):
                new_static.append(entry)            # quieto >= min_age: se promueve
            else:
                new_candidates.append(entry)
                if not warming:
                    moving = True
        self._static.extend(new_static)
        self._candidates.extend(new_candidates)
        return moving


class ChangeDetector:
    """Pre-filtro barato (~0.2 ms) para no correr YOLO sobre una escena quieta.

    Compara el cuadro (reducido a `size`, gris) con el anterior dentro del rectangulo
    de la zona (agrandado `margin`: el cuerpo del auto sobresale del poligono).
    `should_detect` pide YOLO si:
    - cambio mas de `min_fraction` de los pixeles (mas de `pixel_threshold` niveles);
    - hubo cambio hace <= `hold_seconds` (un auto que se detiene recibe 2-4 vistas
      seguidas y la `MotionGate` lo reconoce como quieto);
    - pasaron `refresh_seconds` desde la ultima deteccion (se hace una rafaga de 2
      cuadros seguidos, para refrescar el historial de autos estacionados).

    Red de seguridad (`sustained_change`): un cambio grande (`>= sustain_fraction`) en
    `sustain_checks` chequeos seguidos activa aunque YOLO no devuelva cajas (auto
    oscuro, de noche, ocluido...). Cuesta alguna activacion de mas."""

    def __init__(self, zone: Any = None, pixel_threshold: int = 25, min_fraction: float = 0.015,
                 refresh_seconds: float = 5.0, size: Tuple[int, int] = (160, 90), margin: float = 0.25,
                 hold_seconds: float = 2.0, sustain_fraction: float = 0.03, sustain_checks: int = 2) -> None:
        self.pixel_threshold = int(pixel_threshold)
        self.min_fraction = float(min_fraction)
        self.refresh_seconds = float(refresh_seconds)
        self.size = size
        self.margin = float(margin)
        self.hold_seconds = float(hold_seconds)
        self.sustain_fraction = float(sustain_fraction)
        self.sustain_checks = int(sustain_checks)
        self._polygons = normalize_zone(zone)
        self._zone_key = repr(zone)
        self._prev: Any = None
        self._last_detect: Optional[float] = None
        self._last_change: Optional[float] = None
        self._burst = 0
        self._consecutive_big = 0
        self.last_fraction = 0.0

    @property
    def sustained_change(self) -> bool:
        return self._consecutive_big >= self.sustain_checks

    def set_zone(self, zone: Any) -> None:
        key = repr(zone)
        if key != self._zone_key:
            self._zone_key = key
            self._polygons = normalize_zone(zone)

    def _region(self) -> Tuple[int, int, int, int]:
        w, h = self.size
        if not self._polygons:
            return 0, 0, w, h
        xs = [x for poly in self._polygons for x, _y in poly]
        ys = [y for poly in self._polygons for _x, y in poly]
        mx, my = (max(xs) - min(xs)) * self.margin, (max(ys) - min(ys)) * self.margin
        x1, x2 = max(0.0, min(xs) - mx), min(1.0, max(xs) + mx)
        y1, y2 = max(0.0, min(ys) - my), min(1.0, max(ys) + my)
        return int(x1 * w), int(y1 * h), max(int(x1 * w) + 1, int(x2 * w)), max(int(y1 * h) + 1, int(y2 * h))

    def should_detect(self, image: Any, t: float) -> bool:
        import cv2

        small = cv2.resize(image, self.size, interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY) if small.ndim == 3 else small
        prev, self._prev = self._prev, gray
        fraction = 0.0
        if prev is not None:
            x1, y1, x2, y2 = self._region()
            diff = cv2.absdiff(gray[y1:y2, x1:x2], prev[y1:y2, x1:x2])
            fraction = float((diff > self.pixel_threshold).sum()) / max(1, diff.size)
        self.last_fraction = fraction
        self._consecutive_big = self._consecutive_big + 1 if fraction >= self.sustain_fraction else 0
        changed = fraction >= self.min_fraction
        if changed:
            self._last_change = t
        due = (self._last_detect is None or changed or self._burst > 0
               or (self._last_change is not None and t - self._last_change <= self.hold_seconds))
        if self._burst > 0:
            self._burst -= 1
        if not due and (t - (self._last_detect or 0.0)) >= self.refresh_seconds:
            due = True
            self._burst = 1       # rafaga: el proximo cuadro tambien se detecta
        if due:
            self._last_detect = t
        return due


# ----------------------------------------------------------------------------
# Maquina de estados
# ----------------------------------------------------------------------------
IDLE = 'idle'
ACTIVE = 'active'


class RestStateMachine:
    """idle --(movimiento)--> active --(`idle_seconds` sin movimiento)--> idle."""

    def __init__(self, idle_seconds: float = 4.0) -> None:
        if idle_seconds <= 0:
            raise ValueError('idle_seconds must be > 0')
        self.idle_seconds = float(idle_seconds)
        self.state = IDLE
        self.last_motion = 0.0
        self.activations = 0

    def observe(self, t: float, moving: bool) -> Optional[str]:
        """Resultado de un chequeo de presencia. Devuelve 'activate' al pasar a active."""
        if not moving:
            return None
        self.last_motion = t
        if self.state == IDLE:
            self.state = ACTIVE
            self.activations += 1
            return 'activate'
        return None

    def touch(self, t: float) -> None:
        """Evidencia de movimiento del HD: solo prolonga un periodo activo."""
        if self.state == ACTIVE and t > self.last_motion:
            self.last_motion = t

    def tick(self, t: float) -> Optional[str]:
        """Devuelve 'deactivate' al vencer `idle_seconds` sin movimiento."""
        if self.state == ACTIVE and t - self.last_motion >= self.idle_seconds:
            self.state = IDLE
            return 'deactivate'
        return None


class RestController:
    """Maquina de estados + callbacks + tiempo activo, segura entre hilos.

    Los callbacks corren FUERA del lock y en el hilo que provoco la transicion."""

    def __init__(self, idle_seconds: float, on_activate: Callable[[], None],
                 on_deactivate: Callable[[], None], clock: Callable[[], float] = time.monotonic) -> None:
        self._sm = RestStateMachine(idle_seconds)
        self._on_activate = on_activate
        self._on_deactivate = on_deactivate
        self._clock = clock
        self._lock = threading.Lock()
        self._active_since: Optional[float] = None
        self._active_total = 0.0
        self._window_start = clock()
        self._window_active = 0.0
        self.hd_decoded = 0
        self.sub_decoded = 0

    @property
    def state(self) -> str:
        return self._sm.state

    @property
    def activations(self) -> int:
        return self._sm.activations

    def observe(self, moving: bool, t: Optional[float] = None) -> bool:
        now = self._clock() if t is None else t
        with self._lock:
            transition = self._sm.observe(now, moving)
            if transition == 'activate':
                self._active_since = now
        if transition == 'activate':
            self._on_activate()
            return True
        return False

    def touch(self, t: Optional[float] = None) -> None:
        with self._lock:
            self._sm.touch(self._clock() if t is None else t)

    def tick(self, t: Optional[float] = None) -> bool:
        now = self._clock() if t is None else t
        with self._lock:
            transition = self._sm.tick(now)
            if transition == 'deactivate':
                self._close_active(now)
        if transition == 'deactivate':
            self._on_deactivate()
            return True
        return False

    def _close_active(self, now: float) -> None:
        if self._active_since is not None:
            span = max(0.0, now - self._active_since)
            self._active_total += span
            self._window_active += span
            self._active_since = None

    def poll_window(self, interval: float = 60.0) -> Optional[Dict[str, Any]]:
        """Una vez por `interval`: estado, % de tiempo activo de la ventana y
        cuadros decodificados (HD / sub-stream); None antes de tiempo."""
        now = self._clock()
        with self._lock:
            elapsed = now - self._window_start
            if elapsed < interval:
                return None
            active = self._window_active
            if self._active_since is not None:
                active += max(0.0, now - max(self._active_since, self._window_start))
            report = {
                'state': self._sm.state,
                'seconds': elapsed,
                'active_pct': 100.0 * min(1.0, active / max(elapsed, 1e-9)),
                'hd_decoded': self.hd_decoded,
                'sub_decoded': self.sub_decoded,
                'activations': self._sm.activations,
            }
            self._window_start = now
            self._window_active = 0.0
            self.hd_decoded = 0
            self.sub_decoded = 0
        return report


def format_rest_report(report: Dict[str, Any]) -> str:
    return ('Reposo: estado=%s activo=%.1f%% de %.0fs hd_decodificados=%d sub_decodificados=%d '
            'activaciones=%d' % (report['state'], report['active_pct'], report['seconds'],
                                 report['hd_decoded'], report['sub_decoded'], report['activations']))
