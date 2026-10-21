"""Read stage shared by the worker and the preview tool (`processor/pipeline.py`)."""
from types import SimpleNamespace

import numpy as np
import pytest

from lpr.ocr.fast_ocr_adapter import OCRResult
from lpr.processor import pipeline
from lpr.processor.pipeline import iter_plate_reads
from lpr.settings import settings


def _cfg(**over):
    base = dict(min_crop_w=30, min_crop_h=10, min_crop_area=300, min_crop_ratio=2.0, max_crop_ratio=12.0)
    base.update(over)
    return SimpleNamespace(**base)


def _det(x1, y1, x2, y2, conf=0.9):
    return SimpleNamespace(x1=x1, y1=y1, x2=x2, y2=y2, confidence=conf)


class _Ocr:
    def __init__(self, text='BBCD12', conf=0.9):
        self.calls = 0
        self._res = OCRResult(text, conf, [conf] * len(text))

    def recognize(self, _arr):
        self.calls += 1
        return self._res


@pytest.fixture(autouse=True)
def _default_regex(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_PLATE_REGEX', None)


FRAME = np.zeros((480, 640, 3), dtype=np.uint8)


def test_lectura_valida():
    ocr = _Ocr()
    (read,) = iter_plate_reads(FRAME, [_det(100, 100, 220, 140)], ocr, _cfg())
    assert read.status == pipeline.STATUS_OK and read.text == 'BBCD12'
    assert read.box == (100, 100, 220, 140) and read.shape_ok
    assert ocr.calls == 1


def test_forma_rechazada_no_corre_ocr_por_defecto():
    ocr = _Ocr()
    (read,) = iter_plate_reads(FRAME, [_det(100, 100, 148, 135)], ocr, _cfg())  # 48x35, ratio 1.4
    assert read.status == pipeline.STATUS_SHAPE_REJECTED and not read.shape_ok
    assert read.pil_crop is None and ocr.calls == 0


def test_diagnostico_lee_forma_rechazada_pero_nunca_la_da_por_valida():
    ocr = _Ocr()
    (read,) = iter_plate_reads(FRAME, [_det(100, 100, 148, 135)], ocr, _cfg(), diagnose_rejected=True)
    assert read.status == pipeline.STATUS_SHAPE_REJECTED
    assert read.text == 'BBCD12' and read.pil_crop is not None and ocr.calls == 1


def test_ocr_vacio_solo_distinto_con_save_only_on_plate():
    reads = list(iter_plate_reads(FRAME, [_det(100, 100, 220, 140)], _Ocr(text=''), _cfg(), save_only_on_plate=True))
    assert reads[0].status == pipeline.STATUS_OCR_EMPTY
    reads = list(iter_plate_reads(FRAME, [_det(100, 100, 220, 140)], _Ocr(text=''), _cfg()))
    assert reads[0].status == pipeline.STATUS_NOT_PLAUSIBLE


def test_texto_no_plausible():
    (read,) = iter_plate_reads(FRAME, [_det(100, 100, 220, 140)], _Ocr(text='AB'), _cfg())
    assert read.status == pipeline.STATUS_NOT_PLAUSIBLE


def test_normaliza_padding_y_mayusculas():
    (read,) = iter_plate_reads(FRAME, [_det(100, 100, 220, 140)], _Ocr(text='bbcd12__'), _cfg())
    assert read.text == 'BBCD12' and read.status == pipeline.STATUS_OK


def test_caja_se_recorta_a_los_limites_y_descarta_degeneradas():
    reads = list(iter_plate_reads(FRAME, [_det(-20, 400, 100, 600), _det(50, 50, 50, 90)], _Ocr(), _cfg()))
    assert len(reads) == 1 and reads[0].box == (0, 400, 100, 479)


def test_es_perezoso_como_el_worker():
    ocr = _Ocr()
    it = iter_plate_reads(FRAME, [_det(10, 10, 130, 50), _det(200, 10, 320, 50)], ocr, _cfg())
    next(it)
    assert ocr.calls == 1


def test_sin_ocr_no_falla():
    (read,) = iter_plate_reads(FRAME, [_det(100, 100, 220, 140)], None, _cfg())
    assert read.status == pipeline.STATUS_NOT_PLAUSIBLE and read.text == ''


# --- corrección de formato y tope de ancho ---------------------------------

def test_texto_se_corrige_por_posicion_y_queda_en_plate():
    (read,) = iter_plate_reads(FRAME, [_det(100, 100, 220, 140)], _Ocr(text='BBCDI2'), _cfg())
    assert read.status == pipeline.STATUS_OK
    assert read.text == 'BBCDI2' and read.plate == 'BBCD12'


def test_texto_que_no_es_patente_no_tiene_plate():
    (read,) = iter_plate_reads(FRAME, [_det(100, 100, 220, 140)], _Ocr(text='TURBO'), _cfg())
    assert read.status == pipeline.STATUS_NOT_PLAUSIBLE and read.plate is None


def test_ancho_maximo_del_recorte():
    ok, _ = pipeline.crop_shape_ok(_cfg(max_crop_w=250), 250, 60)
    too_wide, _ = pipeline.crop_shape_ok(_cfg(max_crop_w=250), 251, 60)
    unlimited, _ = pipeline.crop_shape_ok(_cfg(max_crop_w=None), 400, 100)
    no_attr, _ = pipeline.crop_shape_ok(_cfg(), 400, 100)  # cfg sin el campo = sin tope
    assert (ok, too_wide, unlimited, no_attr) == (True, False, True, True)


def test_ratio_bajo_pasa_con_el_filtro_de_la_camara_del_porton():
    # patente inclinada: caja casi cuadrada (ratio 1.33), el default global la descarta
    assert pipeline.crop_shape_ok(_cfg(), 56, 42)[0] is False
    assert pipeline.crop_shape_ok(_cfg(min_crop_ratio=0.8, max_crop_ratio=6.0), 56, 42)[0] is True


# --- zona de detección ------------------------------------------------------

ZONE_SQUARE = [[{'x': 0.25, 'y': 0.25}, {'x': 0.75, 'y': 0.25}, {'x': 0.75, 'y': 0.75}, {'x': 0.25, 'y': 0.75}]]


class _RecordingDetector:
    """Devuelve cajas en coordenadas del recorte que recibe."""

    def __init__(self, boxes):
        self.boxes = boxes
        self.calls = []

    def __call__(self, frame, min_conf, **kwargs):
        self.calls.append((frame.shape[:2], min_conf, kwargs))
        return [_det(*b) for b in self.boxes]


def _zone_cfg(**over):
    return _cfg(min_det_conf=0.3, detector_imgsz=1920, zone=ZONE_SQUARE, **over)


def test_sin_zona_detecta_sobre_el_frame_completo_sin_imgsz_extra():
    det = _RecordingDetector([(10, 10, 50, 30)])
    boxes = pipeline.detect_plates(det, FRAME, _cfg(min_det_conf=0.3))
    assert det.calls == [((480, 640), 0.3, {})]
    assert [(b.x1, b.y1) for b in boxes] == [(10, 10)]


def test_con_zona_detecta_sobre_el_rectangulo_envolvente_y_reproyecta():
    # envolvente 160..480 x 120..360 + 5 % de margen => origen (144, 108)
    rx, ry = 160 - 16, 120 - 12
    det = _RecordingDetector([(100, 100, 140, 120)])  # centro del recorte (120, 110)
    (box,) = pipeline.detect_plates(det, FRAME, _zone_cfg())
    (shape, min_conf, kwargs), = det.calls
    assert shape[0] < 480 and shape[1] < 640 and min_conf == 0.3
    assert (box.x1, box.y1, box.x2, box.y2) == (100 + rx, 100 + ry, 140 + rx, 120 + ry)
    assert box.confidence == 0.9
    # el imgsz se escala al recorte (mismo tamaño de pixel que a pantalla completa)
    assert kwargs['imgsz'] == pipeline.scaled_imgsz(1920, 640, shape[1])
    assert kwargs['imgsz'] < 1920


def test_con_zona_descarta_cajas_cuyo_centro_cae_fuera_del_poligono():
    # el poligono es un rombo: el rectangulo envolvente incluye las esquinas, que no son zona
    diamond = [[{'x': 0.5, 'y': 0.1}, {'x': 0.9, 'y': 0.5}, {'x': 0.5, 'y': 0.9}, {'x': 0.1, 'y': 0.5}]]
    inside = (270, 220, 310, 240)           # recorte; centro cerca del centro del frame
    corner = (0, 0, 20, 10)                 # esquina del recorte, fuera del rombo
    det = _RecordingDetector([inside, corner])
    boxes = pipeline.detect_plates(det, FRAME, _cfg(min_det_conf=0.3, detector_imgsz=640, zone=diamond))
    assert len(boxes) == 1 and boxes[0].x2 - boxes[0].x1 == 40


def test_zona_invalida_equivale_a_sin_zona():
    det = _RecordingDetector([])
    pipeline.detect_plates(det, FRAME, _cfg(min_det_conf=0.3, zone=[[{'x': 0.1, 'y': 0.1}]]))
    assert det.calls == [((480, 640), 0.3, {})]


def test_scaled_imgsz_mantiene_la_escala_y_es_multiplo_de_32():
    assert pipeline.scaled_imgsz(1920, 1920, 1920) == 1920
    assert pipeline.scaled_imgsz(1920, 1920, 960) == 960
    assert pipeline.scaled_imgsz(1920, 1920, 1037) == 1056
    assert pipeline.scaled_imgsz(640, 1920, 10) == 32


# --- process_frame: detección + lectura + seguimiento -----------------------

def test_process_frame_emite_al_n_esima_lectura_concordante():
    ocr = _Ocr(text='BBCDI2')
    cfg = _cfg(min_det_conf=0.3, zone=None, confirm_reads=3, track_max_gap_seconds=1.5, direction='unknown')
    tracker = pipeline.make_tracker(cfg)
    det = lambda frame, min_conf: [_det(100, 100, 220, 140)]
    results = [pipeline.process_frame(FRAME, det, ocr, cfg, tracker, now=0.1 * i) for i in range(3)]
    assert [len(em) for _reads, em in results] == [0, 0, 1]
    assert results[2][1][0].text == 'BBCD12'


def test_process_frame_forma_rechazada_no_alimenta_al_tracker():
    ocr = _Ocr()
    cfg = _cfg(min_det_conf=0.3, zone=None, confirm_reads=1, track_max_gap_seconds=1.5, direction='unknown')
    tracker = pipeline.make_tracker(cfg)
    det = lambda frame, min_conf: [_det(100, 100, 148, 135)]  # ratio 1.4: rechazada
    reads, emissions = pipeline.process_frame(FRAME, det, ocr, cfg, tracker, now=0.0)
    assert reads[0].status == pipeline.STATUS_SHAPE_REJECTED
    assert emissions == [] and tracker.active_tracks == 0


def test_deteccion_bloqueada_no_detecta_nada():
    det = _RecordingDetector([(10, 10, 50, 30)])
    assert pipeline.detect_plates(det, FRAME, _cfg(min_det_conf=0.3, detection_blocked=True)) == []
    assert det.calls == []   # ni siquiera se corre el detector


def test_make_tracker_usa_la_participacion_minima_de_la_config():
    cfg = _cfg(confirm_reads=3, track_max_gap_seconds=1.5, direction='unknown', min_winner_share=0.6)
    assert pipeline.make_tracker(cfg).min_winner_share == 0.6
