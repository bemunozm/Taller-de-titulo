"""Worker del Guardián: captura RTSP -> `GuardianPipeline` -> envío al backend.

Las decisiones (movimiento, YOLO, intrusión/merodeo, cooldowns, re-enlace de
tracks) viven en `guardian_pipeline.py` y `guardian_rules.py`, que comparte con
`lpr/tools/guardian_replay.py`. Aquí queda solo lo que toca el mundo:

* captura con reconexión y detección de stream congelado;
* zonas del backend en un hilo daemon de fondo (la captura NUNCA espera al GET);
* armado y POST de la anomalía (sin escribir nada a disco: Ley 21.719);
* heartbeat con métricas de rendimiento.
"""
import concurrent.futures
import logging
import sys
import threading
import time
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
import requests  # noqa: F401  (los tests parchean `guardian_worker.requests.get`)

from lpr.api.client import consumes_dedupe, fetch_camera_json, post_anomaly
from lpr.processor.guardian_pipeline import (
    DEFAULT_IMGSZ,
    GuardianPipeline,
    MotionGate,
    effective_device,
    load_model,
)
from lpr.processor.guardian_rules import (
    AnomalyDecision,
    GuardianConfig,
    GuardianRules,
    max_gap_for_poll_interval,
    parse_guardian_zones,
)
from lpr.settings import settings
from lpr.utils.capture import reconnect_capture
from lpr.utils.images import frame_to_pil, pil_to_base64

HEARTBEAT_SECONDS = 30.0
FIRST_ZONES_FETCH_TIMEOUT = 3.0
# Refetch de zonas: nunca más seguido que esto (aunque la config diga menos).
MIN_ZONES_REFETCH_SECONDS = 5.0
# Tras un fallo el hilo reintenta a 2, 4, 8 s... hasta el intervalo normal.
ZONES_BACKOFF_BASE_SECONDS = 2.0


