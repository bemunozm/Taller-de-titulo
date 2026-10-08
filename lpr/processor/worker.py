import logging
import time
import os
import re
import sys
import json
import cv2
from typing import Optional
import concurrent.futures
import numpy as np
from pathlib import Path

from lpr.detector.yolo_detector import Detection
from lpr.utils.images import frame_to_pil, pil_to_base64
from lpr.utils.capture import reconnect_capture
from lpr.ocr.fast_ocr_adapter import FastPlateOCR
from lpr.storage.fs_storage import save_image_pil, save_json
from lpr.api.client import post_event
from lpr.processor.rules import (
    normalize_plate,
    plausible_plate,
    analyze_char_confidences,
    should_confirm,
    should_save_or_emit,
)
from lpr.settings import settings


class LprWorker:
    def __init__(self, cfg, detector, fast_ocr: Optional[FastPlateOCR]):
        self.cfg = cfg
        self.detector = detector
        self.fast_ocr = fast_ocr
        self.plate_sightings = {}
        self.emitted_cache = {}
        # executor para procesar frames asincrónicamente y future de control
        max_workers = int(os.environ.get('LPR_MAX_WORKERS', '1'))
        try:
            self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        except Exception:
            # fallback a un executor simple si ocurre algo
            self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self.processing_future = None
        # directorio donde se guardan las detecciones completas (frames anotados)
        # usar la ruta ya normalizada por cfg (config.py se encarga de resolver relativas)
        self.detections_dir = getattr(self.cfg, 'detections_dir', 'detecciones')

        try:
            os.makedirs(self.detections_dir, exist_ok=True)
        except Exception:
            logging.exception('No se pudo crear detections_dir %s', self.detections_dir)
        logging.info('LPR detections_dir set to %s', self.detections_dir)

    def start_capture_loop(self, cap):
        last_frame_ts = 0
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
                # Stream CONGELADO: un decoder caído puede seguir devolviendo
                # ret=True con el MISMO frame en buffer. Comparamos una firma
                # barata (muestra dispersa del frame): el ruido del sensor la
                # cambia en un stream vivo, pero es idéntica si está congelado.
                # Solo un frame NUEVO refresca el reloj de "stale".
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
                if now - last_frame_ts < self.cfg.poll_interval:
                    time.sleep(0.005)
                    continue
                last_frame_ts = now
                self.submit_frame(frame)
        finally:
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
        try:
            fut.result()
        except Exception:
            logging.exception('Error procesando frame en el worker LPR')

    def submit_frame(self, frame: np.ndarray):
        # descartar el frame si el executor sigue ocupado con el anterior
        if self.processing_future is not None and not self.processing_future.done():
            return
        fut = self.executor.submit(self._process_frame, frame)
        fut.add_done_callback(self._on_frame_done)
        self.processing_future = fut

    def _prune_state(self, now_ts: float):
        """Purga estado en memoria para que no crezca sin cota ni corrompa la
        confirmación multi-frame.

        `plate_sightings` se limpia por ventana de avistamiento (TTL): así el
        `count` refleja el paso ACTUAL de un vehículo y no su historia completa
        —sin esto, desde el 2º avistamiento histórico cualquier patente se
        confirmaba en un solo frame—. `emitted_cache` se limpia pasada la
        ventana de dedupe, cuando ya no sirve.
        """
        ttl = float(settings.LPR_SIGHTING_TTL_SECONDS)
        dedup = float(settings.LPR_DEDUP_SECONDS)
        for plate in [p for p, e in self.plate_sightings.items()
                      if now_ts - float(e.get('last_seen', 0)) > ttl]:
            self.plate_sightings.pop(plate, None)
        for plate in [p for p, ts in self.emitted_cache.items()
                      if now_ts - float(ts) > dedup]:
            self.emitted_cache.pop(plate, None)

    def _process_frame(self, frame: np.ndarray):
        # Esta función implementa la lógica de detección/OCR/confirmación
        self._prune_state(time.time())
        plates = self.detector(frame, self.cfg.min_det_conf)
        logging.debug('Frame procesado - Detecciones: %d', len(plates) if plates else 0)
        if not plates:
            return
        for det in plates:
            x1, y1, x2, y2 = det.x1, det.y1, det.x2, det.y2
            conf = det.confidence
            h, w = frame.shape[:2]
            x1c, y1c = max(0, x1), max(0, y1)
            x2c, y2c = min(w - 1, x2), min(h - 1, y2)
            if x2c <= x1c or y2c <= y1c:
                continue

            # Filtro de tamaño/forma del crop: un recorte diminuto o deforme no
            # es legible y el OCR "alucina" con confianza engañosa sobre él.
            # (Estos umbrales existían en la config pero nunca se cableaban.)
            crop_w = x2c - x1c
            crop_h = y2c - y1c
            crop_area = crop_w * crop_h
            crop_ratio = (crop_w / crop_h) if crop_h > 0 else 0.0
            if (crop_w < self.cfg.min_crop_w or crop_h < self.cfg.min_crop_h
                    or crop_area < self.cfg.min_crop_area
                    or crop_ratio < self.cfg.min_crop_ratio
                    or crop_ratio > self.cfg.max_crop_ratio):
                logging.info('Crop descartado por tamaño/forma (w=%d h=%d area=%d ratio=%.2f)',
                             crop_w, crop_h, crop_area, crop_ratio)
                continue

            crop = frame[y1c:y2c, x1c:x2c]
            pil_crop = frame_to_pil(crop)

            # OCR
            ocr_res = self.fast_ocr.recognize(np.array(pil_crop)) if self.fast_ocr else None
            plate_text = ocr_res.text if ocr_res else ''
            ocr_conf = ocr_res.confidence if ocr_res else 0.0
            char_conf = ocr_res.char_confidences if ocr_res else []
            logging.info('Detección: conf=%.2f | OCR: "%s" conf=%.2f', conf, plate_text, ocr_conf)

            save_only_on_plate = bool(settings.LPR_SAVE_ONLY_ON_PLATE)
            if save_only_on_plate and (not plate_text or plate_text.strip() == ''):
                logging.info('OCR vacío — saltando detección')
                continue

            plate_clean = normalize_plate(plate_text)
            if not plausible_plate(plate_clean):
                logging.info('Placa "%s" no plausible, descartando', plate_text)
                if self.cfg.save_crops_dir:
                    try:
                        save_image_pil(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_bad_{int(time.time())}.jpg', pil_crop)
                    except Exception:
                        logging.exception('No se pudo guardar crop malo')
                continue

            char_stats = analyze_char_confidences(char_conf)
            min_char_ratio_required = float(settings.LPR_MIN_CHAR_CONF_RATIO)
            if char_stats['num_chars'] > 0 and char_stats['ratio_above'] < min_char_ratio_required:
                logging.info('Placa "%s" rechazada - calidad insuficiente (ratio: %.2f < %.2f)', 
                           plate_clean, char_stats['ratio_above'], min_char_ratio_required)
                if self.cfg.save_crops_dir:
                    try:
                        save_image_pil(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_lowq_{int(time.time())}.jpg', pil_crop)
                    except Exception:
                        logging.exception('No se pudo guardar crop lowq')
                continue
            # dedupe
            dedup_seconds = float(settings.LPR_DEDUP_SECONDS)
            now_ts = time.time()
            last_emitted = self.emitted_cache.get(plate_clean)
            if plate_clean and last_emitted and (now_ts - last_emitted) < dedup_seconds:
                logging.info('Placa "%s" duplicada - emitida hace %.1fs', plate_clean, now_ts - last_emitted)
                continue

            # sightings
            entry = self.plate_sightings.get(plate_clean)
            if entry is None:
                entry = {'first_seen': now_ts, 'count': 0, 'last_seen': now_ts}
            entry['count'] = entry.get('count', 0) + 1
            entry['last_seen'] = now_ts
            self.plate_sightings[plate_clean] = entry
            confirmed, info = should_confirm(self.plate_sightings, plate_clean)
            if not confirmed:
                logging.info('Esperando confirmación %s (visto %d veces)', plate_clean, entry.get('count', 0))
                logging.debug('Esperando confirmacion %s', plate_clean)
                if self.cfg.save_crops_dir:
                    try:
                        save_image_pil(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_pending_{int(time.time())}.jpg', pil_crop)
                    except Exception:
                        logging.exception('No se pudo guardar crop pending')
                continue

            # construir payload en forma del DTO: campos principales + meta
            meta: dict = {}
            meta['bbox'] = [int(x1c), int(y1c), int(x2c), int(y2c)]
            # incluir snapshot en base64 solo si está habilitado por env
            include_snapshot = bool(settings.LPR_INCLUDE_SNAPSHOT)
            if include_snapshot:
                meta['snapshot_jpeg_b64'] = pil_to_base64(pil_crop)
            meta['char_confidences'] = char_conf
            meta['char_conf_min'] = char_stats['min']
            meta['char_conf_mean'] = char_stats['mean']
            meta['char_conf_ratio'] = char_stats['ratio_above']

            payload = {
                'cameraId': self.cfg.camera_id,
                'plate': plate_clean,
                'plate_raw': plate_text,
                'det_confidence': conf,
                'ocr_confidence': ocr_conf,
                'meta': meta,
                # NO se envía la URL RTSP: contiene credenciales de la cámara y
                # el backend identifica la cámara por `cameraId`, no por mountPath.
                'detectionTimestamp': int(now_ts * 1000),  # Timestamp en milisegundos desde epoch
            }

            # NOTE: saving full frames for debug was removed by request.
            # Only crops and detections are saved. Frames saving/uploading were deprecated.

            # Gate de confianza. ANTES este resultado solo decidía si se
            # guardaba el JPG: `post_event` quedaba FUERA del `if`, así que se
            # emitía —y potencialmente se abría el portón— con detecciones de
            # baja confianza. Ahora el gate gobierna la EMISIÓN.
            try:
                det_thresh = float(settings.LPR_DET_CONF_THRESHOLD or self.cfg.det_high_conf)
                ocr_thresh = float(settings.LPR_OCR_CONF_THRESHOLD or self.cfg.ocr_high_conf)
                save_high = should_save_or_emit(conf, ocr_conf, self.cfg.combined_threshold, det_thresh, ocr_thresh)
            except Exception:
                logging.exception('Error evaluando el umbral de emisión')
                save_high = False

            if not save_high:
                # Confianza insuficiente: NO se emite al backend (fail-closed).
                logging.info('Detección de baja confianza NO emitida: %s (det=%.2f ocr=%.2f)',
                             plate_clean, conf, ocr_conf)
                continue

            # A partir de aquí la detección supera el umbral y SÍ se emite.
            # El guardado de imagen/JSON/Cloudinary es best-effort: si falla,
            # igual se emite (la apertura no debe depender de escribir a disco).
            try:
                det_fname = f'{self.cfg.camera_id}_det_{int(time.time())}.jpg'
                det_path = os.path.join(self.detections_dir, det_fname)
                frame_det = frame.copy()
                try:
                    cv2.rectangle(frame_det, (int(x1c), int(y1c)), (int(x2c), int(y2c)), (0, 255, 255), 3)
                    label = f'{plate_clean} det:{conf:.2f} ocr:{ocr_conf:.2f}'
                    cv2.putText(frame_det, label, (int(x1c), max(20, int(y1c) - 10)), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)
                except Exception:
                    logging.exception('Error anotando frame de detección')
                cv2.imwrite(det_path, frame_det)
                logging.info('Guardada detección de alta confianza en %s', det_path)
                # publicar la ruta de la detección (esta es la imagen que debe enviarse al backend)
                payload['detection_path'] = det_path
                payload['full_frame_path'] = det_path
                # subir la detección a Cloudinary si está configurado
                if bool(settings.CLOUDINARY_UPLOAD):
                    try:
                        from lpr.storage.fs_storage import upload_to_cloudinary
                        public_id = f"{self.cfg.camera_id}_det_{int(time.time())}"
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
                    if int(settings.LPR_CONFIRM_FRAMES) <= int(entry.get('count', 0)):
                        confirmed_by = 'frames'
                    else:
                        confirmed_by = 'seconds'
                    # guardar confirmed_by dentro de meta
                    payload['meta']['confirmed_by'] = confirmed_by
                    meta_to_save = payload.copy()
                    meta_path = det_path + '.json'
                    with open(meta_path, 'w', encoding='utf-8') as mf:
                        json.dump(meta_to_save, mf, ensure_ascii=False, indent=2)
                except Exception:
                    logging.exception('No se pudo guardar metadata JSON')
                if self.cfg.save_crops_dir:
                    try:
                        save_image_pil(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_high_{int(time.time())}.jpg', pil_crop)
                    except Exception:
                        logging.exception('No se pudo guardar crop high')
            except Exception:
                logging.exception('Error guardando detección de alta confianza')

            # Marcar el dedupe SOLO al emitir (antes se marcaba dentro del save,
            # así que las lecturas malas nunca entraban al dedupe y se
            # re-emitían en cada frame) y recién entonces emitir.
            self.emitted_cache[plate_clean] = time.time()
            logging.info('Evento: %s ...', json.dumps(payload, ensure_ascii=False)[:200])
            post_event(self.cfg.backend_url, payload, dry_run=self.cfg.dry_run)
            time.sleep(self.cfg.min_event_interval)
