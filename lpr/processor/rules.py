"""Reglas puras de lectura de patentes: normalización, formato y estadísticas de caracteres.

La confirmación (antes `should_confirm`, por conteo de textos) y el gate de
confianza (`should_save_or_emit`) se reemplazaron por el seguimiento + voto de
`plate_tracker.py`; la evidencia está en `tools/replay_eval.py`.
"""
import re
from lpr.processor.plate_format import correct_plate, is_valid_chilean_plate
from lpr.settings import settings
from typing import List, Dict, Any, Optional, Sequence, Tuple
import logging


def normalize_plate(text: str) -> str:
    try:
        return re.sub(r'[_\s]+', '', text).upper()
    except Exception:
        return (text or '').strip().upper()


def plausible_plate(plate_clean: str) -> bool:
    """Is `plate_clean` an acceptable plate as read (no correction)?

    Default: the Chilean format (`plate_format.is_valid_chilean_plate`). A
    non-empty `LPR_PLATE_REGEX` overrides it (e.g. to accept another country).
    """
    if not plate_clean:
        return False
    plate_regex = settings.LPR_PLATE_REGEX
    if not plate_regex:
        return is_valid_chilean_plate(plate_clean)
    try:
        return bool(re.match(plate_regex, plate_clean))
    except re.error:
        return False


def resolve_plate(plate_clean: str, char_confidences: Optional[Sequence[float]] = None) -> Optional[str]:
    """Final plate text for a normalized reading, or None if it is not a plate.

    With the default (Chilean) format the reading goes through the positional
    correction (0/O/D, 1/I/L, 2/Z, 5/S, 8/B...). With a `LPR_PLATE_REGEX`
    override the text is used as read (the override owns the format).
    """
    if not plate_clean:
        return None
    if settings.LPR_PLATE_REGEX:
        return plate_clean if plausible_plate(plate_clean) else None
    return correct_plate(plate_clean, char_confidences)


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
