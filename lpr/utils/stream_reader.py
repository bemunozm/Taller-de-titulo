"""Lector RTSP del modo reposo (PyAV), SOLO para el LPR.

Un `StreamReader` por stream:

- un hilo DEMUXA paquetes comprimidos sin decodificar y los deja en un `PacketRing`
  (para el HD cuesta una fraccion de decodificar); maneja timeouts, reconexion con
  reintentos acotados y marca `failed` cuando se rinde (el worker termina con
  `sys.exit(1)` para que el supervisor lo reinicie, igual que con `capture.py`);
- el consumidor llama `next_frames()` para decodificar: `activate()` empieza desde el
  ULTIMO keyframe del anillo (el inicio del paso no se pierde) y sigue en vivo;
  `deactivate()` deja de decodificar pero el demux sigue.

Los tiempos de cada cuadro se devuelven mapeados al reloj de pared (`time.time()`
mas un offset estable estimado con los primeros paquetes), asi que un cuadro del
anillo conserva su hora real y se muestrea por TIMESTAMP, no por cuando se decodifico.

`av` se importa recien al abrir la sesion real: la logica se prueba con una sesion
falsa (`session_factory`), sin PyAV.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Iterator, List, Optional, Protocol

from lpr.utils.rest_mode import PacketRing, RingItem, RingOverrun

# Si el offset reloj-de-pared <-> reloj del stream se aleja mas que esto, se recalcula.
MAX_CLOCK_DRIFT_SECONDS = 10.0
# Paquetes que debe entregar una sesion para considerarla sana (reinicia el conteo de fallos).
HEALTHY_PACKETS = 25


@dataclass(frozen=True)
class RawPacket:
    ts: Optional[float]   # segundos del stream (pts); None si el contenedor no lo trae
    key: bool
    size: int
    payload: Any


@dataclass
class DecodedFrame:
    ts: Optional[float]   # segundos del stream
    image: Callable[[], Any]   # conversion perezosa a BGR (solo se paga para los cuadros que se usan)


class StreamSession(Protocol):
    def packets(self) -> Iterator[RawPacket]: ...
    def decode(self, payload: Any) -> List[DecodedFrame]: ...
    def flush(self) -> None: ...
    def close(self) -> None: ...


class _Slot:
    """Una sesion + el lock que serializa decode/flush/close sobre ella (H1): cerrar
    un contenedor PyAV mientras otro hilo decodifica es un use-after-free."""

    def __init__(self, session: 'StreamSession') -> None:
        self.session = session
        self.lock = threading.Lock()
        self.closed = False

    def close(self) -> None:
        with self.lock:
            if not self.closed:
                self.closed = True
                self.session.close()


@dataclass
class Frame:
    ts: float             # hora de pared estimada del cuadro
    activation: int       # numero de activacion que lo pidio
    catchup: bool         # vino del anillo (previo a la activacion), no en vivo
    _image: Callable[[], Any]

    def bgr(self) -> Any:
        return self._image()


class AvSession:
    """Sesion real sobre PyAV. TCP, timeouts de apertura/lectura de `settings`."""

    def __init__(self, url: str, open_timeout_s: float, read_timeout_s: float, decode_threads: int = 0) -> None:
        import av  # perezoso: CI y los tests no lo tienen

        self._av = av
        self.container = av.open(url, mode='r', options={'rtsp_transport': 'tcp'},
                                 timeout=(open_timeout_s, read_timeout_s))
        streams = self.container.streams.video
        if not streams:
            self.container.close()
            raise RuntimeError('el stream no tiene video')
        self.stream = streams[0]
        ctx = self.stream.codec_context
        if decode_threads > 0:
            ctx.thread_count = decode_threads
        else:
            ctx.thread_type = 'AUTO'
        self._time_base = float(self.stream.time_base) if self.stream.time_base else None

    def packets(self) -> Iterator[RawPacket]:
        for pkt in self.container.demux(self.stream):
            if pkt.size == 0 or pkt.dts is None and pkt.pts is None:
                continue  # paquete de vaciado del final
            stamp = pkt.pts if pkt.pts is not None else pkt.dts
            tb = float(pkt.time_base) if pkt.time_base else self._time_base
            ts = None if tb is None else float(stamp) * tb
            yield RawPacket(ts, bool(pkt.is_keyframe), int(pkt.size), pkt)

    def decode(self, payload: Any) -> List[DecodedFrame]:
        out: List[DecodedFrame] = []
        for frame in payload.decode():
            out.append(DecodedFrame(frame.time, lambda f=frame: f.to_ndarray(format='bgr24')))
        return out

    def flush(self) -> None:
        try:
            self.stream.codec_context.flush_buffers()
        except Exception:
            logging.debug('flush_buffers fallo', exc_info=True)

    def close(self) -> None:
        try:
            self.container.close()
        except Exception:
            pass


def av_available() -> bool:
    """True si PyAV es importable (sin importarlo)."""
    import importlib.util
    try:
        return importlib.util.find_spec('av') is not None
    except (ImportError, ValueError):
        return False


class StreamReader:
    def __init__(
        self,
        name: str,
        url: str,
        *,
        ring_seconds: float = 5.0,
        ring_bytes: int = 48 * 1024 * 1024,
        open_timeout_s: float = 10.0,
        read_timeout_s: float = 8.0,
        max_attempts: int = 5,
        backoff_seconds: float = 2.0,
        decode_threads: int = 0,
        session_factory: Optional[Callable[[], StreamSession]] = None,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.name = name
        self._url = url  # lleva credenciales: nunca se loguea
        self.ring = PacketRing(ring_seconds, ring_bytes)
        self._max_attempts = max(1, int(max_attempts))
        self._join_timeout = float(read_timeout_s) + 2.0
        self._backoff = float(backoff_seconds)
        self._clock = clock
        self._sleep = sleep
        self._factory = session_factory or (lambda: AvSession(url, open_timeout_s, read_timeout_s, decode_threads))
        self._slot: Optional[_Slot] = None
        self.opened = threading.Event()   # primera apertura exitosa
        self._offset: Optional[float] = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.failed = False
        self.reconnects = 0
        self._force_reconnect = False
        self.last_packet_wall = clock()
        # lado decodificador
        self._active = False
        self._activation = 0
        self._activation_head = 0
        self._cursor: Optional[int] = None
        self._skip_until_key_after = -1
        self._dec_generation = -1
        self.decode_errors = 0
        self.overruns = 0

    # -- ciclo de vida ------------------------------------------------------
    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name=f'lpr-demux-{self.name}', daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self.ring.close()
        # La sesion la cierra SU hilo (`_run`): cerrar un contenedor PyAV desde otro hilo
        # mientras `demux` lee es un use-after-free (segfault). El hilo ve `_stop` en el
        # proximo paquete (ms en un stream vivo) o al vencer el timeout de lectura.
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=self._join_timeout)

    def wait_first_packet(self, timeout: float) -> bool:
        """True cuando el stream abrio y entrego su primer paquete; False si la primera
        apertura fallo (`failed`) o vencio `timeout`. El worker lo usa para decidir si
        el modo reposo puede arrancar o hay que volver al bucle normal (H3)."""
        deadline = time.monotonic() + max(0.0, timeout)
        while time.monotonic() < deadline:
            if self.failed or self._stop.is_set():
                return False
            if self.ring.next_seq > 0:
                return True
            time.sleep(0.02)
        return False

    def request_reconnect(self) -> None:
        """El consumidor detecto un stream congelado (imagen sin cambios)."""
        self._force_reconnect = True

    # -- demux --------------------------------------------------------------
    def _open(self) -> Optional[StreamSession]:
        for attempt in range(1, self._max_attempts + 1):
            if self._stop.is_set():
                return None
            try:
                return self._factory()
            except Exception as exc:
                logging.warning('[%s] no se pudo abrir el stream (intento %d/%d): %s', self.name, attempt,
                                self._max_attempts, type(exc).__name__)
            if attempt < self._max_attempts:
                self._sleep(min(self._backoff * (2 ** (attempt - 1)), 30.0))
        return None

    def _map_ts(self, stream_ts: Optional[float], arrival: float) -> float:
        if stream_ts is None:
            return arrival
        candidate = arrival - stream_ts
        if self._offset is None or candidate < self._offset:
            self._offset = candidate  # nunca adelantado respecto de la llegada
        elif candidate - self._offset > MAX_CLOCK_DRIFT_SECONDS:
            logging.info('[%s] el reloj del stream se desfaso %.0fs: se recalcula el offset', self.name,
                         candidate - self._offset)
            self._offset = candidate
        return stream_ts + self._offset

    def _run(self) -> None:
        failures = 0
        while not self._stop.is_set():
            session = self._open()
            if session is None:
                if not self._stop.is_set():
                    logging.error('[%s] no se pudo abrir el stream tras %d intentos', self.name, self._max_attempts)
                    self.failed = True
                return
            slot = _Slot(session)
            with self._lock:
                self._slot = slot
                self._offset = None
                self.ring.clear()
            self.opened.set()
            delivered = 0
            self._force_reconnect = False
            try:
                for pkt in session.packets():
                    if self._stop.is_set() or self._force_reconnect:
                        break
                    arrival = self._clock()
                    self.last_packet_wall = arrival
                    if pkt.size <= 0:
                        continue
                    self.ring.append(self._map_ts(pkt.ts, arrival), pkt.key, pkt.size, pkt.payload)
                    delivered += 1
                    if delivered == HEALTHY_PACKETS:
                        failures = 0
            except Exception as exc:
                if not self._stop.is_set():
                    logging.warning('[%s] error leyendo el stream: %s', self.name, type(exc).__name__)
            finally:
                slot.close()   # espera a un decode en curso sobre esta sesion
            if self._stop.is_set():
                return
            failures += 1
            self.reconnects += 1
            if failures >= self._max_attempts:
                logging.error('[%s] el stream cae al reabrir (%d fallos seguidos)', self.name, failures)
                self.failed = True
                return
            logging.warning('[%s] stream cortado - reconectando (%d/%d)', self.name, failures, self._max_attempts)
            self._sleep(min(self._backoff * (2 ** (failures - 1)), 30.0))

    # -- decodificacion -----------------------------------------------------
    @property
    def active(self) -> bool:
        return self._active

    @property
    def activation(self) -> int:
        return self._activation

    def activate(self) -> int:
        """Empieza a decodificar desde el ultimo keyframe del anillo. Idempotente."""
        with self._lock:
            if self._active:
                return self._activation
            self._activation += 1
            self._cursor = None            # se fija en el proximo next_frames (ultimo keyframe)
            self._activation_head = self.ring.next_seq
            self._active = True
            return self._activation

    def deactivate(self) -> None:
        with self._lock:
            self._active = False
            self._cursor = None

    def _resync(self, timeout: float) -> bool:
        """Posiciona el cursor en el ultimo keyframe y reinicia el decoder."""
        key = self.ring.wait_key_after(self._skip_until_key_after, timeout)
        if key is None:
            return False
        with self._lock:
            slot = self._slot
            generation = self.ring.generation
            activation = self._activation
        if slot is None:
            return False
        with slot.lock:
            if slot.closed:
                return False
            try:
                slot.session.flush()
            except Exception:
                logging.debug('[%s] flush del decoder fallo', self.name, exc_info=True)
        with self._lock:
            if (not self._active or self._activation != activation
                    or generation != self.ring.generation or self._slot is not slot):
                return False   # H9: cambio de activacion/generacion mientras tanto
            self._cursor = key
            self._dec_generation = generation
        return True

    def next_frames(self, timeout: float = 0.5) -> List[Frame]:
        """Decodifica el siguiente paquete si esta activo. Devuelve los cuadros
        resultantes ([] si no hay nada, esta inactivo o el timeout vencio)."""
        if not self._active:
            self._stop.wait(min(timeout, 0.2))
            return []
        generation = self.ring.generation
        with self._lock:
            cursor, dec_generation = self._cursor, self._dec_generation
        if cursor is None or generation != dec_generation:
            if not self._resync(timeout):
                return []
            with self._lock:
                cursor = self._cursor
        if cursor is None:
            return []
        try:
            item = self.ring.wait_get(cursor, timeout)
        except RingOverrun:
            self.overruns += 1
            logging.warning('[%s] el consumidor se atraso y el anillo descarto paquetes: se resincroniza '
                            'en el ultimo keyframe', self.name)
            with self._lock:
                self._cursor = None
                self._skip_until_key_after = -1
            return []
        if item is None:
            return []
        return self._decode_item(item, generation)

    def _decode_item(self, item: RingItem, generation: int) -> List[Frame]:
        with self._lock:
            slot = self._slot
            activation = self._activation
            head = self._activation_head
        if slot is None or generation != self.ring.generation:
            with self._lock:
                self._cursor = None
            return []
        catchup = item.seq < head
        error: Optional[Exception] = None
        decoded: List[DecodedFrame] = []
        with slot.lock:
            if slot.closed:
                error = None
                decoded = []
            else:
                try:
                    decoded = slot.session.decode(item.payload)
                except Exception as exc:
                    error = exc
        with self._lock:
            # H9: solo se escribe el cursor si nada cambio mientras se decodificaba
            same = (self._active and self._activation == activation and self._slot is slot
                    and generation == self.ring.generation and self._dec_generation == generation)
            if not same:
                return []
            if error is not None:
                self.decode_errors += 1
                self._skip_until_key_after = item.seq
                self._cursor = None
            else:
                self._cursor = item.seq + 1
            offset = self._offset
        if error is not None:
            logging.warning('[%s] error decodificando (%s): se espera el proximo keyframe', self.name,
                            type(error).__name__)
            return []
        out: List[Frame] = []
        for fr in decoded:
            ts = item.ts if fr.ts is None or offset is None else fr.ts + offset
            out.append(Frame(ts, activation, catchup, fr.image))
        return out
