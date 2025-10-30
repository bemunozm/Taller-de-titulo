#!/usr/bin/env python3
"""
Refactorización de lpr_worker.py

Este módulo implementa un trabajador (LprWorker) que conecta a un stream RTSP,
detecta placas con un detector YOLO y realiza OCR con fast-plate-ocr.

Objetivos del refactor:
- Encapsular estado (eliminar uso de globals)
- Usar logging en lugar de prints
- Mantener la interfaz CLI y variables de entorno existentes
- Mantener la lógica funcional original (detección, OCR, guardado, confirmación y dedupe)

Comentarios y nombres en español.
"""

import base64
import io
import json
import os
import sys
import time
import logging
from dataclasses import dataclass
from typing import List, Tuple, Optional, Dict, Any

import cv2
import numpy as np
import requests
from PIL import Image
import concurrent.futures
import re

# librerías de ML/HF
from ultralytics import YOLO
from huggingface_hub import hf_hub_download


@dataclass
class LprConfig:
    rtsp_url: str
    camera_id: str
    backend_url: str
    poll_interval: float = 1.0  # seconds between frames to process
    ocr_device: str = 'cpu'  # 'cpu', 'cuda' o 'auto' (auto detectará CUDA si está disponible)
    detector_model: str = 'morsetechlab/yolov11-license-plate-detection'
    ocr_model: str = 'DunnBC22/trocr-base-printed_license_plates_ocr'
    min_det_conf: float = 0.3
    dry_run: bool = True
    save_crops_dir: str = ''  # si no vacío, guardar recortes de placas aquí para depuración
    save_frames_dir: str = ''  # si no vacío, guardar frames completos anotados cuando se detecten placas
    # nuevos parámetros
    min_event_interval: float = 2.0  # segundos de enfriamiento entre eventos para no spammear
    detections_dir: str = 'detecciones'  # carpeta donde guardar screenshots anotadas de alta confianza
    det_high_conf: float = 0.55
    ocr_high_conf: float = 0.98
    # validación de crop
    min_crop_w: int = 30
    min_crop_h: int = 10
    min_crop_area: int = 300
    min_crop_ratio: float = 2.0  # ancho/alto mínimo razonable
    max_crop_ratio: float = 12.0  # ancho/alto máximo razonable
    # guardar aunque det_conf bajo si OCR alto
    force_save_on_ocr: bool = True
    combined_threshold: float = 0.3  # si det_conf * ocr_conf >= combined_threshold guardar como detección


def load_models(cfg: LprConfig):
    """Cargar modelos: detector YOLO y (opcional) fast-plate-ocr.

    Devuelve una tupla (detector, fast_ocr_instancia_o_None).
    """
    logging.info('Cargando detector YOLO desde %s', cfg.detector_model)
    # Si el detector es un repo de Hugging Face, intentamos descargar un checkpoint conocido
    detector_path = cfg.detector_model
    if '/' in cfg.detector_model:
        print('Detector parece un repositorio HF, intentando descargar checkpoint...')
        # nombres de checkpoints observados en el repo morsetechlab/yolov11-license-plate-detection
        candidates = [
            'license-plate-finetune-v1n.pt', 'license-plate-finetune-v1n.onnx',
            'license-plate-finetune-v1s.pt', 'license-plate-finetune-v1s.onnx',
            'license-plate-finetune-v1m.pt', 'license-plate-finetune-v1m.onnx',
            'license-plate-finetune-v1l.pt', 'license-plate-finetune-v1l.onnx',
            'license-plate-finetune-v1x.pt', 'license-plate-finetune-v1x.onnx',
        ]
        downloaded = None
        for fname in candidates:
            try:
                print(f' intentando {fname}...')
                path = hf_hub_download(repo_id=cfg.detector_model, filename=fname)
                print(' descargado:', path)
                downloaded = path
                break
            except Exception:
                continue
        if downloaded is None:
            raise FileNotFoundError(f"No se encontró checkpoint en el repo HF {cfg.detector_model}. Descarga manual y pasa la ruta .pt/.onnx")
        detector_path = downloaded

    try:
        detector = YOLO(detector_path)
    except Exception as e:
        logging.exception('Error cargando detector YOLO: %s', e)
        raise

    # Cargar fast-plate-ocr como OCR primario (CPU)
    fast_ocr = None
    try:
        import importlib
        mod = importlib.import_module('fast_plate_ocr')
        LicensePlateRecognizer = getattr(mod, 'LicensePlateRecognizer', None)
        fast_model = os.environ.get('LPR_FAST_OCR_MODEL', 'cct-s-v1-global-model')
        if LicensePlateRecognizer is not None:
            try:
                # forzar device CPU según requerimiento
                fast_ocr = LicensePlateRecognizer(fast_model, device='cpu')
                logging.info('fast-plate-ocr cargado con modelo %s en CPU', fast_model)
            except Exception as fe:
                logging.exception('fast-plate-ocr instalado pero no se pudo instanciar el modelo: %s', fe)
                fast_ocr = None
        else:
            logging.warning('fast_plate_ocr importado pero LicensePlateRecognizer no encontrado')
            fast_ocr = None
    except Exception as e:
        logging.info('fast-plate-ocr no está disponible en el entorno: %s', e)
        fast_ocr = None

    return detector, fast_ocr


