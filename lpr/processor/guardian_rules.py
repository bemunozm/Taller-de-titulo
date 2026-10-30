"""Motor de reglas del Guardián (intrusión y merodeo), PURO y testeable.

No abre cámaras, no habla con el backend y no corre YOLO: recibe las
detecciones ya seguidas por el tracker (`track_id`, caja, confianza) con un
reloj inyectado (`now`, en segundos; el worker pasa `time.monotonic()` y el
replay el tiempo del video) y devuelve las anomalías que hay que reportar.
Así el mismo código decide en producción y en `lpr/tools/guardian_replay.py`.

Reglas:

* Intrusión (igual que siempre, decisión explícita del usuario): basta que la
  cabeza, el centro o los pies de la caja (x central; y1, centro, y2) caigan en
  una zona de tipo `intrusion`, con un track estable (>= `min_hits`). Las zonas
  en formato legacy (lista de polígonos) son todas `intrusion`.
* Merodeo: tiempo ACUMULADO de la persona dentro de una zona de tipo
  `loitering` (umbral `loiterSeconds` de la zona, 20 s por defecto). Sin
  ninguna zona configurada se conserva el comportamiento histórico: merodeo =
  más de 20 s visible en el cuadro. Con zonas pero ninguna de merodeo, no hay
  merodeo.
* No re-disparar: cooldown por track (10 s intrusión, 60 s merodeo) y cooldown
  por (zona, tipo) con supresión espacial: si en esa zona/tipo se alertó hace
  poco y la nueva persona está a menos de ~1 alto de caja de la última
  alertada, se suprime aunque ByteTrack le haya dado un id nuevo.
* Re-enlace: un track nuevo que aparece cerca (<= ~1 alto de caja) de donde se
  perdió otro hace <= 5 s hereda su `first_seen`, su tiempo acumulado en zona,
  sus aciertos y sus cooldowns (el merodeo no vuelve a cero con el cambio de id).
* Toda la memoria (tracks, cooldowns por zona) se purga junta y acotada por TTL.
"""
import math
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from lpr.utils.zones import point_in_polygon, polygon_to_pixels, valid_polygons

ANOMALY_INTRUSION = 'intrusion'
ANOMALY_LOITERING = 'loitering'
DEFAULT_LOITER_SECONDS = 20.0
MIN_LOITER_SECONDS = 1.0
MAX_LOITER_SECONDS = 3600.0

BBox = Tuple[float, float, float, float]
# (track_id, (x1, y1, x2, y2), confidence)
Detection = Tuple[int, BBox, float]
FrameWH = Tuple[int, int]


# --------------------------------------------------------------------------
# Zonas: parseo del contrato del backend (legacy y nuevo)
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class GuardianZone:
    """Zona normalizada (0-1). `points` es una tupla (inmutable y comparable)
    para poder detectar con `==` que el refetch trajo las mismas zonas."""
    points: Tuple[Tuple[float, float], ...]
    type: str = ANOMALY_INTRUSION
    loiter_seconds: float = DEFAULT_LOITER_SECONDS

    def polygon(self) -> List[Dict[str, float]]:
        """Forma `[{x, y}]` que entiende `lpr.utils.zones`."""
        return [{'x': x, 'y': y} for x, y in self.points]


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _clean_points(raw: Any) -> Optional[Tuple[Tuple[float, float], ...]]:
    """Puntos `{x, y}` numéricos; un polígono con algún punto inválido o con
    menos de 3 puntos se descarta entero (uno malformado no encierra nada fiable)."""
    if not isinstance(raw, (list, tuple)) or not valid_polygons([raw]):
        return None
    points: List[Tuple[float, float]] = []
    for p in raw:
        if not isinstance(p, dict) or not _is_number(p.get('x')) or not _is_number(p.get('y')):
            return None
        points.append((float(p['x']), float(p['y'])))
    return tuple(points)


