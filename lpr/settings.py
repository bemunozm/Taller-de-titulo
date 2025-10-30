from pathlib import Path
from typing import Optional
from types import SimpleNamespace
from pydantic import BaseModel, Field
try:
    # pydantic v2+: BaseSettings moved to pydantic-settings package
    from pydantic import BaseSettings  # type: ignore
except Exception:
    try:
        from pydantic_settings import BaseSettings  # type: ignore
    except Exception:
        # fallback: try older pydantic import (v1)
        from pydantic import BaseSettings  # type: ignore


class Settings(BaseSettings):
    # Manager / backend
    WORKER_BACKEND_URL: Optional[str] = Field(None, min_length=1)
    WORKER_BACKEND_TOKEN: Optional[str] = None
    WORKER_MANAGER_SECRET: Optional[str] = None
    WORKER_MANAGER_PORT: int = 8000
    WORKER_MANAGER_HOST: str = '0.0.0.0'
    WORKER_MANAGER_RELOAD: bool = False
    WORKER_MANAGER_WORKERS: int = 1

    # LPR worker
    LPR_RTSP_URL: Optional[str] = None
    LPR_CAMERA_ID: Optional[str] = None
    LPR_BACKEND_URL: Optional[str] = None
    LPR_POLL_INTERVAL: float = Field(1.0, gt=0)
    LPR_DRY_RUN: bool = False
    LPR_DETECTOR_MODEL: str = 'morsetechlab/yolov11-license-plate-detection'
    LPR_OCR_MODEL: str = 'cct-s-v1-global-model'
    LPR_MIN_DET_CONF: float = 0.3
    LPR_DETECTIONS_DIR: str = './lpr/detecciones'
    LPR_SAVE_CROPS_DIR: str = './lpr/detecciones/crops'
    LPR_SAVE_FRAMES_DIR: str = './lpr/detecciones/frames'
    LPR_DET_HIGH_CONF: float = 0.55
    LPR_OCR_HIGH_CONF: float = 0.98
    LPR_MIN_EVENT_INTERVAL: float = 2.0
    LPR_FORCE_SAVE_ON_OCR: bool = True
    LPR_SAVE_ONLY_ON_PLATE: bool = True
    LPR_MIN_CHAR_CONF_RATIO: float = 0.6
    LPR_DEDUP_SECONDS: float = 10.0
    LPR_DET_CONF_THRESHOLD: float = 0.55
    LPR_OCR_CONF_THRESHOLD: float = 0.98
    LPR_CONFIRM_FRAMES: int = 3
    LPR_CONFIRM_SECONDS: float = 5.0
    LPR_COMBINED_ALPHA: float = 0.75
    LPR_COMBINED_THRESHOLD: float = 0.3
    # plate regex may be empty in .env; treat empty as unset/None
    LPR_PLATE_REGEX: Optional[str] = None
    LPR_MIN_CHAR_CONF: float = Field(0.30, ge=0, le=1)
    LPR_INCLUDE_SNAPSHOT: bool = True
    LPR_WORKER_TOKEN: Optional[str] = None

    # Cloudinary
    CLOUDINARY_CLOUD_NAME: Optional[str] = None
    CLOUDINARY_API_KEY: Optional[str] = None
    CLOUDINARY_API_SECRET: Optional[str] = None
    CLOUDINARY_UPLOAD: bool = False
    CLOUDINARY_DELETE_LOCAL: bool = False
    CLOUDINARY_UPLOAD_RETRIES: int = 3
    CLOUDINARY_RETRY_BACKOFF: float = 1.0

    class Config:
        env_file = str(Path(__file__).parent / '.env')
        env_file_encoding = 'utf-8'

    # validators in BaseSettings are easier in pydantic v2 via model_validators;
    # keep simple helper that resolves relative paths when Settings is created.
    def model_post_init(self, __context):  # pydantic v2 hook
        # resolve commonly used directories to absolute paths relative to package
        pkg_dir = Path(__file__).parent
        project_root = pkg_dir.parent

        def _resolve(p: Optional[str]) -> Optional[str]:
            if not p:
                return p
            pth = Path(p)
            if pth.is_absolute():
                return str(pth)
            s = str(p).lstrip('./\\')
            first = Path(s).parts[0] if Path(s).parts else ''
            if first == 'lpr':
                return str((project_root / Path(s)).resolve())
            return str((pkg_dir / Path(s)).resolve())

        # mutate self in-place (acceptable for settings bootstrap)
        try:
            self.LPR_DETECTIONS_DIR = _resolve(self.LPR_DETECTIONS_DIR)
            self.LPR_SAVE_CROPS_DIR = _resolve(self.LPR_SAVE_CROPS_DIR)
            self.LPR_SAVE_FRAMES_DIR = _resolve(self.LPR_SAVE_FRAMES_DIR)
        except Exception:
            # non-fatal: leave values as-is
            pass


