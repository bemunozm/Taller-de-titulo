import cv2
import requests
import numpy as np
import sys
import time
import psutil
from ultralytics import YOLO
from pathlib import Path
from settings import settings

# Configuración desde settings
BACKEND_URL = settings.WORKER_BACKEND_URL
HEADERS = {}
if settings.WORKER_BACKEND_TOKEN:
    HEADERS['Authorization'] = f"Bearer {settings.WORKER_BACKEND_TOKEN}"

class CPUSmoother:
    def __init__(self, size=15):
        self.size = size
        self.buffer = []
    
    def update(self, val):
        self.buffer.append(val)
        if len(self.buffer) > self.size:
            self.buffer.pop(0)
        return sum(self.buffer) / len(self.buffer)

def debug_guardian(camera_id, video_path=None):
    print(f"--- Iniciando Depuración Visual para Cámara: {camera_id} ---")
    
    # 1. Obtener configuración de la cámara (Zonas)
    try:
        url_cam = f"{BACKEND_URL}/cameras/{camera_id}"
        resp_cam = requests.get(url_cam, headers=HEADERS, timeout=5)
        camera_data = resp_cam.json()
        
        url_zones = f"{BACKEND_URL}/anomalies/cameras/{camera_id}/zones"
        resp_zones = requests.get(url_zones, headers=HEADERS, timeout=5)
        zones_data = resp_zones.json().get('guardianZones', [])
        
        source_to_use = video_path
        if not source_to_use:
            url_source = f"{BACKEND_URL}/cameras/{camera_id}/source"
            resp_source = requests.get(url_source, headers=HEADERS, timeout=5)
            source_to_use = resp_source.json().get('sourceUrl')
        
        print(f"Origen de video: {source_to_use}")
        print(f"Zonas detectadas: {len(zones_data)}")
    except Exception as e:
        print(f"Error al conectar con el backend: {e}")
        return

    # 2. Inicializar YOLO y Detector de Movimiento
    print("Cargando modelo YOLO (v11n)...")
    model = YOLO('yolo11n.pt')
    back_sub = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=25, detectShadows=False)
    motion_pixel_threshold = 150 # Mismo que en worker

    # 3. Abrir Video
    cap = cv2.VideoCapture(source_to_use)
    if not cap.isOpened():
        print(f"Error: No se puede abrir el video: {source_to_use}")
        return

    cv2.namedWindow(f"VigiliA Debug SaaS - {camera_id}", cv2.WINDOW_NORMAL)

    print("--- Presiona 'q' para salir ---")
    
    video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frame_delay = 1.0 / video_fps
    last_frame_time = time.time()
    
    cpu_smoother = CPUSmoother(size=15)
    psutil.cpu_percent(interval=None)

    # Estabilidad de detecciones
    track_history = {} # track_id -> {'last_box': box, 'last_seen': time, 'hits': int}
    min_hits_threshold = 3
    
    ia_active = False
    last_ia_time = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Fin del video o error de lectura.")
            break
            
        now = time.time()
        h, w = frame.shape[:2]
        
        # --- DETECCION DE MOVIMIENTO (MOTION GATING) ---
        fg_mask = back_sub.apply(frame)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel)
        
        motion_detected = False
        if not zones_data:
            if np.count_nonzero(fg_mask) > motion_pixel_threshold:
                motion_detected = True
        else:
            for zone in zones_data:
                zone_mask = np.zeros_like(fg_mask)
                poly_pts = np.array([[p['x'] * w, p['y'] * h] for p in zone], dtype=np.int32)
                cv2.fillPoly(zone_mask, [poly_pts], 255)
                motion_in_zone = cv2.bitwise_and(fg_mask, zone_mask)
                if np.count_nonzero(motion_in_zone) > motion_pixel_threshold:
                    motion_detected = True
                    break
        
        # --- PROCESAMIENTO IA (SOLO SI HAY MOVIMIENTO) ---
        results = None
        inference_time = 0
        if motion_detected:
            start_ia = time.time()
            # imgsz=960 para SaaS balance
            results = model.track(frame, classes=[0], persist=True, tracker="bytetrack.yaml", verbose=False, imgsz=960, conf=0.20)
            inference_time = (time.time() - start_ia) * 1000
            ia_active = True
            last_ia_time = now
        else:
            if now - last_ia_time > 1.0: # Mantener estado "activo" visualmente 1 segundo
                ia_active = False

        raw_cpu = psutil.cpu_percent(interval=None)
        cpu_usage = cpu_smoother.update(raw_cpu)
        
        # --- DIBUJO ---
        # Dibujar Zonas
        for idx, zone in enumerate(zones_data):
            poly_pts = np.array([[p['x'] * w, p['y'] * h] for p in zone], dtype=np.int32)
            cv2.polylines(frame, [poly_pts], True, (255, 120, 0), 2)
            cv2.putText(frame, f"Zona {idx}", tuple(poly_pts[0]), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 120, 0), 2)

        active_tracks = set()
        if results and results[0].boxes:
            for box in results[0].boxes:
                if box.id is None: continue
                track_id = int(box.id.item())
                active_tracks.add(track_id)
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = float(box.conf.item())
                
                if track_id not in track_history:
                    track_history[track_id] = {'hits': 0}
                track_history[track_id].update({
                    'last_box': (x1, y1, x2, y2),
                    'last_seen': now,
                    'conf': conf,
                    'hits': track_history[track_id]['hits'] + 1
                })

        for tid, data in list(track_history.items()):
            if now - data['last_seen'] > 0.8:
                del track_history[tid]
                continue
            
            x1, y1, x2, y2 = data['last_box']
            conf = data.get('conf', 0)
            hits = data.get('hits', 0)
            is_stable = hits >= min_hits_threshold
            
            is_lost = tid not in active_tracks
            color = (150, 150, 150) if is_lost else (0, 255, 0)
            if not is_stable: color = (0, 255, 255) # Amarillo si es inestable
            
            # Dibujar BBox
            cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
            status = "STABLE" if is_stable else f"WAIT({hits}/{min_hits_threshold})"
            if is_lost: status = "LOST"
            cv2.putText(frame, f"ID:{tid} {conf:.2f} [{status}]", (int(x1), int(y1)-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
            
            # Puntos y colisión
            head = (int((x1 + x2) / 2), int(y1))
            center = (int((x1 + x2) / 2), int((y1 + y2) / 2))
            feet = (int((x1 + x2) / 2), int(y2))
            
            is_intrusion = False
            for p_idx, pt in enumerate([head, center, feet]):
                p_color = (0, 255, 255)
                for zone in zones_data:
                    poly_pts = np.array([[p['x'] * w, p['y'] * h] for p in zone], dtype=np.int32)
                    if cv2.pointPolygonTest(poly_pts, (float(pt[0]), float(pt[1])), False) >= 0:
                        p_color = (0, 0, 255)
                        if is_stable: is_intrusion = True
                cv2.circle(frame, pt, 4, p_color, -1)
            
            if is_intrusion:
                cv2.putText(frame, "!!! INTRUSION !!!", (int(x1), int(y2)+25), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

        # Performance Overlay
        status_color = (0, 255, 0) if ia_active else (100, 100, 100)
        status_text = "IA: ACTIVE" if ia_active else "IA: SLEEPING (No Motion)"
        cv2.putText(frame, status_text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, status_color, 2)
        cv2.putText(frame, f"Inf: {inference_time:.0f}ms | CPU: {cpu_usage:.1f}%", (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        # Pequeña ventana de la máscara de movimiento (SaaS Feel)
        small_mask = cv2.resize(fg_mask, (w // 4, h // 4))
        small_mask = cv2.cvtColor(small_mask, cv2.COLOR_GRAY2BGR)
        frame[h - (h // 4) - 10 : h - 10, w - (w // 4) - 10 : w - 10] = small_mask
        cv2.rectangle(frame, (w - (w // 4) - 10, h - (h // 4) - 10), (w - 10, h - 10), (255, 255, 255), 1)
        cv2.putText(frame, "Motion Sensor", (w - (w // 4) - 5, h - (h // 4) + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        cv2.imshow(f"VigiliA Debug SaaS - {camera_id}", frame)
        
        # Frame skipping
        elapsed = time.time() - last_frame_time
        frames_to_skip = int(elapsed / frame_delay) - 1
        for _ in range(max(0, frames_to_skip)): cap.grab()
        last_frame_time = time.time()

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python debug_visual_guardian.py <camera_id> [video_path]")
    elif len(sys.argv) == 2:
        debug_guardian(sys.argv[1])
    else:
        debug_guardian(sys.argv[1], sys.argv[2])