def parse_guardian_zones(raw: Any) -> List[GuardianZone]:
    """`guardianZones` del backend -> zonas tipadas.

    Acepta los dos formatos del contrato:
    * LEGACY: `[[{x,y},...], ...]` (lista de polígonos) -> todas `intrusion`.
    * NUEVO: `[{points:[{x,y},...], type:'intrusion'|'loitering', loiterSeconds?}]`.
    Un tipo desconocido cae a `intrusion` (ante la duda, vigilar de más)."""
    if not isinstance(raw, (list, tuple)):
        return []
    zones: List[GuardianZone] = []
    for item in raw:
        ztype: Any = ANOMALY_INTRUSION
        loiter: Any = None
        if isinstance(item, dict):
            points = _clean_points(item.get('points'))
            ztype = item.get('type')
            loiter = item.get('loiterSeconds')
        else:
            points = _clean_points(item)
        if points is None:
            continue
        if ztype != ANOMALY_LOITERING:
            ztype = ANOMALY_INTRUSION
        seconds = float(loiter) if _is_number(loiter) and loiter > 0 else DEFAULT_LOITER_SECONDS
        seconds = min(max(seconds, MIN_LOITER_SECONDS), MAX_LOITER_SECONDS)
        zones.append(GuardianZone(points=points, type=ztype, loiter_seconds=seconds))
    return zones


# --------------------------------------------------------------------------
# Configuración y resultado
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class GuardianConfig:
    min_hits: int = 3                       # frames para confiar en un track
    default_loiter_seconds: float = DEFAULT_LOITER_SECONDS   # sin zonas: visible en el cuadro
    intrusion_track_cooldown: float = 10.0
    loitering_track_cooldown: float = 60.0
    # Supresión por (zona, tipo). La intrusión es más corta (20 s): con 60 s se
    # suprimía la entrada real de visitas que antes esperaron junto a la reja
    # (medido sobre 71 clips de Acceso: 33/54 intrusiones con 60 s, 44/54 con 20 s).
    intrusion_zone_cooldown: float = 20.0
    loitering_zone_cooldown: float = 60.0
    spatial_factor: float = 1.0             # en altos de caja
    relink_seconds: float = 5.0
    # Hueco máximo entre dos avistamientos que cuenta como presencia continua al
    # acumular tiempo en zona. Distinto de `relink_seconds`: con un muestreo lento
    # (poll_interval 10 s) cada hueco normal supera 5 s. Ver `max_gap_for_poll_interval`.
    max_gap_seconds: float = 5.0
    relink_factor: float = 1.0              # en altos de caja
    track_ttl: float = 30.0                 # un track no visto se olvida
    max_tracks: int = 256                   # tope duro de memoria

    def zone_cooldown_for(self, kind: str) -> float:
        return self.loitering_zone_cooldown if kind == ANOMALY_LOITERING else self.intrusion_zone_cooldown


@dataclass(frozen=True)
class AnomalyDecision:
    type: str                 # 'intrusion' | 'loitering'
    track_id: int
    bbox: BBox
    conf: float
    duration_seconds: float
    zone_index: int           # -1 = sin zonas (cuadro completo)
    emitted_at: float = 0.0   # `now` de la emisión (lo usa `forget_emission`)


@dataclass
class _Track:
    first_seen: float
    last_seen: float
    hits: int = 0
    bbox: BBox = (0.0, 0.0, 0.0, 0.0)
    in_zone: Dict[int, float] = field(default_factory=dict)         # zona -> segundos acumulados
    last_in_zone: Dict[int, float] = field(default_factory=dict)    # zona -> último instante dentro
    emitted: Dict[str, float] = field(default_factory=dict)         # tipo -> último aviso


@dataclass
class _ZoneAlert:
    ts: float
    center: Tuple[float, float]
    height: float


def _center(bbox: BBox) -> Tuple[float, float]:
    return (bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0


def _height(bbox: BBox) -> float:
    return max(1.0, bbox[3] - bbox[1])


def _distance(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _probe_points(bbox: BBox) -> Tuple[Tuple[float, float], ...]:
    """Cabeza, centro y pies (x central de la caja)."""
    x1, y1, x2, y2 = bbox
    cx = (x1 + x2) / 2.0
    return (cx, y1), (cx, (y1 + y2) / 2.0), (cx, y2)


def _normalize_detections(detections: Iterable[Detection]) -> List[Detection]:
    """Un solo registro por track_id (el de mayor confianza) y tipos limpios."""
    best: Dict[int, Detection] = {}
    for tid, bbox, conf in detections:
        det = (int(tid), (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])), float(conf))
        prev = best.get(det[0])
        if prev is None or det[2] > prev[2]:
            best[det[0]] = det
    return list(best.values())