class GuardianWorker:
    def __init__(self, cfg, model: Any = None, model_path: Optional[Path] = None,
                 rules: Optional[GuardianRules] = None, start_zones_thread: bool = True):
        self.cfg = cfg
        if model is None:
            try:
                # Modelo LOCAL (`lpr/yolo11n.pt`), sin descarga en runtime.
                model = load_model(model_path)
            except FileNotFoundError as exc:
                logging.error(
                    'Modelo del Guardián no encontrado (%s): no se descarga nada en runtime. '
                    'Copia yolo11n.pt a lpr/. Terminando para que el supervisor reintente.', exc)
                sys.exit(1)
        self.model = model
        self.rules = rules or GuardianRules(GuardianConfig(
            max_gap_seconds=max_gap_for_poll_interval(getattr(self.cfg, 'poll_interval', None))))
        self.pipeline = GuardianPipeline(
            model=self.model, rules=self.rules, gate=MotionGate(),
            device=getattr(self.cfg, 'device', None), imgsz=DEFAULT_IMGSZ)

        max_workers = int(settings.LPR_MAX_WORKERS)
        try:
            self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        except Exception:
            self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self.processing_future = None

        # Métricas del heartbeat. La captura y el hilo de proceso las tocan a la vez.
        self._stats_lock = threading.Lock()
        self.last_heartbeat = time.time()
        self._reads = 0
        self._inferences = 0
        self._inference_ms = 0.0

        # Si el backend deshabilita el Guardián para esta cámara, se respeta.
        # Por defecto habilitado (fail-safe: ante un fetch fallido preferimos
        # vigilar de más que apagar la seguridad en silencio).
        self.guardian_enabled = True
        self.zones_last_fetched = 0.0
        self._zones_ok = False
        self._stop_zones = threading.Event()
        self._zones_thread: Optional[threading.Thread] = None
        self._start_zones_thread = start_zones_thread
        # Primera carga síncrona pero con timeout corto: arrancar con las zonas
        # correctas sin atascar el inicio si el backend no responde.
        self._fetch_zones(timeout=FIRST_ZONES_FETCH_TIMEOUT)

    # ------------------------------------------------------------------
    # Zonas (hilo de fondo)
    # ------------------------------------------------------------------
    @property
    def guardian_zones(self):
        """Zonas vigentes (tipadas), para inspección y tests."""
        return self.rules.zones

    def _fetch_zones(self, timeout: float = 5.0) -> bool:
        """Un intento de carga. Devuelve True si el backend entregó zonas válidas."""
        ok = False
        try:
            # Fase 4 · P5.B/P5.C: la ruta exige la API key de servicio
            # (ServiceApiKeyGuard, acotada al condominio de la key); el helper
            # manda `service_headers`. Sin el header respondía 401 y el Guardián
            # corría SIN zonas (todo el cuadro).
            data = fetch_camera_json(
                self.cfg.backend_url, f"/anomalies/cameras/{self.cfg.camera_id}/zones", timeout=timeout,
            )
            if data is None:
                # El helper ya logueó el motivo (4xx/5xx/red/cuerpo inválido).
                logging.warning(
                    'GET de zonas del Guardián para %s falló: se mantienen las zonas anteriores',
                    self.cfg.camera_id,
                )
            else:
                self._apply_zones(data)
                ok = True
        except Exception as e:
            logging.error('Error obteniendo zonas del Guardián: %s', e)
        finally:
            # Marcar el intento SIEMPRE (éxito o fallo) para que el refetch
            # respete `LPR_ZONES_REFETCH_SECONDS`.
            self.zones_last_fetched = time.time()
            self._zones_ok = ok
        return ok

    def _apply_zones(self, data: dict) -> None:
        """Reemplaza zonas y toggle de una vez (el parseo ocurre ANTES de tocar
        el estado, así el hilo de frames nunca ve zonas a medias)."""
        enabled = data.get('enableGuardian') is not False  # solo un `false` explícito deshabilita
        zones = parse_guardian_zones(data.get('guardianZones', []))
        changed = self.rules.set_zones(zones)
        if enabled != self.guardian_enabled:
            self.guardian_enabled = enabled
            if not enabled:
                logging.warning('Guardián deshabilitado en BD para %s — no se procesarán frames.',
                                self.cfg.camera_id)
        if changed:
            logging.info('Zonas del Guardián de %s actualizadas: %d (intrusión=%d, merodeo=%d)',
                         self.cfg.camera_id, len(zones),
                         sum(1 for z in zones if z.type == 'intrusion'),
                         sum(1 for z in zones if z.type == 'loitering'))

    @staticmethod
    def _refetch_interval() -> float:
        return max(MIN_ZONES_REFETCH_SECONDS, float(settings.LPR_ZONES_REFETCH_SECONDS))

    @staticmethod
    def _zones_delay(refetch_seconds: float, failures: int) -> float:
        """Espera hasta el próximo intento: normal si todo va bien; con fallos,
        backoff corto (2, 4, 8 s...) acotado por el intervalo normal."""
        if failures <= 0:
            return refetch_seconds
        return min(refetch_seconds, ZONES_BACKOFF_BASE_SECONDS * (2 ** (failures - 1)))

    def _zones_loop(self, refetch_seconds: float) -> None:
        # Si la primera carga (síncrona, en __init__) falló, se arranca ya en backoff:
        # un backend que levanta después no deja al Guardián sin zonas minutos.
        failures = 0 if self._zones_ok else 1
        while not self._stop_zones.wait(self._zones_delay(refetch_seconds, failures)):
            failures = 0 if self._fetch_zones() else failures + 1

    def _ensure_zones_thread(self) -> None:
        if not self._start_zones_thread or self._zones_thread is not None:
            return
        refetch = self._refetch_interval()
        self._zones_thread = threading.Thread(
            target=self._zones_loop, args=(refetch,), name='guardian-zones', daemon=True)
        self._zones_thread.start()

    # ------------------------------------------------------------------
    # Captura
    # ------------------------------------------------------------------
    def start_capture_loop(self, cap):
        last_frame_ts = 0
        last_successful_read_ts = time.time()
        last_frame_sig = None
        consecutive_failures = 0
        max_failures = int(settings.LPR_STREAM_MAX_READ_FAILURES)
        stale_seconds = float(settings.LPR_STREAM_STALE_SECONDS)
        self._ensure_zones_thread()
        try:
            while True:
                ret, frame = cap.read()
                now = time.time()
                if not ret:
                    consecutive_failures += 1
                    logging.warning('Frame no recibido (%d/%d) - reconectando...', consecutive_failures, max_failures)
                    if consecutive_failures >= max_failures:
                        cap = reconnect_capture(self.cfg.rtsp_url, cap)
                        if cap is None:
                            logging.error(
                                'No se pudo reconectar el stream RTSP tras varios intentos; '
                                'terminando proceso para que el supervisor lo reinicie limpio'
                            )
                            sys.exit(1)
                        consecutive_failures = 0
                        last_frame_sig = None
                        last_successful_read_ts = time.time()
                    time.sleep(1)
                    continue
                consecutive_failures = 0
                with self._stats_lock:
                    self._reads += 1
                # Stream CONGELADO: ret=True con el mismo frame en buffer. Firma
                # barata (muestra dispersa); solo un frame NUEVO refresca stale.
                try:
                    sig = frame[::32, ::32].tobytes()
                except Exception:
                    sig = None
                if sig is None or sig != last_frame_sig:
                    last_frame_sig = sig
                    last_successful_read_ts = now
                elif (now - last_successful_read_ts) > stale_seconds:
                    logging.warning('Stream congelado (%.0fs sin frames nuevos) - reconectando...',
                                    now - last_successful_read_ts)
                    cap = reconnect_capture(self.cfg.rtsp_url, cap)
                    if cap is None:
                        logging.error('No se pudo reconectar el stream congelado; terminando proceso '
                                      'para que el supervisor lo reinicie limpio')
                        sys.exit(1)
                    last_frame_sig = None
                    last_successful_read_ts = time.time()
                    continue

                self._maybe_heartbeat(now)

                # Un FPS bajo es suficiente para tracking de personas/merodeo (ej: 2 a 5 FPS)
                if now - last_frame_ts < self.cfg.poll_interval:
                    time.sleep(0.005)
                    continue
                last_frame_ts = now

                self.submit_frame(frame)
        finally:
            self._stop_zones.set()
            try:
                self.executor.shutdown(wait=False)
            except Exception:
                pass

    def _maybe_heartbeat(self, now: float) -> None:
        elapsed = now - self.last_heartbeat
        if elapsed <= HEARTBEAT_SECONDS:
            return
        with self._stats_lock:
            reads, inferences, total_ms = self._reads, self._inferences, self._inference_ms
            self._reads = self._inferences = 0
            self._inference_ms = 0.0
        self.last_heartbeat = now
        avg_ms = total_ms / inferences if inferences else 0.0
        logging.info(
            '[HEARTBEAT] %s - captura %.2f fps, inferencias %.2f/s (%.1f ms promedio), device=%s, '
            'tracks activos=%d, zonas=%d, habilitado=%s',
            self.cfg.camera_id, reads / elapsed, inferences / elapsed, avg_ms,
            effective_device(self.model, getattr(self.cfg, 'device', None)),
            self.rules.active_tracks, len(self.rules.zones), self.guardian_enabled)

    # ------------------------------------------------------------------
    # Proceso de frames
    # ------------------------------------------------------------------
    def _on_frame_done(self, fut):
        """Hace visible cualquier excepción del pipeline (ver LprWorker)."""
        try:
            fut.result()
        except Exception:
            logging.exception('Error procesando frame en el Guardián')

    def submit_frame(self, frame: np.ndarray):
        # descartar el frame si el executor sigue ocupado con el anterior
        if self.processing_future is not None and not self.processing_future.done():
            return
        fut = self.executor.submit(self._process_frame, frame)
        fut.add_done_callback(self._on_frame_done)
        self.processing_future = fut

    def _process_frame(self, frame: np.ndarray):
        # Respetar el toggle del backend: si el Guardián está deshabilitado
        # para esta cámara, no se procesa nada.
        if not self.guardian_enabled:
            return
        result = self.pipeline.process(frame, time.monotonic())
        if result.ran_inference:
            with self._stats_lock:
                self._inferences += 1
                self._inference_ms += result.inference_ms
            logging.debug('[GUARDIAN] %s personas=%d (%.1f ms, movimiento=%s, retención=%s)',
                          self.cfg.camera_id, result.people, result.inference_ms,
                          result.motion, result.retained)
        for decision in result.decisions:
            self._trigger_anomaly(frame, decision)

    def _trigger_anomaly(self, frame: np.ndarray, decision: AnomalyDecision):
        h, w = frame.shape[:2]
        x1, y1, x2, y2 = decision.bbox
        x1c, y1c, x2c, y2c = max(0, int(x1)), max(0, int(y1)), min(w - 1, int(x2)), min(h - 1, int(y2))
        anomaly_type = decision.type

        # Contexto visual: el frame completo con la caja dibujada, para que la IA
        # vea el entorno. Solo en memoria: nada se escribe a disco.
        snapshot_b64 = None
        if getattr(self.cfg, 'include_snapshot', True):
            try:
                annotated = frame.copy()
                cv2.rectangle(annotated, (x1c, y1c), (x2c, y2c), (0, 0, 255), 3)
                label = f'P-{decision.track_id} {anomaly_type} ({int(decision.duration_seconds)}s)'
                cv2.putText(annotated, label, (x1c, max(20, y1c - 10)), cv2.FONT_HERSHEY_SIMPLEX,
                            0.8, (0, 0, 255), 2)
                snapshot_b64 = pil_to_base64(frame_to_pil(annotated), quality=70)
            except Exception:
                logging.exception('Error anotando/convirtiendo el frame de la anomalía; se envía el recorte')
                try:
                    snapshot_b64 = pil_to_base64(frame_to_pil(frame[y1c:y2c, x1c:x2c]))
                except Exception:
                    logging.exception('Error convirtiendo el recorte a B64')

        meta = {
            'bbox': [x1c, y1c, x2c, y2c],
            'snapshot_jpeg_b64': snapshot_b64,
            'anomaly_type': anomaly_type,
            'duration_seconds': int(decision.duration_seconds),
            'track_id': decision.track_id,
        }

        # El ID puede venir con sufijo '_guardia' si es administrado por el manager.
        # Lo limpiamos para que el backend asocie bien la cámara.
        clean_camera_id = self.cfg.camera_id.replace('_guardia', '')

        payload = {
            'cameraId': clean_camera_id,
            'anomalyType': anomaly_type,
            'confidence': decision.conf,
            'meta': meta,
            # NO se envía la URL RTSP (credenciales de la cámara); el backend
            # identifica la cámara por `cameraId`.
            'detectionTimestamp': int(time.time() * 1000),
        }

        logging.info('[VIGILIA-IA] REPORTANDO ANOMALIA: %s en %s (Real: %s). Tracker ID: %s zona=%s',
                     anomaly_type, self.cfg.camera_id, clean_camera_id, decision.track_id, decision.zone_index)
        status = post_anomaly(self.cfg.backend_url, payload, dry_run=self.cfg.dry_run)
        if not consumes_dedupe(status):
            # El aviso NO llegó (backend caído, 4xx/5xx): sin esto el cooldown se
            # "gastaba" igual y la alerta se perdía. Se olvida para re-alertar.
            # STATUS_MAYBE_SENT sí consume el cooldown (reintentar duplicaría).
            self.rules.forget_emission(decision)
            logging.warning('Anomalía %s de %s no entregada (estado %s): se reintentará en el próximo frame',
                            anomaly_type, self.cfg.camera_id, status)
