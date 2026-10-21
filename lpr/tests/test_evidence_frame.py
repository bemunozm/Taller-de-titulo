"""Evidencia de una emision: el CUADRO de la mejor lectura del texto ganador, con su caja.

Bug que cubre: con la espera de direccion (E4) o el flush al detener, la emision
sale varios cuadros despues de leer la patente; anotar el cuadro del momento de
emitir con la caja de la lectura dejaba el recuadro lejos de la patente.
"""
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from lpr.processor.plate_tracker import MAX_EVIDENCE_TEXTS, PlateTracker, TrackObservation
from lpr.utils.direction import DirectionLine

LINE = DirectionLine(0.2, 0.5, 0.8, 0.5, 'right')
FRAME_SIZE = (1000, 1000)


def obs(x, text='BBCD12', ocr=0.9, det=0.8, frame=None, vehicle_id=None):
    return TrackObservation(box=(x, 300.0, x + 60.0, 330.0), text=text, ocr_conf=ocr, det_conf=det,
                            ref=f'ref@{x}', evidence=frame, vehicle_id=vehicle_id)


def feed(tr, items, start=0.0, step=0.1):
    out = []
    for i, o in enumerate(items):
        out += tr.update([o], now=start + i * step, frame_size=FRAME_SIZE)
    return out


# --------------------------------------------------------------------------
# La mejor lectura del texto ganador
# --------------------------------------------------------------------------
def test_la_emision_usa_el_cuadro_y_la_caja_de_la_mejor_lectura():
    tr = PlateTracker(confirm_reads=3)
    (em,) = feed(tr, [obs(100, ocr=0.80, frame='f0'), obs(200, ocr=0.95, frame='f1'),
                      obs(300, ocr=0.90, frame='f2')])
    assert em.evidence == 'f1'
    assert em.box == (200.0, 300.0, 260.0, 330.0) and em.best_ref == 'ref@200'


def test_empate_de_confianza_conserva_la_primera_evidencia():
    tr = PlateTracker(confirm_reads=3)
    (em,) = feed(tr, [obs(100, frame='f0'), obs(200, frame='f1'), obs(300, frame='f2')])
    assert em.evidence == 'f0' and em.box[0] == 100.0


def test_cambio_de_ganador_usa_la_mejor_evidencia_del_nuevo_ganador():
    tr = PlateTracker(confirm_reads=3)
    seq = [obs(100, 'BBCD12', 0.90, frame='fB0'), obs(150, 'BBCD12', 0.90, frame='fB1'),
           obs(200, 'BBCD13', 0.80, frame='fA0'), obs(250, 'BBCD13', 0.80, frame='fA1'),
           obs(300, 'BBCD13', 0.95, frame='fA2')]
    (em,) = feed(tr, seq)
    assert em.text == 'BBCD13'                      # el nuevo ganador adelanto al que iba primero
    assert em.evidence == 'fA2' and em.box[0] == 300.0     # y NO queda la del texto perdedor
    assert em.best_ref == 'ref@300'


def test_sin_evidencia_el_comportamiento_previo_se_conserva():
    tr = PlateTracker(confirm_reads=3)
    (em,) = feed(tr, [obs(100), obs(200, ocr=0.95), obs(300)])
    assert em.evidence is None and em.box[0] == 200.0 and em.best_ref == 'ref@200'


# --------------------------------------------------------------------------
# Emision tardia (espera de direccion) y flush
# --------------------------------------------------------------------------
BEFORE = [(0.0, 500.0, 300.0), (0.1, 500.0, 350.0), (0.2, 500.0, 400.0)]
CROSSED = BEFORE + [(0.3, 500.0, 550.0), (0.4, 500.0, 600.0)]


def waiting_tracker():
    return PlateTracker(confirm_reads=3, direction='both', direction_wait_seconds=4.0, direction_line=LINE)


def confirm_pending(tr):
    out = []
    for i, (x, conf) in enumerate(((100, 0.80), (200, 0.97), (300, 0.90))):
        out = tr.update([obs(x, ocr=conf, frame=f'f{i}', vehicle_id=5)], now=i * 0.1,
                        paths={5: BEFORE}, frame_size=FRAME_SIZE)
    return out