class _ZoneSet:
    """Zonas + sus polígonos en píxeles por tamaño de cuadro (se calculan una vez)."""

    def __init__(self, zones: Sequence[GuardianZone]) -> None:
        self.zones: Tuple[GuardianZone, ...] = tuple(zones)
        self._px: Dict[FrameWH, List[np.ndarray]] = {}

    def pixels(self, frame_wh: FrameWH) -> List[np.ndarray]:
        cached = self._px.get(frame_wh)
        if cached is None:
            cached = [polygon_to_pixels(z.polygon(), frame_wh[0], frame_wh[1]) for z in self.zones]
            if len(self._px) > 4:  # el tamaño del cuadro casi nunca cambia
                self._px.clear()
            self._px[frame_wh] = cached
        return cached


# --------------------------------------------------------------------------
# Motor de reglas actual
# --------------------------------------------------------------------------
class GuardianRules:
    def __init__(self, config: Optional[GuardianConfig] = None) -> None:
        self.config = config or GuardianConfig()
        self._lock = threading.Lock()  # set_zones (hilo de fondo) vs update (hilo de frames)
        self._zoneset = _ZoneSet(())
        self._tracks: Dict[int, _Track] = {}
        self._zone_alerts: Dict[Tuple[int, str], _ZoneAlert] = {}

    # -- zonas ---------------------------------------------------------
    @property
    def zones(self) -> Tuple[GuardianZone, ...]:
        return self._zoneset.zones

    def set_zones(self, zones: Iterable[GuardianZone]) -> bool:
        """Reemplaza las zonas. Zonas idénticas = no-op (el refetch periódico no
        debe reiniciar el merodeo acumulado); si cambian, el estado atado a los
        índices de zona se reinicia. Devuelve True si hubo cambio."""
        new = tuple(zones)
        with self._lock:
            if new == self._zoneset.zones:
                return False
            self._zoneset = _ZoneSet(new)
            self._zone_alerts.clear()
            for tr in self._tracks.values():
                tr.in_zone.clear()
                tr.last_in_zone.clear()
            return True

    def zone_pixel_polygons(self, frame_wh: FrameWH) -> List[np.ndarray]:
        return list(self._zoneset.pixels(frame_wh))

    @property
    def active_tracks(self) -> int:
        return len(self._tracks)

    # -- memoria -------------------------------------------------------
    def purge(self, now: float) -> None:
        with self._lock:
            self._purge(now)

    def _purge(self, now: float) -> None:
        cfg = self.config
        for tid in [t for t, tr in self._tracks.items() if now - tr.last_seen > cfg.track_ttl]:
            del self._tracks[tid]
        if len(self._tracks) > cfg.max_tracks:
            keep = sorted(self._tracks.items(), key=lambda kv: kv[1].last_seen, reverse=True)[:cfg.max_tracks]
            self._tracks = dict(keep)
        for key in [k for k, za in self._zone_alerts.items() if now - za.ts > cfg.zone_cooldown_for(k[1])]:
            del self._zone_alerts[key]

    def forget_emission(self, decision: AnomalyDecision) -> None:
        """El aviso NO llegó al backend: borra el cooldown del track y la supresión
        de (zona, tipo) de ESA emisión para que el siguiente frame pueda re-alertar.
        La supresión de la zona solo se borra si sigue siendo la de esta emisión
        (otra persona pudo alertar después)."""
        with self._lock:
            tr = self._tracks.get(decision.track_id)
            if tr is not None and tr.emitted.get(decision.type) == decision.emitted_at:
                del tr.emitted[decision.type]
            key = (decision.zone_index, decision.type)
            za = self._zone_alerts.get(key)
            if za is not None and za.ts == decision.emitted_at:
                del self._zone_alerts[key]

    # -- núcleo --------------------------------------------------------
    def update(self, now: float, detections: Iterable[Detection], frame_wh: FrameWH) -> List[AnomalyDecision]:
        with self._lock:
            dets = _normalize_detections(detections)
            self._relink(now, dets)
            decisions: List[AnomalyDecision] = []
            for tid, bbox, conf in dets:
                decision = self._evaluate(now, tid, bbox, conf, frame_wh)
                decisions.extend(decision)
            self._purge(now)
            return decisions

    def _relink(self, now: float, dets: List[Detection]) -> None:
        """Un id nuevo cerca de donde se perdió otro hace poco hereda su estado."""
        cfg = self.config
        present = {d[0] for d in dets}
        lost = [tid for tid, tr in self._tracks.items()
                if tid not in present and 0.0 <= now - tr.last_seen <= cfg.relink_seconds]
        if not lost:
            return
        for tid, bbox, _conf in sorted((d for d in dets if d[0] not in self._tracks),
                                       key=lambda d: -d[2]):
            c = _center(bbox)
            best: Optional[int] = None
            best_dist = 0.0
            for old in lost:
                old_box = self._tracks[old].bbox
                limit = cfg.relink_factor * max(_height(bbox), _height(old_box))
                dist = _distance(c, _center(old_box))
                if dist <= limit and (best is None or dist < best_dist):
                    best, best_dist = old, dist
            if best is not None:
                self._tracks[tid] = self._tracks.pop(best)  # hereda todo (first_seen, hits, cooldowns)
                lost.remove(best)
                if not lost:
                    return

    def _evaluate(self, now: float, tid: int, bbox: BBox, conf: float,
                  frame_wh: FrameWH) -> List[AnomalyDecision]:
        cfg = self.config
        tr = self._tracks.get(tid)
        if tr is None:
            tr = _Track(first_seen=now, last_seen=now)
            self._tracks[tid] = tr
        tr.last_seen = now
        tr.hits += 1
        tr.bbox = bbox
        stable = tr.hits >= cfg.min_hits

        zoneset = self._zoneset
        zones = zoneset.zones
        inside: List[int] = []
        if zones:
            polys = zoneset.pixels(frame_wh)
            pts = _probe_points(bbox)
            inside = [i for i, poly in enumerate(polys) if any(point_in_polygon(p, poly) for p in pts)]
            self._accumulate(now, tr, inside)

        out: List[AnomalyDecision] = []
        # -- intrusión
        intrusion_zone = next((i for i in inside if zones[i].type == ANOMALY_INTRUSION), None)
        if stable and intrusion_zone is not None:
            d = self._try_emit(now, tid, tr, bbox, conf, ANOMALY_INTRUSION, intrusion_zone,
                               now - tr.first_seen, cfg.intrusion_track_cooldown)
            if d:
                out.append(d)
        # -- merodeo
        if stable:
            if not zones:
                elapsed = now - tr.first_seen
                if elapsed > cfg.default_loiter_seconds:
                    d = self._try_emit(now, tid, tr, bbox, conf, ANOMALY_LOITERING, -1, elapsed,
                                       cfg.loitering_track_cooldown)
                    if d:
                        out.append(d)
            else:
                for i in inside:
                    z = zones[i]
                    if z.type == ANOMALY_LOITERING and tr.in_zone.get(i, 0.0) > z.loiter_seconds:
                        d = self._try_emit(now, tid, tr, bbox, conf, ANOMALY_LOITERING, i,
                                           tr.in_zone[i], cfg.loitering_track_cooldown)
                        if d:
                            out.append(d)
                        break
        return out

    def _accumulate(self, now: float, tr: _Track, inside: List[int]) -> None:
        """Suma el tiempo entre frames consecutivos dentro de cada zona. Un hueco
        mayor que `max_gap_seconds` (la persona no se vio) no se cuenta como presencia."""
        for i in inside:
            last = tr.last_in_zone.get(i)
            if last is not None:
                gap = now - last
                if 0.0 < gap <= self.config.max_gap_seconds:
                    tr.in_zone[i] = tr.in_zone.get(i, 0.0) + gap
            else:
                tr.in_zone.setdefault(i, 0.0)
            tr.last_in_zone[i] = now

    def _try_emit(self, now: float, tid: int, tr: _Track, bbox: BBox, conf: float, kind: str,
                  zone_index: int, duration: float, track_cooldown: float) -> Optional[AnomalyDecision]:
        cfg = self.config
        if now - tr.emitted.get(kind, -math.inf) <= track_cooldown:
            return None
        key = (zone_index, kind)
        za = self._zone_alerts.get(key)
        c, h = _center(bbox), _height(bbox)
        if za is not None and now - za.ts < cfg.zone_cooldown_for(kind) \
                and _distance(c, za.center) < cfg.spatial_factor * max(h, za.height):
            return None
        tr.emitted[kind] = now
        self._zone_alerts[key] = _ZoneAlert(ts=now, center=c, height=h)
        return AnomalyDecision(type=kind, track_id=tid, bbox=bbox, conf=conf,
                               duration_seconds=float(duration), zone_index=zone_index, emitted_at=now)


