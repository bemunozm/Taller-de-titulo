"""Carga y validación de configuración desde variables de entorno y argumentos."""
from dataclasses import dataclass
import os
from typing import Optional


@dataclass
class LprConfig:
    rtsp_url: str
    camera_id: str
    backend_url: str
    poll_interval: float = 1.0
    ocr_device: str = 'cpu'
    detector_model: str = 'morsetechlab/yolov11-license-plate-detection'
    ocr_model: str = 'cct-s-v1-global-model'
    min_det_conf: float = 0.3
    dry_run: bool = True
    save_crops_dir: str = ''
    save_frames_dir: str = ''
    min_event_interval: float = 2.0
    detections_dir: str = 'detecciones'
    det_high_conf: float = 0.55
    ocr_high_conf: float = 0.98
    min_crop_w: int = 30
    min_crop_h: int = 10
    min_crop_area: int = 300
    min_crop_ratio: float = 2.0
    max_crop_ratio: float = 12.0
    force_save_on_ocr: bool = True
    combined_threshold: float = 0.3


def load_from_env_or_args(rtsp_url: Optional[str], camera_id: Optional[str], backend_url: Optional[str], poll_interval: Optional[float]) -> LprConfig:
    """Construye LprConfig a partir de env/args, usando valores por defecto cuando aplica."""
    rtsp = os.environ.get('LPR_RTSP_URL', rtsp_url)
    cam = os.environ.get('LPR_CAMERA_ID', camera_id or 'cam-unknown')
    backend = os.environ.get('LPR_BACKEND_URL', backend_url or 'http://127.0.0.1:3000/lpr/events')
    poll = float(os.environ.get('LPR_POLL_INTERVAL', str(poll_interval or 1.0)))
    dry = os.environ.get('LPR_DRY_RUN', '0') in ('1', 'true', 'True')
    cfg = LprConfig(rtsp_url=rtsp, camera_id=cam, backend_url=backend, poll_interval=poll, dry_run=dry)
    # permitir overrides
    cfg.detector_model = os.environ.get('LPR_DETECTOR_MODEL', cfg.detector_model)
    cfg.save_crops_dir = os.environ.get('LPR_SAVE_CROPS_DIR', cfg.save_crops_dir)
    cfg.save_frames_dir = os.environ.get('LPR_SAVE_FRAMES_DIR', cfg.save_frames_dir)
    return cfg