def test_emision_tardia_usa_la_evidencia_de_la_mejor_lectura_y_no_el_cuadro_actual():
    tr = waiting_tracker()
    assert confirm_pending(tr) == []                 # confirmada pero esperando la direccion
    # el auto sigue ahi: llegan cuadros nuevos (con otra posicion) mientras espera
    for t in (1.0, 2.0, 3.0):
        assert tr.update([obs(900, frame=f'late@{t}', vehicle_id=5)], now=t, paths={5: BEFORE},
                         frame_size=FRAME_SIZE) == []
    (em,) = tr.update([obs(950, frame='late@4.5', vehicle_id=5)], now=4.5, paths={5: BEFORE},
                      frame_size=FRAME_SIZE)
    assert em.evidence == 'f1' and em.box[0] == 200.0 and em.best_ref == 'ref@200'
    assert em.frame_box[0] == 950.0                  # la caja actual sigue disponible, pero no es la evidencia


def test_emision_tardia_por_cruce_de_la_linea_tambien():
    tr = waiting_tracker()
    confirm_pending(tr)
    (em,) = tr.update([], now=0.5, paths={5: CROSSED}, frame_size=FRAME_SIZE)
    assert em.direction_source == 'line' and em.evidence == 'f1'


def test_flush_usa_la_evidencia_guardada():
    tr = waiting_tracker()
    confirm_pending(tr)
    (em,) = tr.flush()
    assert em.evidence == 'f1' and em.box[0] == 200.0


def test_track_cerrado_por_gap_emite_con_su_evidencia():
    tr = waiting_tracker()
    confirm_pending(tr)
    (em,) = tr.update([], now=5.0, frame_size=FRAME_SIZE)       # se cerro mientras esperaba
    assert em.evidence == 'f1'


# --------------------------------------------------------------------------
# Memoria acotada
# --------------------------------------------------------------------------
def test_una_evidencia_por_texto_y_acotada_por_track():
    tr = PlateTracker(confirm_reads=50)              # nunca confirma: solo acumula
    texts = ['AAAA11', 'BBBB22', 'CCCC33', 'DDDD44', 'EEEE55', 'FFFF66']
    for i in range(60):
        tr.update([obs(100 + i, texts[i % 6], ocr=0.5 + (i % 7) / 20, frame=f'f{i}')], now=i * 0.05)
    (track,) = tr._tracks
    assert len(track.evidence) <= MAX_EVIDENCE_TEXTS
    assert all(isinstance(e.frame, str) for e in track.evidence.values())


def test_la_evidencia_solo_se_reemplaza_por_una_lectura_mejor_del_mismo_texto():
    tr = PlateTracker(confirm_reads=50)
    for i, conf in enumerate((0.7, 0.9, 0.8, 0.85)):
        tr.update([obs(100 + i, ocr=conf, frame=f'f{i}')], now=i * 0.1)
    (track,) = tr._tracks
    assert list(track.evidence) == ['BBCD12']
    assert track.evidence['BBCD12'].frame == 'f1'


def test_tras_emitir_se_liberan_los_cuadros_del_track():
    tr = PlateTracker(confirm_reads=3)
    feed(tr, [obs(100, frame='f0'), obs(200, frame='f1'), obs(300, frame='f2')])
    (track,) = tr._tracks
    assert track.done and track.evidence == {}


def test_un_track_emitido_no_vuelve_a_guardar_cuadros():
    tr = PlateTracker(confirm_reads=3)
    feed(tr, [obs(100, frame='f0'), obs(200, frame='f1'), obs(300, frame='f2')])
    feed(tr, [obs(310, frame='late')], start=1.0)
    (track,) = tr._tracks
    assert track.evidence == {}


