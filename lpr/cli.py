import logging
from .settings import build_worker_config as load_from_env_or_args, settings
from .detector.yolo_detector import load_detector, detect
from .ocr.fast_ocr_adapter import FastPlateOCR
from .processor.worker import LprWorker
from .processor.guardian_worker import GuardianWorker
from .utils.capture import open_capture
from .utils.logging_setup import configure_logging
from . import __name__ as pkgname


def main(rtsp_url=None, camera_id=None, backend_url=None, poll_interval=None, mode=None):
    # Por defecto 'patente', si mode viene por parámetro, usarlo.
    cfg_mode = mode if mode else 'patente'
    cfg = load_from_env_or_args(rtsp_url, camera_id, backend_url, poll_interval, mode=cfg_mode)

    # Logging con rotación acotada, un archivo por cámara. `add_console=False`:
    # el manager redirige el stdout de este proceso a un log de bootstrap
    # acotado (solo para crashes de arranque) — duplicar aquí TODO el log iría
    # contra el objetivo de esta fase (ver utils/logging_setup.py).
    configure_logging('worker', camera_id=cfg.camera_id, add_console=False)

    if cfg.mode == 'guardia':
        worker = GuardianWorker(cfg=cfg)
    else:
        detector_inst = load_detector(cfg.detector_model)
        fast_ocr = FastPlateOCR()
        # detector_callable(frame, min_conf) -> List[Detection]
        detector_callable = lambda frame, min_conf=cfg.min_det_conf: detect(detector_inst, frame, min_conf)
        worker = LprWorker(cfg=cfg, detector=detector_callable, fast_ocr=fast_ocr)

    cap = open_capture(cfg.rtsp_url)
    try:
        worker.start_capture_loop(cap)
    finally:
        try:
            cap.release()
        except Exception:
            pass