settings = Settings()


# Compatibility: lightweight worker config builder moved here so
# all configuration logic is centralized in settings.py. This replaces the
# previous lpr/config.py implementation. We return a SimpleNamespace instead
# of a dedicated dataclass to keep the public API minimal.
import os


class WorkerConfig(BaseModel):
    rtsp_url: Optional[str] = Field(None)
    camera_id: Optional[str] = Field(None, min_length=1)
    backend_url: Optional[str] = Field(None, min_length=1)
    poll_interval: float = Field(1.0, gt=0)
    ocr_device: str = Field('cpu', min_length=1)
    detector_model: str = Field('morsetechlab/yolov11-license-plate-detection', min_length=1)
    ocr_model: str = Field('cct-s-v1-global-model', min_length=1)
    min_det_conf: float = Field(0.3, ge=0, le=1)
    dry_run: bool = True
    save_crops_dir: Optional[str] = Field('', description='path to save crop images')
    save_frames_dir: Optional[str] = Field('', description='path to save frames')
    min_event_interval: float = Field(2.0, gt=0)
    detections_dir: str = Field('detecciones', min_length=1)
    det_high_conf: float = Field(0.55, ge=0, le=1)
    ocr_high_conf: float = Field(0.98, ge=0, le=1)
    min_crop_w: int = Field(30, ge=0)
    min_crop_h: int = Field(10, ge=0)
    min_crop_area: int = Field(300, ge=0)
    min_crop_ratio: float = Field(2.0, gt=0)
    max_crop_ratio: float = Field(12.0, gt=0)
    force_save_on_ocr: bool = True
    combined_threshold: float = Field(0.3, ge=0, le=1)


def build_worker_config(rtsp_url: Optional[str], camera_id: Optional[str], backend_url: Optional[str], poll_interval: Optional[float]) -> WorkerConfig:
    """Construye LprConfig a partir de los valores en `settings` y argumentos.

    Esta función mantiene la resolución de rutas relativas respecto al repo
    y al paquete `lpr` para compatibilidad con el código existente.
    """
    rtsp = rtsp_url if rtsp_url is not None else settings.LPR_RTSP_URL
    cam = camera_id if camera_id is not None else settings.LPR_CAMERA_ID
    if not cam:
        cam = 'cam-unknown'
    backend = settings.LPR_BACKEND_URL or backend_url or settings.WORKER_BACKEND_URL or 'http://127.0.0.1:3000/lpr/events'
    poll = float(settings.LPR_POLL_INTERVAL or (poll_interval or 1.0))
    dry = bool(settings.LPR_DRY_RUN)
    # build a WorkerConfig pydantic model with the expected attributes
    cfg = WorkerConfig(
        rtsp_url=rtsp,
        camera_id=cam,
        backend_url=backend,
        poll_interval=poll,
        ocr_device='cpu',
        detector_model=(settings.LPR_DETECTOR_MODEL or 'morsetechlab/yolov11-license-plate-detection'),
        ocr_model=(settings.LPR_OCR_MODEL or 'cct-s-v1-global-model'),
        min_det_conf=settings.LPR_MIN_DET_CONF or 0.3,
        dry_run=dry,
        save_crops_dir=(settings.LPR_SAVE_CROPS_DIR or ''),
        save_frames_dir=(settings.LPR_SAVE_FRAMES_DIR or ''),
        min_event_interval=settings.LPR_MIN_EVENT_INTERVAL,
        detections_dir=(settings.LPR_DETECTIONS_DIR or 'detecciones'),
        det_high_conf=settings.LPR_DET_HIGH_CONF,
        ocr_high_conf=settings.LPR_OCR_HIGH_CONF,
        min_crop_w=30,
        min_crop_h=10,
        min_crop_area=300,
        min_crop_ratio=2.0,
        max_crop_ratio=12.0,
        force_save_on_ocr=settings.LPR_FORCE_SAVE_ON_OCR,
        combined_threshold=settings.LPR_COMBINED_THRESHOLD,
    )

    pkg_dir = Path(__file__).parent
    project_root = pkg_dir.parent

    def _resolve_path(p: Optional[str]) -> Optional[str]:
        if not p:
            return p
        path = Path(p)
        if path.is_absolute():
            return str(path)
        s = str(p).lstrip('./\\')
        first_part = Path(s).parts[0] if Path(s).parts else ''
        if first_part == 'lpr':
            return str((project_root / Path(s)).resolve())
        return str((pkg_dir / Path(s)).resolve())

    cfg.detections_dir = _resolve_path(settings.LPR_DETECTIONS_DIR or cfg.detections_dir)
    cfg.save_crops_dir = _resolve_path(settings.LPR_SAVE_CROPS_DIR or cfg.save_crops_dir)
    cfg.save_frames_dir = _resolve_path(settings.LPR_SAVE_FRAMES_DIR or cfg.save_frames_dir)
    return cfg
