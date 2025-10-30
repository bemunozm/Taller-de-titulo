from dataclasses import dataclass
from typing import List, Tuple
import numpy as np
import logging


@dataclass
class OCRResult:
    text: str
    confidence: float
    char_confidences: List[float]


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
        if self._inst is None:
            return OCRResult('', 0.0, [])
        try:
            res = self._inst.run(pil_arr, return_confidence=True)
            text = ''
            conf = 0.0
            char_conf = []
            if isinstance(res, tuple) and len(res) == 2:
                plates, conf_arr = res
                text = plates[0] if plates else ''
                try:
                    carr = np.array(conf_arr)
                    if carr.size == 0:
                        conf = 0.0
                    else:
                        row = carr[0] if carr.ndim == 2 else carr.ravel()
                        pad_chars = set(['_', ' '])
                        vals = []
                        for i, ch in enumerate(text):
                            if i < row.size and (ch not in pad_chars):
                                v = float(row[i])
                                vv = max(0.0, min(1.0, v))
                                vals.append(vv)
                                char_conf.append(vv)
                        conf = float(sum(vals) / len(vals)) if len(vals) > 0 else float(np.mean(row))
                except Exception:
                    logging.exception('Error parsing conf array')
            elif isinstance(res, (list, tuple)):
                plates = list(res)
                text = plates[0] if plates else ''
            else:
                try:
                    plates = list(res)
                    text = plates[0] if plates else ''
                except Exception:
                    text = str(res)
            conf = max(0.0, min(1.0, float(conf or 0.0)))
            return OCRResult(text.strip(), conf, char_conf)
        except Exception as e:
            logging.exception('Error fast-plate-ocr run: %s', e)
            return OCRResult('', 0.0, [])
