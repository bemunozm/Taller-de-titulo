"""Direccion de un vehiculo (entrada/salida) a partir de su trayectoria.

Modulo PURO (sin cv2 ni ultralytics): se testea en CI y lo comparten el worker
y la herramienta de replay. Recibe la trayectoria del punto "borde inferior
central" de la caja del vehiculo (donde toca el piso, el punto menos sensible a
la altura del auto) y una linea de direccion configurada por camara.

Convencion de lado (coordenadas de IMAGEN: x a la derecha, y hacia ABAJO):
`exitSide` es el lado hacia el que se mueve el vehiculo al SALIR, mirando de
`from` a `to`: izquierda/derecha son las de QUIEN AVANZA de `from` a `to`
(su mano derecha). Ejemplos en pantalla: flecha horizontal apuntando a la
derecha => `right` es HACIA ABAJO; flecha vertical apuntando hacia abajo =>
`right` es hacia la IZQUIERDA de la pantalla. Con y hacia abajo, el producto cruz
`dx*(py-fy) - dy*(px-fx)` es positivo cuando el punto queda a la DERECHA visual
de la flecha from->to (p. ej. from=(0,0), to=(1,0) apunta a la derecha y el
punto de abajo, y>0, queda a su derecha). Por eso `right` => signo +1 y `left`
=> signo -1; la "distancia con signo hacia exitSide" es positiva en el lado de
salida. Cruzar de negativo a positivo = `exit`; de positivo a negativo = `entry`.

Fuente de la decision (`source`), de mayor a menor prioridad:
`camera` (direccion fija de la camara) > `line` (cruce del segmento) >
`motion` (desplazamiento neto sobre la normal) > `width` (tendencia del ancho de
la patente) > `none`.
"""
import math
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Sequence, Tuple

DIRECTION_ENTRY = 'entry'
DIRECTION_EXIT = 'exit'
DIRECTION_UNKNOWN = 'unknown'
DIRECTION_BOTH = 'both'

SOURCE_CAMERA = 'camera'
SOURCE_LINE = 'line'
SOURCE_MOTION = 'motion'
SOURCE_WIDTH = 'width'
SOURCE_NONE = 'none'
# Fuentes que ya no cambian con mas evidencia: la espera de direccion termina.
RESOLVED_SOURCES = (SOURCE_CAMERA, SOURCE_LINE)

# (t, x, y) en pixeles del cuadro completo.
PathPoint = Tuple[float, float, float]

# Largo minimo de la linea (en unidades normalizadas): igual que el contrato.
MIN_LINE_LENGTH = 0.05
# Margen anti-ruido: el punto debe quedar a >= esta fraccion de la diagonal del
# cuadro a cada lado para contar como "estar de ese lado". Sin margen, el jitter
# de la caja de un auto detenido sobre la linea generaria cruces falsos.
DEFAULT_MARGIN_FRAC = 0.02
# Cuanto se tolera que el cruce caiga fuera de los extremos del segmento (fraccion
# de su largo): la caja es ruidosa, pero rodear el extremo NO es cruzar.
SEGMENT_TOLERANCE = 0.05
# Desplazamiento neto minimo (fraccion del ANCHO del cuadro) para el respaldo `motion`.
DEFAULT_MOTION_FRAC = 0.15


@dataclass(frozen=True)
class DirectionLine:
    """Linea de direccion normalizada (0-1) como la manda el backend."""
    fx: float
    fy: float
    tx: float
    ty: float
    exit_side: str  # 'left' | 'right'

    @property
    def length(self) -> float:
        return math.hypot(self.tx - self.fx, self.ty - self.fy)

    @property
    def exit_sign(self) -> float:
        return 1.0 if self.exit_side == 'right' else -1.0

    def to_settings(self) -> dict:
        return {'from': {'x': self.fx, 'y': self.fy}, 'to': {'x': self.tx, 'y': self.ty},
                'exitSide': self.exit_side}

    @classmethod
    def from_settings(cls, raw: Any) -> Optional['DirectionLine']:
        """`lprSettings.directionLine` -> DirectionLine, o None si no es valida
        (coordenadas 0-1 estrictas, largo >= MIN_LINE_LENGTH, exitSide left|right,
        sin propiedades extra). Nunca lanza."""
        if not isinstance(raw, Mapping) or set(raw.keys()) != {'from', 'to', 'exitSide'}:
            return None
        if raw['exitSide'] not in ('left', 'right'):
            return None
        coords = []
        for key in ('from', 'to'):
            point = raw[key]
            if not isinstance(point, Mapping) or set(point.keys()) != {'x', 'y'}:
                return None
            for axis in ('x', 'y'):
                v = point[axis]
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    return None
                v = float(v)
                if not (0.0 <= v <= 1.0):  # NaN tambien falla esta comparacion
                    return None
                coords.append(v)
        line = cls(coords[0], coords[1], coords[2], coords[3], raw['exitSide'])
        return line if line.length >= MIN_LINE_LENGTH else None


