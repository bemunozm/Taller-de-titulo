import logging
import time
import os
import re
import json
import cv2
from typing import Optional
import concurrent.futures
import numpy as np

from lpr.detector.yolo_detector import Detection
from lpr.utils.images import frame_to_pil, pil_to_base64
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


class LprWorker:
    def __init__(self, cfg, detector, fast_ocr: Optional[FastPlateOCR]):
        self.cfg = cfg
        self.detector = detector
        self.fast_ocr = fast_ocr
        self.plate_sightings = {}
        self.emitted_cache = {}
        # directorio donde se guardan las detecciones completas (frames anotados)
        self.detections_dir = os.environ.get('LPR_DETECTIONS_DIR', getattr(self.cfg, 'detections_dir', 'detecciones'))
        try:
            os.makedirs(self.detections_dir, exist_ok=True)
        except Exception:
            logging.exception('No se pudo crear detections_dir %s', self.detections_dir)
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get('LPR_MAX_WORKERS', '1')))
        self.processing_future = None
        self.latest_frame = None

    def start_capture_loop(self, cap):
        last_frame_ts = 0
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    logging.warning('Frame no recibido - reconectando...')
                    time.sleep(1)
                    continue
                now = time.time()
                if now - last_frame_ts < self.cfg.poll_interval:
                    time.sleep(0.005)
                    continue
                last_frame_ts = now
                self.submit_frame(frame)
                if self.processing_future is not None and self.processing_future.done():
                    try:
                        self.processing_future.result()
                    except Exception:
                        logging.exception('Error worker')
        finally:
            try:
                self.executor.shutdown(wait=False)
            except Exception:
                pass

    def submit_frame(self, frame: np.ndarray):
        self.latest_frame = frame.copy()
        if self.processing_future is None or self.processing_future.done():
            self.processing_future = self.executor.submit(self._process_frame, self.latest_frame)

    def _process_frame(self, frame: np.ndarray):
        # Esta función implementa la lógica de detección/OCR/confirmación
        plates = self.detector(frame, self.cfg.min_det_conf)
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
            crop = frame[y1c:y2c, x1c:x2c]
            pil_crop = frame_to_pil(crop)

            # OCR
            ocr_res = self.fast_ocr.recognize(np.array(pil_crop)) if self.fast_ocr else None
            plate_text = ocr_res.text if ocr_res else ''
            ocr_conf = ocr_res.confidence if ocr_res else 0.0
            char_conf = ocr_res.char_confidences if ocr_res else []

            save_only_on_plate = os.environ.get('LPR_SAVE_ONLY_ON_PLATE', '1') in ('1', 'true', 'True')
            if save_only_on_plate and (not plate_text or plate_text.strip() == ''):
                logging.debug('OCR vacío — saltando')
                continue

            plate_clean = normalize_plate(plate_text)
            if not plausible_plate(plate_clean):
                logging.debug('Placa %s no plausible', plate_text)
                if self.cfg.save_crops_dir:
                    try:
                        save_image_pil(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_bad_{int(time.time())}.jpg', pil_crop)
                    except Exception:
                        logging.exception('No se pudo guardar crop malo')
                continue

            char_stats = analyze_char_confidences(char_conf)
            min_char_ratio_required = float(os.environ.get('LPR_MIN_CHAR_CONF_RATIO', '0.6'))
            if char_stats['num_chars'] > 0 and char_stats['ratio_above'] < min_char_ratio_required:
                logging.debug('Placa %s rechazada por calidad', plate_clean)
                if self.cfg.save_crops_dir:
                    try:
                        save_image_pil(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_lowq_{int(time.time())}.jpg', pil_crop)
                    except Exception:
                        logging.exception('No se pudo guardar crop lowq')
                continue

            # dedupe
            dedup_seconds = float(os.environ.get('LPR_DEDUP_SECONDS', '10'))
            now_ts = time.time()
            last_emitted = self.emitted_cache.get(plate_clean)
            if plate_clean and last_emitted and (now_ts - last_emitted) < dedup_seconds:
                logging.debug('Placa %s recientemente emitida', plate_clean)
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
                logging.debug('Esperando confirmacion %s', plate_clean)
                if self.cfg.save_crops_dir:
                    try:
                        save_image_pil(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_pending_{int(time.time())}.jpg', pil_crop)
                    except Exception:
                        logging.exception('No se pudo guardar crop pending')
                continue

            # construir payload
            payload = {
                'cameraId': self.cfg.camera_id,
                'mountPath': self.cfg.rtsp_url,
                'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'plate': plate_clean,
                'plate_raw': plate_text,
                'det_confidence': conf,
                'ocr_confidence': ocr_conf,
                'bbox': [int(x1c), int(y1c), int(x2c), int(y2c)],
                'snapshot_jpeg_b64': pil_to_base64(pil_crop),
                'char_confidences': char_conf,
                'char_conf_min': char_stats['min'],
                'char_conf_mean': char_stats['mean'],
                'char_conf_ratio': char_stats['ratio_above'],
            }

            if self.cfg.save_frames_dir:
                try:
                    os.makedirs(self.cfg.save_frames_dir, exist_ok=True)
                    frame_annot = frame.copy()
                    for d in plates:
                        cv2.rectangle(frame_annot, (int(d.x1), int(d.y1)), (int(d.x2), int(d.y2)), (0, 255, 0), 2)
                    try:
                        txt = plate_text if plate_text else 'UNKNOWN'
                        y_text = max(10, int(y1c) - 10)
                        cv2.putText(frame_annot, txt, (int(x1c), y_text), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
                    except Exception:
                        pass
                    frame_path = os.path.join(self.cfg.save_frames_dir, f'{self.cfg.camera_id}_frame_{int(time.time())}.jpg')
                    cv2.imwrite(frame_path, frame_annot)
                    payload['full_frame_path'] = frame_path
                except Exception:
                    logging.exception('No se pudo guardar frame anotado')

            try:
                det_thresh = float(os.environ.get('LPR_DET_CONF_THRESHOLD', str(self.cfg.det_high_conf)))
                ocr_thresh = float(os.environ.get('LPR_OCR_CONF_THRESHOLD', str(self.cfg.ocr_high_conf)))
                save_high = should_save_or_emit(conf, ocr_conf, self.cfg.combined_threshold, det_thresh, ocr_thresh)
                if save_high:
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
                    try:
                        if int(os.environ.get('LPR_CONFIRM_FRAMES', '3')) <= int(entry.get('count', 0)):
                            confirmed_by = 'frames'
                        else:
                            confirmed_by = 'seconds'
                        payload['confirmed_by'] = confirmed_by
                        meta = payload.copy()
                        meta_path = det_path + '.json'
                        with open(meta_path, 'w', encoding='utf-8') as mf:
                            json.dump(meta, mf, ensure_ascii=False, indent=2)
                    except Exception:
                        logging.exception('No se pudo guardar metadata JSON')
                    if self.cfg.save_crops_dir:
                        try:
                            save_image_pil(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_high_{int(time.time())}.jpg', pil_crop)
                        except Exception:
                            logging.exception('No se pudo guardar crop high')
                    try:
                        self.emitted_cache[plate_clean] = time.time()
                    except Exception:
                        logging.exception('No se pudo marcar emitted_cache')
                    time.sleep(self.cfg.min_event_interval)
            except Exception:
                logging.exception('Error guardando detección de alta confianza')

            logging.info('Evento: %s ...', json.dumps(payload, ensure_ascii=False)[:200])
            post_event(self.cfg.backend_url, payload, dry_run=self.cfg.dry_run)
