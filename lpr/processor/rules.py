"""Reglas y utilidades para procesado de detecciones (plausibilidad, confirmación, scoring)."""
import re
import time
from lpr.settings import settings
from typing import List, Dict, Any, Tuple
import logging


def normalize_plate(text: str) -> str:
    try:
        return re.sub(r'[_\s]+', '', text).upper()
    except Exception:
        return (text or '').strip().upper()


def plausible_plate(plate_clean: str) -> bool:
    plate_regex = settings.LPR_PLATE_REGEX or r'^[A-Z0-9]{3,8}$'
    try:
        return bool(re.match(plate_regex, plate_clean)) if plate_clean else False
    except Exception:
        return False


def analyze_char_confidences(char_confidences: List[float]) -> Dict[str, Any]:
    num_chars = len(char_confidences)
    if num_chars == 0:
        return {'num_chars': 0, 'min': 0.0, 'mean': 0.0, 'ratio_above': 0.0}
    vals = [float(v) for v in char_confidences]
    min_v = min(vals)
    mean_v = sum(vals) / len(vals)
    thresh = float(settings.LPR_MIN_CHAR_CONF)
    above = sum(1 for v in vals if v >= thresh)
    ratio = float(above) / float(len(vals))
    return {'num_chars': len(vals), 'min': min_v, 'mean': mean_v, 'ratio_above': ratio}


def should_confirm(sightings: Dict[str, Dict[str, Any]], plate: str) -> Tuple[bool, Dict[str, Any]]:
    now_ts = time.time()
    entry = sightings.get(plate)
    if entry is None:
        return False, {'reason': 'no_sightings'}
    confirm_frames = int(settings.LPR_CONFIRM_FRAMES)
    confirm_seconds = float(settings.LPR_CONFIRM_SECONDS)
    if entry.get('count', 0) >= confirm_frames:
        return True, {'confirmed_by': 'frames'}
    if (now_ts - float(entry.get('first_seen', now_ts))) >= confirm_seconds and entry.get('count', 0) >= 1:
        return True, {'confirmed_by': 'seconds'}
    return False, {'reason': 'waiting', 'count': entry.get('count', 0)}


def should_save_or_emit(det_conf: float, ocr_conf: float, cfg_combined_threshold: float, det_thresh: float, ocr_thresh: float) -> bool:
    alpha = float(settings.LPR_COMBINED_ALPHA)
    combined = alpha * float(ocr_conf) + (1.0 - alpha) * float(det_conf)
    if float(ocr_conf) >= ocr_thresh:
        return True
    if float(det_conf) >= det_thresh and float(ocr_conf) >= 0.5:
        return True
    if combined >= float(settings.LPR_COMBINED_THRESHOLD or cfg_combined_threshold):
        return True
    return False