def frame_to_pil(img: np.ndarray) -> Image.Image:
    """Convertir frame BGR de OpenCV a PIL Image (RGB)."""
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return Image.fromarray(img_rgb)


def pil_to_base64(img: Image.Image) -> str:
    """Codificar PIL Image a JPEG base64 (string)."""
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=80)
    return base64.b64encode(buf.getvalue()).decode('ascii')


def detect_plates(detector: YOLO, img: np.ndarray, min_conf: float) -> List[Tuple[int, int, int, int, float]]:
    """Ejecutar detector YOLO sobre el frame y devolver lista de cajas (x1,y1,x2,y2,conf).

    Nota: el formato de salida depende de la versión de ultralytics. Esta función intenta
    ser tolerante a distintas formas internas.
    """
    results = detector(img)
    boxes: List[Tuple[int, int, int, int, float]] = []
    for res in results:
        if hasattr(res, 'boxes'):
            for box in res.boxes:
                conf = float(box.conf) if hasattr(box, 'conf') else 0.0
                if conf < min_conf:
                    continue
                xyxy = box.xyxy.cpu().numpy().astype(int)[0] if hasattr(box.xyxy, 'cpu') else np.array(box.xyxy).astype(int)
                x1, y1, x2, y2 = map(int, xyxy[:4])
                boxes.append((x1, y1, x2, y2, conf))
    return boxes


def ocr_plate(fast_ocr, plate_img: Image.Image) -> Tuple[str, float, list]:
    """Ejecutar OCR sobre un recorte de placa usando fast-plate-ocr.

    Devuelve (texto, confianza_agrupada, lista_conf_por_caracter).
    """
    if fast_ocr is None:
        return '', 0.0, []
    try:
        arr = np.array(plate_img.convert('RGB'))
        res = fast_ocr.run(arr, return_confidence=True)
        text = ''
        confidence = 0.0
        char_confidences: List[float] = []
        if isinstance(res, tuple) and len(res) == 2:
            plates, conf = res
            text = plates[0] if plates and len(plates) > 0 else ''
            try:
                import numpy as _np
                conf_arr = _np.array(conf)
                if conf_arr.size == 0:
                    confidence = 0.0
                    char_confidences = []
                else:
                    row = conf_arr[0] if conf_arr.ndim == 2 else conf_arr.ravel()
                    pad_chars = set(['_', ' '])
                    char_scores: List[float] = []
                    for i, ch in enumerate(text):
                        if i < row.size and (ch not in pad_chars):
                            try:
                                v = float(row[i])
                                vv = max(0.0, min(1.0, v))
                                char_scores.append(vv)
                                char_confidences.append(vv)
                            except Exception:
                                continue
                    if len(char_scores) > 0:
                        confidence = float(sum(char_scores) / len(char_scores))
                    else:
                        try:
                            confidence = float(_np.mean(row))
                        except Exception:
                            confidence = float(_np.max(row)) if row.size > 0 else 0.0
            except Exception:
                logging.exception('Error al procesar confidencias devueltas por fast-plate-ocr')
                confidence = 0.0
                char_confidences = []
        elif isinstance(res, (list, tuple)):
            plates = list(res)
            text = plates[0] if plates and len(plates) > 0 else ''
            confidence = 0.0
            char_confidences = []
        else:
            try:
                plates = list(res)
                text = plates[0] if plates and len(plates) > 0 else ''
            except Exception:
                text = str(res)
            confidence = 0.0
            char_confidences = []
    except Exception as e:
        logging.exception('Error fast-plate-ocr: %s', e)
        return '', 0.0, []
    try:
        if confidence is None:
            confidence = 0.0
        confidence = max(0.0, min(1.0, float(confidence)))
    except Exception:
        confidence = 0.0
    if os.environ.get('LPR_DEBUG_OCR_CONF', '0') in ('1', 'true', 'True'):
        logging.debug('OCR result: "%s" conf=%.4f chars=%s', text, confidence, char_confidences)
    return text.strip(), float(confidence), list(char_confidences)


