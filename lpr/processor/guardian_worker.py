import logging
import time
import os
import json
import cv2
import numpy as np
import concurrent.futures
from pathlib import Path
from ultralytics import YOLO

from lpr.utils.images import frame_to_pil, pil_to_base64
from lpr.api.client import post_event, post_anomaly
from lpr.settings import settings
import requests

class GuardianWorker:
    def __init__(self, cfg):
        self.cfg = cfg
        # Usamos YOLOv11 nano con alta resolución para detectar a lo lejos sin perder velocidad
        self.model = YOLO('yolo11n.pt') 
        self.sightings = {} # track_id -> {'first_seen': float, 'last_seen': float}
        
        max_workers = int(os.environ.get('LPR_MAX_WORKERS', '1'))
        try:
            self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        except Exception:
            self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self.processing_future = None
        self.detections_dir = getattr(self.cfg, 'detections_dir', 'detecciones')

        try:
            os.makedirs(self.detections_dir, exist_ok=True)
        except Exception:
            logging.exception('No se pudo crear detections_dir %s', self.detections_dir)
            
        self.loitering_seconds_threshold = 20.0 # Segundos para considerar merodeo
        self.emitted_cache = {} # track_id -> last_emitted_ts para no spamear
        
        # Heartbeat para visibilidad
        self.last_heartbeat = time.time()
        self.frame_count = 0
        
        # Zonas de intrusión
        self.guardian_zones = []
        self.zones_last_fetched = 0
        self._fetch_zones()

        # --- MEJORAS SAAS ---
        # 1. Motion Gating (MOG2)
        self.back_sub = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=25, detectShadows=False)
        self.motion_pixel_threshold = 150 # Área mínima de movimiento para "despertar" a la IA
        
        # 2. Estabilidad Temporal
        self.track_hits = {} # track_id -> total_frames_seen
        self.min_hits_threshold = 3 # Mínimo de frames para confiar en la detección
        
        # 3. Control de FPS (IA)
        self.target_ia_fps = 5.0
        self.last_ia_proc_time = 0

    def _fetch_zones(self):
        try:
            # Backend url normally ends with /api/v1... We need /anomalies/cameras/:id/zones
            base = self.cfg.backend_url.replace('/detections', '').rstrip('/')
            url = f"{base}/anomalies/cameras/{self.cfg.camera_id}/zones"
            resp = requests.get(url, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                logging.info(f"[VIGILIA-DEBUG] [ZONE-FETCH] Raw data received: {json.dumps(data)}")
                if data.get('enableGuardian') is False:
                    logging.warning('Guardián deshabilitado en BD para esta cámara.')
                
                # list of polygons (lists of dicts {x: float, y: float})
                zones = data.get('guardianZones', [])
                valid_zones = []
                for z in zones:
                    if len(z) >= 3:
                        valid_zones.append(z)
                self.guardian_zones = valid_zones
                self.zones_last_fetched = time.time()
                logging.info('Descargadas %d zonas de intrusión para %s', len(valid_zones), self.cfg.camera_id)
        except Exception as e:
            logging.error('Error obteniendo zonas del Guardián: %s', e)

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
                # Un FPS bajo es suficiente para tracking de personas/merodeo (ej: 2 a 5 FPS)
                if now - last_frame_ts < self.cfg.poll_interval:
                    time.sleep(0.005)
                    continue
                last_frame_ts = now
                self.frame_count += 1
                
                # Heartbeat cada 30 segundos
                if now - self.last_heartbeat > 30:
                    fps = self.frame_count / (now - self.last_heartbeat)
                    logging.info(f"[VIGILIA-DEBUG] --- [HEARTBEAT] {self.cfg.camera_id} - Procesando a {fps:.2f} FPS ---")
                    self.last_heartbeat = now
                    self.frame_count = 0

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
        now_ts = time.time()
        
        # --- CONTROL DE FPS (IA) ---
        # No procesamos IA más rápido de lo necesario (5 FPS es suficiente para seguridad)
        if now_ts - self.last_ia_proc_time < (1.0 / self.target_ia_fps):
            return
        
        # --- DETECCION DE MOVIMIENTO (MOTION GATING) ---
        # Convertimos a escala de grises y aplicamos MOG2 (muy rápido)
        fg_mask = self.back_sub.apply(frame)
        
        # Limpiar ruido de la máscara
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel)
        
        motion_detected = False
        h, w = frame.shape[:2]
        
        if not self.guardian_zones:
            # Si no hay zonas, cualquier movimiento grande despierta la IA
            if np.count_nonzero(fg_mask) > self.motion_pixel_threshold:
                motion_detected = True
        else:
            # Solo buscar movimiento dentro de las zonas definidas
            for zone in self.guardian_zones:
                # Crear máscara para la zona
                zone_mask = np.zeros_like(fg_mask)
                poly_pts = np.array([[p['x'] * w, p['y'] * h] for p in zone], dtype=np.int32)
                cv2.fillPoly(zone_mask, [poly_pts], 255)
                
                # Intersección: movimiento dentro de la zona
                motion_in_zone = cv2.bitwise_and(fg_mask, zone_mask)
                if np.count_nonzero(motion_in_zone) > self.motion_pixel_threshold:
                    motion_detected = True
                    break
        
        if not motion_detected:
            # Si no hay movimiento, saltamos la IA pesada (Ahorro masivo de CPU)
            return

        self.last_ia_proc_time = now_ts
        self.frame_count += 1
        
        # Opcional: Debug log de frame cada 100 frames
        if self.frame_count % 100 == 0:
            avg_color = np.mean(frame)
            logging.info(f"[VIGILIA-DEBUG] [FRAME-DEBUG] {self.cfg.camera_id} - IA Procesando (Movimiento detectado)")

        # classes=0 (sólo personas), persist=True (mantener IDs entre frames)
        # imgsz=960 es un buen balance entre velocidad y detección a lo lejos
        results = self.model.track(frame, classes=[0], persist=True, tracker="bytetrack.yaml", verbose=True, imgsz=960)
        
        if not results or not results[0].boxes:
            logging.info(f"[VIGILIA-DEBUG] [TRACK-DEBUG] No se detectaron personas en este frame.")
            # Limpiar track_hits para IDs que ya no se ven
            self.track_hits = {tid: hits for tid, hits in self.track_hits.items() if now_ts - self.sightings.get(tid, {}).get('last_seen', 0) < 5}
            return
            
        boxes = results[0].boxes
        logging.info(f"[VIGILIA-DEBUG] [TRACK-DEBUG] Detectadas {len(boxes)} personas.")
        
        # Iterar sobre las detecciones en este frame
        for i, box in enumerate(boxes):
            if box.id is None: continue
            
            track_id = int(box.id.item())
            conf = float(box.conf.item())
            
            # Limpiar sightins antiguos para no llenar RAM
            self._cleanup_sightings(now_ts)
            
            # Actualizar sightings y contador de frames (estabilidad)
            if track_id not in self.sightings:
                self.sightings[track_id] = {'first_seen': now_ts, 'last_seen': now_ts}
            else:
                self.sightings[track_id]['last_seen'] = now_ts
                
            self.track_hits[track_id] = self.track_hits.get(track_id, 0) + 1
            elapsed_seconds = now_ts - self.sightings[track_id]['first_seen']
            
            # REGLA 1: Intrusión de Zona
            intrusion_detected = False
            is_stable = self.track_hits[track_id] >= self.min_hits_threshold
            
            if self.guardian_zones:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                h, w = frame.shape[:2]
                
                points_to_check = [
                    ((x1 + x2) / 2.0, y1), # Cabeza
                    ((x1 + x2) / 2.0, (y1 + y2) / 2.0), # Centro
                    ((x1 + x2) / 2.0, y2)  # Pies
                ]

                for idx, zone in enumerate(self.guardian_zones):
                    poly_pts = np.array([[p['x'] * w, p['y'] * h] for p in zone], dtype=np.int32)
                    
                    for p_idx, pt in enumerate(points_to_check):
                        dist = cv2.pointPolygonTest(poly_pts, pt, True)
                        inside = dist >= 0
                        
                        if inside:
                            p_name = ["Cabeza", "Centro", "Pies"][p_idx]
                            logging.info(f"[VIGILIA-DEBUG-INTRUSION] Track:{track_id} Hits:{self.track_hits[track_id]} Pos:{p_name} Inside:True Stable:{is_stable}")
                            if is_stable:
                                intrusion_detected = True
                                break
                    if intrusion_detected: break
            
            # Decidir qué anomalía lanzar
            if intrusion_detected:
                logging.info(f"[VIGILIA-IA] 🚩 INTRUSION CONFIRMADA - Track:{track_id} (Hits:{self.track_hits[track_id]})")
                last_emitted = self.emitted_cache.get(f"intrusion_{track_id}", 0)
                if now_ts - last_emitted > 10: 
                    self._trigger_anomaly(frame, track_id, box, "intrusion", elapsed_seconds)
                    self.emitted_cache[f"intrusion_{track_id}"] = now_ts
                    
            elif elapsed_seconds > self.loitering_seconds_threshold and is_stable:
                last_emitted = self.emitted_cache.get(f"loitering_{track_id}", 0)
                if now_ts - last_emitted > 60: 
                    self._trigger_anomaly(frame, track_id, box, "loitering", elapsed_seconds)
                    self.emitted_cache[f"loitering_{track_id}"] = now_ts
                    
    def _trigger_anomaly(self, frame, track_id, box, anomaly_type, elapsed_seconds):
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        h, w = frame.shape[:2]
        x1c, y1c, x2c, y2c = max(0, int(x1)), max(0, int(y1)), min(w-1, int(x2)), min(h-1, int(y2))
        
        crop = frame[y1c:y2c, x1c:x2c]
        pil_crop = frame_to_pil(crop)
        
        conf = float(box.conf.item())
        
        now_ts = time.time()
        
        # Guardar disco
        det_fname = f'{self.cfg.camera_id}_anomaly_{anomaly_type}_{int(now_ts)}.jpg'
        det_path = os.path.join(self.detections_dir, det_fname)
        frame_det = frame.copy()
        
        try:
            cv2.rectangle(frame_det, (int(x1c), int(y1c)), (int(x2c), int(y2c)), (0, 0, 255), 3)
            label = f'P-{track_id} {anomaly_type} ({int(elapsed_seconds)}s)'
            cv2.putText(frame_det, label, (int(x1c), max(20, int(y1c) - 10)), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
            cv2.imwrite(det_path, frame_det)
        except Exception:
            logging.exception('Error anotando frame de anomalia')
            
        # Contexto Visual Enriquecido: Enviamos el frame completo con la anotación para que la IA vea el entorno
        snapshot_b64 = None
        if getattr(self.cfg, 'include_snapshot', True):
            try:
                # Usamos frame_det que ya tiene el recuadro dibujado
                snapshot_b64 = pil_to_base64(frame_to_pil(frame_det), quality=70)
            except Exception:
                logging.exception('Error convirtiendo full-frame anotado a B64')
                snapshot_b64 = pil_to_base64(pil_crop)

        meta = {
            'bbox': [int(x1c), int(y1c), int(x2c), int(y2c)],
            'snapshot_jpeg_b64': snapshot_b64,
            'anomaly_type': anomaly_type,
            'duration_seconds': int(elapsed_seconds),
            'track_id': track_id
        }
        
        # El ID puede venir con sufijo '_guardia' si es administrado por el manager. 
        # Lo limpiamos para que el backend asocie bien la cámara.
        clean_camera_id = self.cfg.camera_id.replace('_guardia', '')

        payload = {
            'cameraId': clean_camera_id,
            'anomalyType': anomaly_type,
            'confidence': conf,
            'meta': meta,
            'mountPath': self.cfg.rtsp_url,
            'detectionTimestamp': int(now_ts * 1000),
            'detection_path': det_path,
        }
        
        logging.info('[VIGILIA-IA] 🚨 REPORTANDO ANOMALIA: %s en %s (Real: %s). Tracker ID: %s', anomaly_type, self.cfg.camera_id, clean_camera_id, track_id)
        post_anomaly(self.cfg.backend_url, payload, dry_run=self.cfg.dry_run)
        
    def _cleanup_sightings(self, now_ts):
        # Eliminar items que no hemos visto en más de 30 segundos
        to_delete = []
        for tid, data in self.sightings.items():
            if now_ts - data['last_seen'] > 30:
                to_delete.append(tid)
        for tid in to_delete:
            del self.sightings[tid]