# --------------------------------------------------------------------------
# Imagen guardada por el worker (de punta a punta)
# --------------------------------------------------------------------------
@pytest.fixture
def worker_env(tmp_path, monkeypatch):
    import importlib
    import sys
    import time
    import types

    from lpr.ocr.fast_ocr_adapter import OCRResult
    from lpr.settings import settings

    for name, attrs in (('ultralytics', {'YOLO': object}), ('huggingface_hub', {'hf_hub_download': lambda **_: None})):
        try:
            importlib.import_module(name)
        except ImportError:
            module = types.ModuleType(name)
            for key, value in attrs.items():
                setattr(module, key, value)
            monkeypatch.setitem(sys.modules, name, module)
    worker_module = importlib.import_module('lpr.processor.worker')
    for key, value in (('LPR_DEDUP_SECONDS', 120.0), ('LPR_PLATE_REGEX', None), ('LPR_INCLUDE_SNAPSHOT', False),
                       ('CLOUDINARY_UPLOAD', False)):
        monkeypatch.setattr(settings, key, value)
    posted = []
    monkeypatch.setattr(worker_module, 'post_event', lambda _u, payload, dry_run=False: posted.append(payload) or 200)
    clock = {'now': 1_000_000.0}
    monkeypatch.setattr(time, 'time', lambda: clock['now'])

    boxes = [(100, 100, 220, 140), (150, 100, 270, 140), (200, 100, 320, 140)]
    confs = [0.80, 0.99, 0.90]
    calls = {'n': 0}

    def detector(_frame, _min_conf):
        x1, y1, x2, y2 = boxes[min(calls['n'], 2)]
        return [SimpleNamespace(x1=x1, y1=y1, x2=x2, y2=y2, confidence=0.95)]

    def recognize(_arr):
        conf = confs[min(calls['n'], 2)]
        calls['n'] += 1
        return OCRResult('BBCD12', conf, [conf] * 6)

    cfg = SimpleNamespace(
        camera_id='cam-1', backend_url='http://backend.test', dry_run=True, min_det_conf=0.1, min_crop_w=1,
        max_crop_w=None, min_crop_h=1, min_crop_area=1, min_crop_ratio=0.1, max_crop_ratio=20.0, zone=None,
        detector_imgsz=640, confirm_reads=3, track_max_gap_seconds=1.5, direction='both', save_crops_dir=None,
        detections_dir=str(tmp_path), direction_line={'from': {'x': 0.2, 'y': 0.5}, 'to': {'x': 0.8, 'y': 0.5},
                                                      'exitSide': 'right'})

    class Vehicles:
        available = True

        def __init__(self):
            self._paths = {}

        def sync_line(self, _line):
            pass

        def update(self, _image, offset=(0, 0), now=None):
            self._paths.setdefault(7, []).append((now, 300.0, 200.0))   # quieto: nunca cruza (y=240)
            return [(7, (0.0, 0.0, 640.0, 200.0))]

        def paths(self):
            return self._paths

    worker = worker_module.LprWorker(cfg, detector, SimpleNamespace(recognize=recognize))
    worker.vehicle_tracker = Vehicles()
    yield SimpleNamespace(worker=worker, posted=posted, clock=clock)
    worker.executor.shutdown(wait=False)


def test_la_foto_guardada_es_la_de_la_mejor_lectura_y_el_recuadro_cae_sobre_su_patente(worker_env):
    w = worker_env
    markers = [40, 120, 200]                                     # cuadro i = gris constante distinto
    for i in range(3):
        w.clock['now'] = 1_000_000.0 + i * 0.125
        w.worker._process_frame(np.full((480, 640, 3), markers[i], dtype=np.uint8))
    assert w.posted == []                                        # esperando la direccion
    # Mucho despues el worker se detiene: el auto ya no esta donde se leyo la patente.
    w.clock['now'] = 1_000_010.0
    assert w.worker.flush_pending() == 1
    (payload,) = w.posted
    assert payload['meta']['bbox'] == [150, 100, 270, 140]       # caja de la mejor lectura (conf 0.99)
    image = cv2.imread(payload['full_frame_path'])
    assert abs(int(image[470, 5, 0]) - 120) <= 3                 # fondo = el cuadro de la mejor lectura
    b, g, r = (int(v) for v in image[120, 150])                  # borde izquierdo del recuadro amarillo
    assert b < 80 and g > 180 and r > 180
    other = image[120, 100]                                      # donde estaria la caja de otra lectura
    assert not (other[0] < 80 and other[1] > 180 and other[2] > 180)
