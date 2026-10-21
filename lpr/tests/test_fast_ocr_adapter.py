"""Adapter for fast-plate-ocr 1.x (`run()` returns `list[PlatePrediction]`).

The first block uses a double that mimics `PlatePrediction` (`.plate` with
optional `_` padding, `.char_probs` per slot or None), so it runs in CI where
fast-plate-ocr is not installed. The last test uses the real model and is
skipped when the package (or its model download) is unavailable.
"""
from types import SimpleNamespace

import numpy as np
import pytest

from lpr.ocr.fast_ocr_adapter import FastPlateOCR, OCRResult, prediction_to_result


def _pred(plate, probs):
    return SimpleNamespace(plate=plate, char_probs=None if probs is None else np.array(probs, dtype=np.float32))


def _ocr_with(run):
    ocr = FastPlateOCR.__new__(FastPlateOCR)  # skip model loading
    ocr._inst = SimpleNamespace(run=run)
    return ocr


def test_texto_sin_padding_y_confianza_solo_de_caracteres_reales():
    res = prediction_to_result(_pred('JTH153___', [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.99, 0.99, 0.99]))
    assert res.text == 'JTH153'
    assert res.char_confidences == pytest.approx([0.9, 0.8, 0.7, 0.6, 0.5, 0.4])
    assert res.confidence == pytest.approx(0.65)


def test_plate_sin_padding_ya_recortado_por_la_libreria():
    res = prediction_to_result(_pred('BBCD12', [1.0] * 9))
    assert res.text == 'BBCD12'
    assert len(res.char_confidences) == 6
    assert res.confidence == pytest.approx(1.0)


def test_padding_intermedio_y_espacios_se_ignoran():
    res = prediction_to_result(_pred('AB_C D', [0.5, 0.5, 0.1, 0.5, 0.1, 0.5]))
    assert res.text == 'ABCD'
    assert res.char_confidences == pytest.approx([0.5] * 4)


def test_confianza_acotada_a_0_1():
    res = prediction_to_result(_pred('AB', [1.7, -0.3]))
    assert res.char_confidences == [1.0, 0.0]
    assert 0.0 <= res.confidence <= 1.0


def test_sin_char_probs_devuelve_texto_con_confianza_cero():
    res = prediction_to_result(_pred('ABC123', None))
    assert res == OCRResult('ABC123', 0.0, [])


def test_char_probs_mas_cortas_que_el_texto_no_promedian_parcialmente():
    res = prediction_to_result(_pred('ABC123', [0.9, 0.9]))
    assert res.text == 'ABC123'
    assert res.confidence == 0.0 and res.char_confidences == []


def test_recognize_usa_la_primera_prediccion_y_pide_confianza():
    calls = []

    def run(arr, **kwargs):
        calls.append(kwargs)
        return [_pred('XY1234__', [0.8] * 8), _pred('OTRA', [0.1] * 4)]

    res = _ocr_with(run).recognize(np.zeros((35, 48, 3), dtype=np.uint8))
    assert calls == [{'return_confidence': True}]
    assert (res.text, res.confidence) == ('XY1234', pytest.approx(0.8))


def test_recognize_lista_vacia_da_resultado_vacio():
    assert _ocr_with(lambda *_a, **_k: []).recognize(np.zeros((8, 8, 3), np.uint8)) == OCRResult('', 0.0, [])


def test_recognize_error_se_loguea_y_devuelve_vacio(caplog):
    def run(*_a, **_k):
        raise RuntimeError('boom')

    with caplog.at_level('ERROR'):
        res = _ocr_with(run).recognize(np.zeros((8, 8, 3), np.uint8))
    assert res == OCRResult('', 0.0, [])
    assert 'Error fast-plate-ocr run' in caplog.text


def test_recognize_sin_modelo_cargado_devuelve_vacio():
    ocr = FastPlateOCR.__new__(FastPlateOCR)
    ocr._inst = None
    assert ocr.recognize(np.zeros((8, 8, 3), np.uint8)) == OCRResult('', 0.0, [])


def test_modelo_real_no_lanza_y_devuelve_str():
    pytest.importorskip('fast_plate_ocr')
    ocr = FastPlateOCR()
    if ocr._inst is None:
        pytest.skip('modelo fast-plate-ocr no disponible (sin red/cache)')
    rng = np.random.default_rng(0)
    res = ocr.recognize(rng.integers(0, 255, (35, 96, 3), dtype=np.uint8))
    assert isinstance(res.text, str) and '_' not in res.text
    assert 0.0 <= res.confidence <= 1.0
    assert len(res.char_confidences) in (0, len(res.text))
