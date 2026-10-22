import logging
import signal
import time
import os
import re
import sys
import json
import cv2
from typing import Optional
import concurrent.futures
import threading
import numpy as np
from pathlib import Path

from lpr.detector.yolo_detector import Detection
from lpr.utils.images import frame_to_pil, pil_to_base64
from lpr.utils.capture import reconnect_capture
from lpr.ocr.fast_ocr_adapter import FastPlateOCR
from lpr.processor.pipeline import STATUS_SHAPE_REJECTED, make_tracker, process_frame, wants_vehicle_tracking
from lpr.processor.plate_tracker import PlateEmission
from lpr.processor.vehicle_tracker import VehicleTracker
from lpr.storage.fs_storage import save_image_pil
from lpr.api.client import consumes_dedupe, fetch_camera_json, is_success, post_event
from lpr.processor.rules import analyze_char_confidences
from lpr.settings import apply_camera_settings, settings
from lpr.utils.pii import mask_plate
from lpr.utils.sampling import FrameScheduler
from lpr.utils.throughput import ThroughputMeter, format_report


# Campos de la config por cámara que se resumen en el log cuando cambian
# (nunca rtsp_url ni backend_url: llevan credenciales).
_LOGGED_CONFIG_FIELDS = (
    'action', 'direction', 'detector_imgsz', 'sample_fps', 'confirm_reads',
    'track_max_gap_seconds', 'min_crop_w', 'max_crop_w', 'min_crop_ratio', 'max_crop_ratio',
    'detection_blocked', 'direction_line', 'plate_rotation_deg',
)
# Cambios que obligan a rehacer el `PlateTracker` (el resto de la config se lee por frame).
# `direction_line` NO está: el voto no depende de la línea; `process_frame` se la pasa
# al tracker por frame y este (y el VehicleTracker) descartan solo las trayectorias.
# `sample_fps` tampoco: no rehace el PlateTracker, solo reconfigura el `VehicleTracker`
# (`_ensure_vehicle_tracker`: mismo modelo, `track_buffer` nuevo). Rehacer el PlateTracker
# descarta sus pistas, también las confirmadas que esperaban dirección o asentamiento.
_TRACKER_FIELDS = ('confirm_reads', 'direction', 'track_max_gap_seconds')