# --------------------------------------------------------------------------
# Reglas ANTERIORES (main), solo para la línea base "antes" del replay
# --------------------------------------------------------------------------
class LegacyRules:
    """Reproduce el comportamiento previo del worker, defectos incluidos: todas
    las zonas son de intrusión, el merodeo es "más de 20 s visible" (con o sin
    zonas, solo si no hay intrusión), sin re-enlace ni supresión por zona; el
    cooldown es por track_id (10 s / 60 s). Mismo API que `GuardianRules`."""

    LOITER_SECONDS = 20.0
    MIN_HITS = 3
    SIGHTING_TTL = 30.0

    def __init__(self) -> None:
        self._zoneset = _ZoneSet(())
        self._sightings: Dict[int, Dict[str, float]] = {}
        self._hits: Dict[int, int] = {}
        self._emitted: Dict[str, float] = {}

    @property
    def zones(self) -> Tuple[GuardianZone, ...]:
        return self._zoneset.zones

    def set_zones(self, zones: Iterable[GuardianZone]) -> bool:
        new = tuple(zones)
        if new == self._zoneset.zones:
            return False
        self._zoneset = _ZoneSet(new)
        return True

    def zone_pixel_polygons(self, frame_wh: FrameWH) -> List[np.ndarray]:
        return list(self._zoneset.pixels(frame_wh))

    @property
    def active_tracks(self) -> int:
        return len(self._sightings)

    def forget_emission(self, decision: AnomalyDecision) -> None:
        self._emitted.pop(f'{decision.type}_{decision.track_id}', None)

    def purge(self, now: float) -> None:
        for tid in [t for t, s in self._sightings.items() if now - s['last_seen'] > self.SIGHTING_TTL]:
            del self._sightings[tid]
            self._hits.pop(tid, None)

    def update(self, now: float, detections: Iterable[Detection], frame_wh: FrameWH) -> List[AnomalyDecision]:
        out: List[AnomalyDecision] = []
        polys = self._zoneset.pixels(frame_wh)
        for tid, bbox, conf in _normalize_detections(detections):
            self.purge(now)
            s = self._sightings.setdefault(tid, {'first_seen': now, 'last_seen': now})
            s['last_seen'] = now
            self._hits[tid] = self._hits.get(tid, 0) + 1
            elapsed = now - s['first_seen']
            stable = self._hits[tid] >= self.MIN_HITS
            intrusion = False
            zone_idx = -1
            if polys and stable:
                pts = _probe_points(bbox)
                for i, poly in enumerate(polys):
                    if any(point_in_polygon(p, poly) for p in pts):
                        intrusion, zone_idx = True, i
                        break
            if intrusion:
                if now - self._emitted.get(f'intrusion_{tid}', -math.inf) > 10:
                    out.append(AnomalyDecision(ANOMALY_INTRUSION, tid, bbox, conf, elapsed, zone_idx, now))
                    self._emitted[f'intrusion_{tid}'] = now
            elif elapsed > self.LOITER_SECONDS and stable:
                if now - self._emitted.get(f'loitering_{tid}', -math.inf) > 60:
                    out.append(AnomalyDecision(ANOMALY_LOITERING, tid, bbox, conf, elapsed, -1, now))
                    self._emitted[f'loitering_{tid}'] = now
        return out


def max_gap_for_poll_interval(poll_interval: Optional[float]) -> float:
    """Hueco máximo contable al acumular tiempo en zona: max(5 s, 3 intervalos de muestreo)."""
    try:
        poll = float(poll_interval) if poll_interval is not None else 0.0
    except (TypeError, ValueError):
        poll = 0.0
    return max(5.0, 3.0 * poll) if math.isfinite(poll) else 5.0


def now_monotonic() -> float:
    """Reloj por defecto del worker (monótono: inmune a saltos de hora)."""
    return time.monotonic()
