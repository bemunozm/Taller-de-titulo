from ultralytics import YOLO
from huggingface_hub import hf_hub_download
from typing import List, Tuple
import numpy as np
import logging


class Detection:
    def __init__(self, x1: int, y1: int, x2: int, y2: int, confidence: float):
        self.x1 = int(x1)
        self.y1 = int(y1)
        self.x2 = int(x2)
        self.y2 = int(y2)
        self.confidence = float(confidence)


def load_detector(model_ref: str):
    path = model_ref
    if '/' in model_ref:
        # intentar descargar checkpoint conocido
        candidates = [
            'license-plate-finetune-v1n.pt', 'license-plate-finetune-v1s.pt', 'license-plate-finetune-v1m.pt',
        ]
        for fn in candidates:
            try:
                logging.info('Intentando descargar %s from %s', fn, model_ref)
                p = hf_hub_download(repo_id=model_ref, filename=fn)
                path = p
                break
            except Exception:
                continue
    detector = YOLO(path)
    return detector


def detect(detector, frame: np.ndarray, min_conf: float = 0.3) -> List[Detection]:
    results = detector(frame)
    boxes: List[Detection] = []
    for res in results:
        if hasattr(res, 'boxes'):
            for box in res.boxes:
                conf = float(box.conf) if hasattr(box, 'conf') else 0.0
                if conf < min_conf:
                    continue
                xyxy = box.xyxy.cpu().numpy().astype(int)[0] if hasattr(box.xyxy, 'cpu') else np.array(box.xyxy).astype(int)
                x1, y1, x2, y2 = map(int, xyxy[:4])
                boxes.append(Detection(x1, y1, x2, y2, conf))
    return boxes