class LprWorker:
    def __init__(self, cfg, detector, fast_ocr: Optional[FastPlateOCR]):
        # `base_cfg` es la config del env, INMUTABLE: `apply_camera_settings`
        # siempre fusiona sobre ella (no sobre la ya fusionada) para que una
        # clave que el backend deja de mandar vuelva al default del env.
        self.base_cfg = cfg
        self.cfg = cfg
        self.detector = detector
        self.fast_ocr = fast_ocr
        # seguimiento + voto por vehículo (reemplaza a `plate_sightings`)
        self.tracker = make_tracker(cfg)
        # Seguimiento de vehículos (ByteTrack) para el voto por vehículo y la dirección
        # por línea: UNA instancia por worker (el estado `persist` vive en el modelo),
        # creada perezosamente (con o sin línea). Si el modelo no carga queda
        # `available=False`: sin voto por vehículo y la dirección cae a los respaldos.
        self.vehicle_tracker: Optional[VehicleTracker] = None
        # Ultimo cuadro procesado: la imagen de evidencia de una emision que se
        # libera al detener el worker (`flush_pending`).
        self._last_frame: Optional[np.ndarray] = None
        # `cfg` y `tracker` se publican juntos bajo este lock: el frame en curso
        # toma una foto consistente de ambos y el refetch nunca deja a medias.
        self._runtime_lock = threading.Lock()
        self._enable_lpr: Optional[bool] = None
        self._settings_stop = threading.Event()
        self._settings_thread: Optional[threading.Thread] = None
        self.emitted_cache = {}
        # executor para procesar frames asincrónicamente y future de control
        max_workers = int(settings.LPR_MAX_WORKERS)
        try:
            self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        except Exception:
            # fallback a un executor simple si ocurre algo
            self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self.processing_future = None
        # Telemetría de fps efectivos (contadores baratos; un log cada 60 s).
        self._throughput = ThroughputMeter()
        # directorio donde se guardan las detecciones completas (frames anotados)
        # usar la ruta ya normalizada por cfg (config.py se encarga de resolver relativas)
        self.detections_dir = getattr(self.cfg, 'detections_dir', 'detecciones')

        try:
            os.makedirs(self.detections_dir, exist_ok=True)
        except Exception:
            logging.exception('No se pudo crear detections_dir %s', self.detections_dir)
        logging.info('LPR detections_dir set to %s', self.detections_dir)

    # ------------------------------------------------------------------
    # Config por cámara (lprSettings) con refetch en caliente
    # ------------------------------------------------------------------
    def _settings_path(self) -> str:
        # El LPR usa el id REAL de la cámara (el Guardián usa `<id>_guardia`).
        # `camera_id` pasó por el saneado de `build_worker_config`, que no altera
        # un UUID legítimo; el manager ya valida el id con `_CAMERA_ID_RE`.
        return f'/workers/cameras/{self.cfg.camera_id}/lpr-settings'

    def refresh_camera_settings(self) -> bool:
        """Un ciclo de pull: pide `lprSettings`, los fusiona sobre la base y
        publica la config nueva. Devuelve True si hubo respuesta válida.

        Ante cualquier fallo (red, 4xx/5xx, cuerpo inválido) CONSERVA la última
        config válida: nunca se cae a "sin zona" por un error transitorio. Si
        nunca hubo una, sigue vigente la base del env.
        """
        data = fetch_camera_json(self.base_cfg.backend_url, self._settings_path(), timeout=5)
        if data is None:
            logging.warning('No se pudo obtener lprSettings de %s: se conserva la config vigente',
                            self.base_cfg.camera_id)
            return False
        enable_lpr = data.get('enableLpr')
        if enable_lpr is False and self._enable_lpr is not False:
            # El manager NO detiene workers por cambios de BD (solo reconcilia al
            # arrancar); acá solo se deja constancia, no se auto-mata el proceso.
            logging.warning('El backend marca enableLpr=false para %s; el worker sigue activo '
                            'hasta que el manager lo detenga', self.base_cfg.camera_id)
        self._enable_lpr = enable_lpr if isinstance(enable_lpr, bool) else self._enable_lpr
        raw = data.get('lprSettings')
        # `previous=self.cfg`: una zona rota conserva la última válida (o, si nunca
        # hubo una, la cámara no detecta: fail-closed), nunca se ensancha al cuadro.
        new_cfg = apply_camera_settings(self.base_cfg, raw if isinstance(raw, dict) else None,
                                        previous=self.cfg)
        self._publish_config(new_cfg)
        return True

    def _publish_config(self, new_cfg) -> None:
        """Reemplazo atómico de `cfg` (y del tracker, solo si hace falta)."""
        old_cfg = self.cfg
        changed = [f for f in _LOGGED_CONFIG_FIELDS
                   if getattr(old_cfg, f, None) != getattr(new_cfg, f, None)]
        zone_changed = getattr(old_cfg, 'zone', None) != getattr(new_cfg, 'zone', None)
        if not changed and not zone_changed:
            return
        rebuild_tracker = any(getattr(old_cfg, f, None) != getattr(new_cfg, f, None)
                              for f in _TRACKER_FIELDS)
        new_tracker = make_tracker(new_cfg) if rebuild_tracker else None
        with self._runtime_lock:
            self.cfg = new_cfg
            if new_tracker is not None:
                self.tracker = new_tracker
        summary = {f: getattr(new_cfg, f, None) for f in changed}
        if zone_changed:
            summary['zone_polygons'] = len(new_cfg.zone or [])
        logging.info('Config por cámara actualizada para %s: %s%s', new_cfg.camera_id, summary,
                     ' (tracker reiniciado)' if rebuild_tracker else '')

    def start_settings_sync(self, interval: Optional[float] = None) -> None:
        """Pull inicial (síncrono, antes de abrir la captura) y refetch periódico
        en un hilo demonio que no bloquea el bucle de captura. Reusa
        `LPR_ZONES_REFETCH_SECONDS` como cadencia."""
        if self._settings_thread is not None:
            return
        period = float(interval if interval is not None else settings.LPR_ZONES_REFETCH_SECONDS)
        try:
            self.refresh_camera_settings()
        except Exception:
            logging.exception('Error inesperado obteniendo lprSettings al arrancar')

        def _loop():
            while not self._settings_stop.wait(period):
                try:
                    self.refresh_camera_settings()
                except Exception:
                    logging.exception('Error inesperado refrescando lprSettings')

        self._settings_thread = threading.Thread(target=_loop, name='lpr-settings-sync', daemon=True)
        self._settings_thread.start()

    def flush_pending(self) -> int:
        """Emite las patentes ya CONFIRMADAS que esperaban su direccion. Al detener
        el worker no hay mas cuadros que las cierren: sin esto se perderian.
        Devuelve cuantas emitio."""
        future = self.processing_future
        if future is not None:
            try:
                future.result(timeout=10)  # que termine el cuadro en curso
            except Exception:
                logging.exception('El cuadro en curso fallo antes de liberar los pendientes')
        with self._runtime_lock:
            tracker = self.tracker
        pending = tracker.flush()
        frame = self._last_frame
        if pending and frame is None:
            logging.warning('Hay %d patentes pendientes pero ningun cuadro de evidencia', len(pending))
            return 0
        for emission in pending:
            try:
                self._handle_emission(frame, emission, time.time())
            except Exception:
                logging.exception('No se pudo emitir una patente pendiente al detener')
        return len(pending)

    def start_capture_loop(self, cap):
        # SIGTERM (supervisor/manager) normalmente mata el proceso sin ejecutar
        # `finally`; se convierte en SystemExit para poder liberar los pendientes.
        try:
            signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
        except (ValueError, OSError):  # fuera del hilo principal
            pass
        self.start_settings_sync()
        scheduler = FrameScheduler(1.0)  # el intervalo real se pasa en cada due()
        # Trackea la última lectura EXITOSA del stream (independiente del
        # throttle de poll_interval de abajo) para poder detectar un stream
        # "congelado" (ret=True nunca vuelve a fallar, pero tampoco entrega
        # frames nuevos) además de fallos explícitos de lectura.
        last_successful_read_ts = time.time()
        last_frame_sig = None
        consecutive_failures = 0
        max_failures = int(settings.LPR_STREAM_MAX_READ_FAILURES)
        stale_seconds = float(settings.LPR_STREAM_STALE_SECONDS)
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
                self._report_throughput()
                # Stream CONGELADO: un decoder caído puede seguir devolviendo
                # ret=True con el MISMO frame en buffer. Comparamos una firma
                # barata (muestra dispersa del frame): el ruido del sensor la
                # cambia en un stream vivo, pero es idéntica si está congelado.
                # Solo un frame NUEVO refresca el reloj de "stale".
                try:
                    sig = frame[::32, ::32].tobytes()
                except Exception:
                    sig = None
                prev_sig = last_frame_sig
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
                # Deadline schedule (no reloj reseteado a `now`); lee el intervalo en
                # cada cuadro para respetar cambios de sample_fps en caliente.
                # Sin sleep: cap.read() bloquea hasta el siguiente cuadro; solo un
                # decoder congelado (cuadro igual, devuelve al instante) cede CPU.
                if not scheduler.due(now, self.cfg.poll_interval):
                    if sig is not None and sig == prev_sig:
                        time.sleep(0.005)
                    continue
                self.submit_frame(frame)
        finally:
            self._settings_stop.set()
            try:
                self.flush_pending()
            except Exception:
                logging.exception('Error liberando las patentes pendientes')
            try:
                self.executor.shutdown(wait=False)
            except Exception:
                pass

    def _on_frame_done(self, fut):
        """Hace visible cualquier excepción del pipeline.

        Sin este callback, un future descartado se traga la excepción en
        silencio: es el bug estructural que ocultó los fallos del worker
        durante meses (el manejador anterior era código muerto).
        """
        self._throughput.processed()
        try:
            fut.result()
        except Exception:
            logging.exception('Error procesando frame en el worker LPR')

    def _report_throughput(self) -> None:
        """Una línea cada 60 s: cuadros ofrecidos / procesados / descartados por
        ocupado y fps efectivo vs `sample_fps` (WARNING bajo el 80 %)."""
        report = self._throughput.poll(getattr(self.cfg, 'sample_fps', 0.0))
        if report is None:
            return
        if report.low:
            logging.warning('%s - BAJO el 80%% de lo configurado: el voto pierde lecturas '
                            '(contención de GPU/CPU)', format_report(report))
        else:
            logging.info('%s', format_report(report))

    def submit_frame(self, frame: np.ndarray):
        self._throughput.offered()
        # descartar el frame si el executor sigue ocupado con el anterior
        if self.processing_future is not None and not self.processing_future.done():
            self._throughput.dropped()
            return
        fut = self.executor.submit(self._process_frame, frame)
        fut.add_done_callback(self._on_frame_done)
        self.processing_future = fut

    def _prune_state(self, now_ts: float):
        """Purga `emitted_cache` pasada la ventana de dedupe desde la última
        lectura (el dedupe es deslizante), cuando ya no sirve. El estado de
        confirmación vive en el `PlateTracker`, que cierra solo sus
        seguimientos: los de un vehículo cuando este deja de estar vivo en el
        `VehicleTracker`, y los demás tras `track_max_gap_seconds` sin ver la patente."""
        dedup = float(settings.LPR_DEDUP_SECONDS)
        for plate in [p for p, ts in self.emitted_cache.items()
                      if now_ts - float(ts) > dedup]:
            self.emitted_cache.pop(plate, None)

    def _ensure_vehicle_tracker(self, cfg) -> Optional[VehicleTracker]:
        """Crea el VehicleTracker la primera vez que la cámara lo necesita (carga
        del modelo ~1 s; nunca se reintenta si falló: queda no disponible). Si cambia el
        `track_buffer` efectivo (`sample_fps`) NO se recarga el modelo: se reinicia solo el
        tracker de ultralytics con el yaml nuevo (ver `VehicleTracker.reconfigure`)."""
        fps = float(getattr(cfg, 'sample_fps', 0) or 0) or None
        current = self.vehicle_tracker
        if current is not None and current.available and fps is not None and hasattr(current, 'reconfigure'):
            if current.reconfigure(fps):
                logging.info('sample_fps cambió (%s): se reinicia el seguimiento de vehículos '
                             '(mismo modelo, track_buffer nuevo)', fps)
        if current is None and wants_vehicle_tracking(cfg):
            self.vehicle_tracker = VehicleTracker(
                model_ref=settings.LPR_VEHICLE_MODEL or None,
                device=getattr(cfg, 'device', None),
                sample_fps=fps,
                lost_seconds=float(settings.LPR_VEHICLE_LOST_SECONDS),
                relink_seconds=float(settings.LPR_VEHICLE_RELINK_SECONDS),
            )
            logging.info('Seguimiento de vehículos %s para %s',
                         'activo' if self.vehicle_tracker.available else 'NO disponible (sin voto por vehiculo; direccion por ancho)',
                         getattr(cfg, 'camera_id', '?'))
        return self.vehicle_tracker

    def _process_frame(self, frame: np.ndarray):
        """Detecta (con zona) -> lee -> formato -> seguimiento + voto -> emite.

        La parte pura (hasta el tracker) es `pipeline.process_frame`, la misma
        que corre `tools/replay_eval.py`; acá solo queda lo que tiene efectos:
        dedupe, guardado de la imagen y el POST al backend.
        """
        now_ts = time.time()
        self._last_frame = frame
        self._prune_state(now_ts)
        # Foto consistente de (cfg, tracker): un refetch a mitad de frame no
        # mezcla la config nueva con el tracker viejo.
        with self._runtime_lock:
            cfg, tracker = self.cfg, self.tracker
        reads, emissions = process_frame(
            frame, self.detector, self.fast_ocr, cfg, tracker, now_ts,
            save_only_on_plate=bool(settings.LPR_SAVE_ONLY_ON_PLATE),
            vehicle_tracker=self._ensure_vehicle_tracker(cfg),
        )
        for read in reads:
            if read.status == STATUS_SHAPE_REJECTED:
                logging.debug('Crop descartado por tamaño/forma (w=%d h=%d ratio=%.2f)',
                              read.crop_w, read.crop_h, read.crop_ratio)
            else:
                logging.debug('Detección: conf=%.2f | OCR: "%s" conf=%.2f | patente=%s (%s)',
                              read.det_conf, mask_plate(read.raw_text), read.ocr_conf,
                              mask_plate(read.plate), read.status)
        for emission in emissions:
            self._handle_emission(frame, emission, now_ts)

    def _handle_emission(self, frame: np.ndarray, emission: PlateEmission, now_ts: float):
        """Una emisión por vehículo (seguimiento) ya votada: dedupe, guardado
        best-effort y POST. El dedupe solo se consume si el backend aceptó."""
        plate_clean = emission.text
        # dedupe DESLIZANTE: una emisión descartada refresca la marca, así que
        # la ventana corre desde la ÚLTIMA vez que se vio la patente y no desde
        # la emisión. Un auto que se detiene y reanuda dentro de la ventana no
        # genera un evento nuevo (el backend no sabe si es entrada o salida).
        dedup_seconds = float(settings.LPR_DEDUP_SECONDS)
        last_seen = self.emitted_cache.get(plate_clean)
        if last_seen and (now_ts - last_seen) < dedup_seconds:
            logging.info('Placa "%s" duplicada - vista hace %.1fs', mask_plate(plate_clean), now_ts - last_seen)
            self.emitted_cache[plate_clean] = now_ts
            return

        best = emission.best_ref  # PlateRead de la mejor lectura ganadora
        # Evidencia = el CUADRO de esa mejor lectura (con SU caja): con la espera de
        # direccion o el flush el cuadro actual ya no tiene la patente donde estaba.
        # Sin evidencia (no deberia pasar) se cae al cuadro actual.
        frame = emission.evidence if emission.evidence is not None else frame
        x1c, y1c, x2c, y2c = (int(v) for v in emission.box)
        char_conf = list(best.char_conf) if best is not None else []
        char_stats = analyze_char_confidences(char_conf)

        # construir payload en forma del DTO: campos principales + meta
        meta: dict = {}
        meta['bbox'] = [x1c, y1c, x2c, y2c]
        # incluir snapshot en base64 solo si está habilitado por env
        if bool(settings.LPR_INCLUDE_SNAPSHOT) and best is not None and best.pil_crop is not None:
            meta['snapshot_jpeg_b64'] = pil_to_base64(best.pil_crop)
        meta['char_confidences'] = char_conf
        meta['char_conf_min'] = char_stats['min']
        meta['char_conf_mean'] = char_stats['mean']
        meta['direction'] = emission.direction
        meta['direction_source'] = emission.direction_source
        meta['track'] = emission.track_meta()
        meta['confirmed_by'] = 'track-vote'

        payload = {
            'cameraId': self.cfg.camera_id,
            'plate': plate_clean,
            'plate_raw': best.raw_text if best is not None else plate_clean,
            'det_confidence': emission.det_conf,
            'ocr_confidence': emission.ocr_conf,
            'meta': meta,
            # NO se envía la URL RTSP: contiene credenciales de la cámara y
            # el backend identifica la cámara por `cameraId`, no por mountPath.
            'detectionTimestamp': int(now_ts * 1000),  # Timestamp en milisegundos desde epoch
        }

        # El guardado de imagen/JSON/Cloudinary es best-effort: si falla,
        # igual se emite (el registro no debe depender de escribir a disco).
        try:
            stamp = int(time.time())
            det_fname = f'{self.cfg.camera_id}_det_{stamp}.jpg'
            det_path = os.path.join(self.detections_dir, det_fname)
            frame_det = frame.copy()
            try:
                # La caja de la mejor lectura, sobre el cuadro en que se leyo.
                fx1, fy1, fx2, fy2 = (int(v) for v in emission.box)
                cv2.rectangle(frame_det, (fx1, fy1), (fx2, fy2), (0, 255, 255), 3)
                label = f'{plate_clean} det:{emission.det_conf:.2f} ocr:{emission.ocr_conf:.2f}'
                cv2.putText(frame_det, label, (fx1, max(20, fy1 - 10)), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)
            except Exception:
                logging.exception('Error anotando frame de detección')
            cv2.imwrite(det_path, frame_det)
            logging.info('Guardada detección en %s', det_path)
            # publicar la ruta de la detección (esta es la imagen que debe enviarse al backend)
            payload['detection_path'] = det_path
            payload['full_frame_path'] = det_path
            # subir la detección a Cloudinary si está configurado
            if bool(settings.CLOUDINARY_UPLOAD):
                try:
                    from lpr.storage.fs_storage import (
                        CLOUDINARY_FRAMES_FOLDER,
                        upload_to_cloudinary,
                    )
                    public_id = f"{CLOUDINARY_FRAMES_FOLDER}/{self.cfg.camera_id}_det_{stamp}"
                    try:
                        remote_url = upload_to_cloudinary(det_path, public_id=public_id)
                        # update payload to point to remote detection image
                        payload['detection_path'] = remote_url
                        payload['full_frame_path'] = remote_url
                        logging.info('Uploaded det image to Cloudinary: %s', remote_url)
                        if bool(settings.CLOUDINARY_DELETE_LOCAL):
                            try:
                                os.remove(det_path)
                            except Exception:
                                logging.exception('No se pudo eliminar archivo local %s', det_path)
                    except Exception:
                        logging.exception('Error subiendo det image a Cloudinary, manteniendo local path')
                except Exception:
                    logging.exception('Error manejando Cloudinary upload')
            try:
                with open(det_path + '.json', 'w', encoding='utf-8') as mf:
                    json.dump(payload.copy(), mf, ensure_ascii=False, indent=2)
            except Exception:
                logging.exception('No se pudo guardar metadata JSON')
            if self.cfg.save_crops_dir and best is not None and best.pil_crop is not None:
                try:
                    save_image_pil(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_high_{stamp}.jpg', best.pil_crop)
                except Exception:
                    logging.exception('No se pudo guardar crop high')
        except Exception:
            logging.exception('Error guardando la detección')

        # Solo logs enmascarados: el payload enviado lleva la patente real, el log no.
        logging.info('Evento: placa=%s cámara=%s dirección=%s (%s) track=%s', mask_plate(plate_clean),
                     payload['cameraId'], emission.direction, emission.direction_source, meta['track'])
        status = post_event(self.cfg.backend_url, payload, dry_run=self.cfg.dry_run)
        if consumes_dedupe(status):
            # Se consume el dedupe si el backend aceptó el evento, o si pudo haberlo
            # recibido (timeout leyendo la respuesta: pudo haber abierto el portón;
            # reabrirlo sería peor que perder el evento). NO se consume solo cuando
            # el request seguro no llegó: antes un fallo bloqueaba la patente 120 s
            # sin que el backend la hubiera recibido nunca.
            self.emitted_cache[plate_clean] = time.time()
            if not is_success(status):
                logging.warning('POST de la patente %s sin respuesta confirmada (estado %s): se consume el '
                                'dedupe para no reabrir', mask_plate(plate_clean), status)
        else:
            logging.warning('POST de la patente %s falló (estado %s): no se consume el dedupe',
                            mask_plate(plate_clean), status)
