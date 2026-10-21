from dataclasses import dataclass
from typing import Any, List
import numpy as np
import logging

_PAD_CHARS = frozenset('_ ')


@dataclass
class OCRResult:
    text: str
    confidence: float
    char_confidences: List[float]


def _empty_result() -> OCRResult:
    return OCRResult('', 0.0, [])


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def prediction_to_result(prediction: Any) -> OCRResult:
    """Convert a fast-plate-ocr 1.x `PlatePrediction` into an `OCRResult`.

    `prediction.plate` is the decoded text (it may carry `_` padding) and
    `prediction.char_probs` holds one probability per plate slot (or None when
    confidences were not requested). Padding never counts towards the text nor
    towards the confidence, otherwise the mostly-empty slots of a short plate
    would drag the mean around.
    """
    raw = str(getattr(prediction, 'plate', '') or '')
    probs = getattr(prediction, 'char_probs', None)
    row = np.asarray(probs, dtype=float).ravel() if probs is not None else np.empty(0)

    chars: List[str] = []
    char_conf: List[float] = []
    for i, ch in enumerate(raw):
        if ch in _PAD_CHARS:
            continue
        chars.append(ch)
        if i < row.size:
            char_conf.append(_clamp01(row[i]))

    text = ''.join(chars)
    # Without a confidence for every real character the mean would be
    # misleading: report 0.0 instead of averaging a partial list.
    if text and len(char_conf) == len(chars):
        confidence = _clamp01(sum(char_conf) / len(char_conf))
    else:
        confidence = 0.0
        char_conf = []
    return OCRResult(text, confidence, char_conf)


class FastPlateOCR:
    def __init__(self, model_name: str = 'cct-s-v1-global-model', device: str = 'cpu'):
        try:
            import importlib
            mod = importlib.import_module('fast_plate_ocr')
            LicensePlateRecognizer = getattr(mod, 'LicensePlateRecognizer', None)
            if LicensePlateRecognizer is None:
                raise ImportError('LicensePlateRecognizer no encontrada en fast_plate_ocr')
            self._inst = LicensePlateRecognizer(model_name, device=device)
        except Exception as e:
            logging.exception('No se pudo inicializar fast-plate-ocr: %s', e)
            self._inst = None

    def recognize(self, pil_arr) -> OCRResult:
        """Read one plate crop. Requires fast-plate-ocr>=1.0 (list[PlatePrediction])."""
        if self._inst is None:
            return _empty_result()
        try:
            predictions = self._inst.run(pil_arr, return_confidence=True)
            if not predictions:
                return _empty_result()
            return prediction_to_result(predictions[0])
        except Exception as e:
            logging.exception('Error fast-plate-ocr run: %s', e)
            return _empty_result()
