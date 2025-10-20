import logging
import cv2
from .config import load_from_env_or_args
from .detector.yolo_detector import load_detector, detect
from .ocr.fast_ocr_adapter import FastPlateOCR
from .processor.worker import LprWorker
from . import __name__ as pkgname


def main(rtsp_url=None, camera_id=None, backend_url=None, poll_interval=None):
    logging.basicConfig(level='INFO')
    cfg = load_from_env_or_args(rtsp_url, camera_id, backend_url, poll_interval)
    detector_inst = load_detector(cfg.detector_model)
    fast_ocr = FastPlateOCR()
    # detector_callable(frame, min_conf) -> List[Detection]
    detector_callable = lambda frame, min_conf=cfg.min_det_conf: detect(detector_inst, frame, min_conf)
    worker = LprWorker(cfg=cfg, detector=detector_callable, fast_ocr=fast_ocr)
    cap = cv2.VideoCapture(cfg.rtsp_url, cv2.CAP_FFMPEG)
    try:
        worker.start_capture_loop(cap)
    finally:
        cap.release()