def side_of_line(line: DirectionLine, x: float, y: float, frame_w: int = 1, frame_h: int = 1) -> Optional[str]:
    """Lado ('left' | 'right') de un punto respecto de la linea, o None si esta
    exactamente sobre la recta. (x, y) y el tamano del cuadro van en la misma
    unidad (por defecto normalizados). cross = d.x*v.y - d.y*v.x: < 0 => 'left',
    > 0 => 'right' (el mismo criterio que usa el editor del frontend)."""
    dx, dy = (line.tx - line.fx) * frame_w, (line.ty - line.fy) * frame_h
    vx, vy = x - line.fx * frame_w, y - line.fy * frame_h
    cross = dx * vy - dy * vx
    if cross < 0:
        return 'left'
    return 'right' if cross > 0 else None


def _signed_distances(points: Sequence[PathPoint], line: DirectionLine, frame_w: int,
                      frame_h: int) -> Tuple[Tuple[float, float, float, float], list]:
    """Distancia (px) de cada punto a la recta, positiva del lado de SALIDA."""
    fx, fy = line.fx * frame_w, line.fy * frame_h
    tx, ty = line.tx * frame_w, line.ty * frame_h
    dx, dy = tx - fx, ty - fy
    length = math.hypot(dx, dy)
    if length <= 0:
        return (fx, fy, dx, dy), []
    sign = line.exit_sign
    dist = [sign * (dx * (p[2] - fy) - dy * (p[1] - fx)) / length for p in points]
    return (fx, fy, dx, dy), dist


def detect_line_crossing(points: Sequence[PathPoint], line: DirectionLine, frame_w: int,
                         frame_h: int, margin_frac: float = DEFAULT_MARGIN_FRAC) -> Optional[str]:
    """`exit`/`entry` si la trayectoria cruzo el SEGMENTO de la linea, o None.

    * Segmento, no recta infinita: un auto que pasa por el costado de la linea
      (fuera de sus extremos, mas la tolerancia) no cruza.
    * Anti-ruido: solo cuentan los puntos a >= `margin_frac` de la diagonal de la
      recta; la historia de lados se lleva con esos puntos "confiables". Un auto
      que oscila dentro de la banda del margen nunca cruza.
    * Si cruza varias veces, manda el ULTIMO cruce (el sentido en que termino).
    """
    if len(points) < 2 or frame_w <= 0 or frame_h <= 0:
        return None
    (fx, fy, dx, dy), dist = _signed_distances(points, line, frame_w, frame_h)
    if not dist:
        return None
    seg_len2 = dx * dx + dy * dy
    margin = margin_frac * math.hypot(frame_w, frame_h)
    result: Optional[str] = None
    anchor: Optional[int] = None  # ultimo punto confiable
    for i, d in enumerate(dist):
        if abs(d) < margin:
            continue
        if anchor is not None and (dist[anchor] > 0) != (d > 0):
            # El tramo anchor -> i atraviesa la recta; donde la corta?
            d0 = dist[anchor]
            u = d0 / (d0 - d)  # 0..1 sobre el tramo
            px = points[anchor][1] + u * (points[i][1] - points[anchor][1])
            py = points[anchor][2] + u * (points[i][2] - points[anchor][2])
            s = ((px - fx) * dx + (py - fy) * dy) / seg_len2  # 0..1 sobre el segmento
            if -SEGMENT_TOLERANCE <= s <= 1.0 + SEGMENT_TOLERANCE:
                result = DIRECTION_EXIT if d > 0 else DIRECTION_ENTRY
        anchor = i
    return result


def motion_direction(points: Sequence[PathPoint], line: DirectionLine, frame_w: int, frame_h: int,
                     min_frac: float = DEFAULT_MOTION_FRAC) -> Optional[str]:
    """Respaldo sin cruce: desplazamiento neto proyectado sobre la normal de la
    linea (hacia el lado de salida = `exit`). Exige >= `min_frac` del ANCHO del
    cuadro para no decidir por un auto que apenas se movio."""
    if len(points) < 2 or frame_w <= 0 or frame_h <= 0:
        return None
    _, dist = _signed_distances(points, line, frame_w, frame_h)
    if not dist:
        return None
    net = dist[-1] - dist[0]
    if abs(net) < min_frac * frame_w:
        return None
    return DIRECTION_EXIT if net > 0 else DIRECTION_ENTRY


def resolve_direction(
    camera_direction: str,
    line: Optional[DirectionLine],
    points: Sequence[PathPoint],
    width_direction: str,
    frame_size: Optional[Tuple[int, int]],
) -> Tuple[str, str]:
    """`(direction, source)` por prioridad.

    * `camera` entry/exit: manda siempre (la camara solo ve un sentido).
    * `unknown` (sin configuracion) no adivina nada... salvo que haya una linea
      configurada: entonces es una decision explicita del operador y `line` /
      `motion` aplican. La tendencia del ancho solo se usa con `both`
      (comportamiento previo).
    """
    if camera_direction in (DIRECTION_ENTRY, DIRECTION_EXIT):
        return camera_direction, SOURCE_CAMERA
    if line is not None and frame_size is not None and points:
        w, h = frame_size
        crossed = detect_line_crossing(points, line, w, h)
        if crossed:
            return crossed, SOURCE_LINE
        moved = motion_direction(points, line, w, h)
        if moved:
            return moved, SOURCE_MOTION
    if camera_direction == DIRECTION_BOTH and width_direction in (DIRECTION_ENTRY, DIRECTION_EXIT):
        return width_direction, SOURCE_WIDTH
    return DIRECTION_UNKNOWN, SOURCE_NONE