def post_event(cfg: LprConfig, payload: dict):
    """Enviar evento al backend o simularlo si cfg.dry_run es True."""
    if cfg.dry_run:
        logging.info('DRY RUN - evento (no enviado): %s', json.dumps(payload, ensure_ascii=False))
        return 200
    try:
        resp = requests.post(cfg.backend_url, json=payload, timeout=5)
        logging.info('POST %s -> %s', cfg.backend_url, resp.status_code)
        return resp.status_code
    except Exception as e:
        logging.exception('Error POST hacia backend: %s', e)
        return None


def run(cfg: LprConfig):
    """Punto de entrada principal - crea una instancia de LprWorker y ejecuta el loop.

    Esta función mantiene compatibilidad CLI con la versión anterior.
    """
    logging.basicConfig(level=os.environ.get('LPR_LOG_LEVEL', 'INFO'))
    detector, fast_ocr = load_models(cfg)
    worker = LprWorker(cfg=cfg, detector=detector, fast_ocr=fast_ocr)
    try:
        worker.start()
    except KeyboardInterrupt:
        logging.info('Interrumpido por usuario')
    except Exception:
        logging.exception('Worker finalizó con error')
    finally:
        worker.stop()


class LprWorker:
    """Clase que encapsula el estado y la lógica del worker LPR.

    Mantiene caches (sightings, emitted_cache) como estado de instancia, expone
    métodos start()/stop() y una implementación del loop principal.
    """

    def __init__(self, cfg: LprConfig, detector, fast_ocr):
        self.cfg = cfg
        self.detector = detector
        self.fast_ocr = fast_ocr

        # caches en memoria (antes globales)
        self.plate_sightings: Dict[str, Dict[str, Any]] = {}
        self.emitted_cache: Dict[str, float] = {}
        self.plate_cache: Dict[str, Any] = {}

        # parámetros leídos desde env o cfg
        self.min_event_interval = float(os.environ.get('LPR_MIN_EVENT_INTERVAL', str(cfg.min_event_interval)))
        self.detections_dir = os.environ.get('LPR_DETECTIONS_DIR', cfg.detections_dir)
        self.det_high_conf = float(os.environ.get('LPR_DET_HIGH_CONF', str(cfg.det_high_conf)))
        self.ocr_high_conf = float(os.environ.get('LPR_OCR_HIGH_CONF', str(cfg.ocr_high_conf)))
        os.makedirs(self.detections_dir, exist_ok=True)

        # control del loop y thread pool
        self._stop = False
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get('LPR_MAX_WORKERS', '1')))
        self.processing_future: Optional[concurrent.futures.Future] = None
        self.latest_frame_for_processing: Optional[np.ndarray] = None

    def start(self):
        """Iniciar captura RTSP y loop principal."""
        logging.info('Conectando a RTSP: %s', self.cfg.rtsp_url)
        cap = cv2.VideoCapture(self.cfg.rtsp_url, cv2.CAP_FFMPEG)
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        if not cap.isOpened():
            logging.error('No se pudo abrir la fuente RTSP %s', self.cfg.rtsp_url)
            return

        last_frame_ts = 0.0

        def submit_frame_for_processing(frame_to_proc: np.ndarray):
            # actualizamos el último frame y lanzamos task si no hay una en curso
            self.latest_frame_for_processing = frame_to_proc.copy()
            if self.processing_future is None or self.processing_future.done():
                self.processing_future = self.executor.submit(self._process_frame, self.latest_frame_for_processing)

        try:
            while not self._stop:
                ret, frame = cap.read()
                if not ret:
                    logging.warning('Frame no recibido, reintentando en 1s')
                    time.sleep(1)
                    try:
                        cap.release()
                        cap = cv2.VideoCapture(self.cfg.rtsp_url, cv2.CAP_FFMPEG)
                    except Exception:
                        pass
                    time.sleep(0.5)
                    continue

                now = time.time()
                if now - last_frame_ts < self.cfg.poll_interval:
                    time.sleep(0.005)
                    continue
                last_frame_ts = now

                submit_frame_for_processing(frame)

                # recoger errores de la futura si terminó
                if self.processing_future is not None and self.processing_future.done():
                    try:
                        _ = self.processing_future.result()
                    except Exception:
                        logging.exception('Error en worker de procesamiento')
        finally:
            try:
                self.executor.shutdown(wait=False)
            except Exception:
                pass
            cap.release()

    def stop(self):
        self._stop = True

    def _cleanup_caches(self):
        """Limpiar entradas antiguas en plate_sightings y emitted_cache."""
        sightings_ttl = float(os.environ.get('LPR_SIGHTINGS_TTL', '30'))
        emitted_ttl = float(os.environ.get('LPR_EMITTED_TTL', '300'))
        now = time.time()
        keys_to_del = [k for k, v in self.plate_sightings.items() if (now - float(v.get('last_seen', now))) > sightings_ttl]
        for k in keys_to_del:
            self.plate_sightings.pop(k, None)
        keys_to_del2 = [k for k, v in self.emitted_cache.items() if (now - float(v)) > emitted_ttl]
        for k in keys_to_del2:
            self.emitted_cache.pop(k, None)

    def _process_frame(self, frame: np.ndarray):
        """Procesar un único frame: detectar placas, OCR, filtrado, confirmación y guardado."""
        t0 = time.time()
        try:
            self._cleanup_caches()
        except Exception:
            logging.exception('Error limpiando caches')

        plates = detect_plates(self.detector, frame, self.cfg.min_det_conf)
        dt_detect = time.time() - t0
        logging.debug('Detección tardó %.1f ms (thread)', dt_detect * 1000.0)
        if not plates:
            logging.debug('No se detectaron placas en este frame')
            return

        dedup_seconds = float(os.environ.get('LPR_DEDUP_SECONDS', '10'))
        save_only_on_plate = os.environ.get('LPR_SAVE_ONLY_ON_PLATE', '1') in ('1', 'true', 'True')

        for (x1, y1, x2, y2, conf) in plates:
            h, w = frame.shape[:2]
            x1c, y1c = max(0, x1), max(0, y1)
            x2c, y2c = min(w - 1, x2), min(h - 1, y2)
            if x2c <= x1c or y2c <= y1c:
                continue
            crop = frame[y1c:y2c, x1c:x2c]
            h_crop, w_crop = crop.shape[:2]
            if w_crop < self.cfg.min_crop_w or h_crop < self.cfg.min_crop_h or (w_crop * h_crop) < self.cfg.min_crop_area:
                logging.debug('Skipping crop por tamaño insuficiente: %dx%d', w_crop, h_crop)
                continue
            ratio = float(w_crop) / max(1.0, h_crop)
            if ratio < self.cfg.min_crop_ratio or ratio > self.cfg.max_crop_ratio:
                logging.debug('Skipping crop por ratio inusual: %.2f (w,h=%d,%d)', ratio, w_crop, h_crop)
                continue

            pil_crop = frame_to_pil(crop)
            touch_border = (x1c <= 1) or (y1c <= 1) or (x2c >= (w - 2)) or (y2c >= (h - 2))
            if touch_border:
                logging.debug('Skipping crop que toca borde del frame: bbox=(%d,%d,%d,%d)', x1c, y1c, x2c, y2c)
                if self.cfg.save_crops_dir:
                    try:
                        os.makedirs(self.cfg.save_crops_dir, exist_ok=True)
                        crop_edge_path = os.path.join(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_edge_{int(time.time())}.jpg')
                        pil_crop.save(crop_edge_path, format='JPEG', quality=80)
                    except Exception:
                        logging.exception('No se pudo guardar crop borde')
                continue

            t1 = time.time()
            plate_text, ocr_conf, char_confidences = ocr_plate(self.fast_ocr, pil_crop)
            dt_ocr = time.time() - t1
            logging.debug('OCR tardó %.1f ms (thread)', dt_ocr * 1000.0)

            if save_only_on_plate and (not plate_text or plate_text.strip() == ''):
                logging.debug('OCR vacío — no se guarda ni se envía evento (LPR_SAVE_ONLY_ON_PLATE)')
                continue

            try:
                plate_clean = re.sub(r'[_\s]+', '', plate_text).upper()
            except Exception:
                plate_clean = plate_text.strip().upper() if plate_text else ''

            plate_regex = os.environ.get('LPR_PLATE_REGEX', r'^[A-Z0-9]{3,8}$')
            try:
                valid_plate = bool(re.match(plate_regex, plate_clean)) if plate_clean else False
            except Exception:
                valid_plate = False

            if not valid_plate:
                logging.debug('Placa "%s" normalizada a "%s" no cumple regex %s — ignorando', plate_text, plate_clean, plate_regex)
                if self.cfg.save_crops_dir:
                    try:
                        os.makedirs(self.cfg.save_crops_dir, exist_ok=True)
                        crop_bad_path = os.path.join(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_bad_{int(time.time())}.jpg')
                        pil_crop.save(crop_bad_path, format='JPEG', quality=80)
                    except Exception:
                        logging.exception('No se pudo guardar crop malo')
                continue

            try:
                char_conf_list = [float(x) for x in (char_confidences or [])]
            except Exception:
                char_conf_list = []
            num_chars = len(char_conf_list)
            min_char_conf = float(min(char_conf_list)) if num_chars > 0 else 0.0
            mean_char_conf = float(sum(char_conf_list) / num_chars) if num_chars > 0 else 0.0
            min_char_thresh = float(os.environ.get('LPR_MIN_CHAR_CONF', '0.30'))
            if num_chars > 0:
                chars_above = sum(1 for v in char_conf_list if v >= min_char_thresh)
                chars_above_ratio = float(chars_above) / float(num_chars)
            else:
                chars_above_ratio = 0.0

            min_char_ratio_required = float(os.environ.get('LPR_MIN_CHAR_CONF_RATIO', '0.6'))
            if num_chars > 0 and chars_above_ratio < min_char_ratio_required:
                logging.debug('Placa "%s" rechazada por baja calidad por-char: mean=%.2f min=%.2f ratio=%.2f', plate_clean, mean_char_conf, min_char_conf, chars_above_ratio)
                if self.cfg.save_crops_dir:
                    try:
                        os.makedirs(self.cfg.save_crops_dir, exist_ok=True)
                        crop_lowq_path = os.path.join(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_lowq_{int(time.time())}.jpg')
                        pil_crop.save(crop_lowq_path, format='JPEG', quality=80)
                    except Exception:
                        logging.exception('No se pudo guardar crop lowq')
                continue

            now_ts = time.time()
            last_emitted = self.emitted_cache.get(plate_clean)
            if plate_clean and last_emitted and (now_ts - last_emitted) < dedup_seconds:
                logging.debug('Placa "%s" ya emitida hace %.1fs — saltando', plate_clean, now_ts - last_emitted)
                continue

            entry = self.plate_sightings.get(plate_clean)
            if entry is None:
                entry = {'first_seen': now_ts, 'count': 0, 'last_seen': now_ts}
            entry['count'] = entry.get('count', 0) + 1
            entry['last_seen'] = now_ts
            self.plate_sightings[plate_clean] = entry

            confirm_frames = int(os.environ.get('LPR_CONFIRM_FRAMES', '3'))
            confirm_seconds = float(os.environ.get('LPR_CONFIRM_SECONDS', '5.0'))
            confirmed = False
            if entry['count'] >= confirm_frames:
                confirmed = True
            elif (now_ts - entry['first_seen']) >= confirm_seconds and entry['count'] >= 1:
                confirmed = True

            if not confirmed:
                logging.debug('Placa "%s" vista %d veces; esperando confirmación (%d frames o %.1fs).', plate_clean, entry['count'], confirm_frames, confirm_seconds)
                if self.cfg.save_crops_dir:
                    try:
                        os.makedirs(self.cfg.save_crops_dir, exist_ok=True)
                        pending_path = os.path.join(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_pending_{int(time.time())}.jpg')
                        pil_crop.save(pending_path, format='JPEG', quality=85)
                    except Exception:
                        logging.exception('No se pudo guardar crop pending')
                continue

            if self.cfg.save_crops_dir:
                try:
                    os.makedirs(self.cfg.save_crops_dir, exist_ok=True)
                    crop_path = os.path.join(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_{int(time.time())}.jpg')
                    pil_crop.save(crop_path, format='JPEG', quality=85)
                except Exception:
                    logging.exception('No se pudo guardar crop final')

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
                'char_confidences': char_confidences,
                'char_conf_min': min_char_conf,
                'char_conf_mean': mean_char_conf,
                'char_conf_ratio': chars_above_ratio,
            }

            if self.cfg.save_frames_dir:
                try:
                    os.makedirs(self.cfg.save_frames_dir, exist_ok=True)
                    frame_annot = frame.copy()
                    for (bx1, by1, bx2, by2, bconf) in plates:
                        cv2.rectangle(frame_annot, (int(bx1), int(by1)), (int(bx2), int(by2)), (0, 255, 0), 2)
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
                det_thresh = float(os.environ.get('LPR_DET_CONF_THRESHOLD', str(self.det_high_conf)))
                ocr_thresh = float(os.environ.get('LPR_OCR_CONF_THRESHOLD', str(self.ocr_high_conf)))
                alpha = float(os.environ.get('LPR_COMBINED_ALPHA', '0.75'))
                combined = alpha * float(ocr_conf) + (1.0 - alpha) * float(conf)

                save_high = False
                if float(ocr_conf) >= ocr_thresh:
                    save_high = True
                elif float(conf) >= det_thresh and float(ocr_conf) >= 0.5:
                    save_high = True
                elif combined >= float(os.environ.get('LPR_COMBINED_THRESHOLD', str(self.cfg.combined_threshold))):
                    save_high = True

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
                            os.makedirs(self.cfg.save_crops_dir, exist_ok=True)
                            crop_path_h = os.path.join(self.cfg.save_crops_dir, f'{self.cfg.camera_id}_crop_high_{int(time.time())}.jpg')
                            pil_crop.save(crop_path_h, format='JPEG', quality=90)
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
            post_event(self.cfg, payload)



def env_or_arg(name: str, default: str = None) -> str:
    return os.environ.get(name, default)


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ('-h', '--help'):
        print('Uso: lpr_worker.py RTSP_URL CAMERA_ID BACKEND_URL [POLL_INTERVAL]')
        sys.exit(0)

    rtsp_url = env_or_arg('LPR_RTSP_URL', sys.argv[1] if len(sys.argv) > 1 else None)
    camera_id = env_or_arg('LPR_CAMERA_ID', sys.argv[2] if len(sys.argv) > 2 else 'cam-unknown')
    backend_url = env_or_arg('LPR_BACKEND_URL', sys.argv[3] if len(sys.argv) > 3 else 'http://127.0.0.1:3000/lpr/events')
    poll_interval = float(env_or_arg('LPR_POLL_INTERVAL', sys.argv[4] if len(sys.argv) > 4 else '1.0'))

    if not rtsp_url:
        print('RTSP URL requerida (argumento o env LPR_RTSP_URL)')
        sys.exit(2)

    dry = os.environ.get('LPR_DRY_RUN', '0') in ('1', 'true', 'True')
    cfg = LprConfig(rtsp_url=rtsp_url, camera_id=camera_id, backend_url=backend_url, poll_interval=poll_interval, dry_run=dry)
    # Allow overriding detector model via env var for quick tests (e.g. 'yolov8n.pt' or local path)
    cfg.detector_model = os.environ.get('LPR_DETECTOR_MODEL', cfg.detector_model)
    cfg.save_crops_dir = os.environ.get('LPR_SAVE_CROPS_DIR', '')
    run(cfg)


if __name__ == '__main__':
    main()
