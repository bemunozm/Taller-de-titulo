"""Dedupe DESLIZANTE de `LprWorker._process_frame` (Fase 4 · P3).

Una lectura descartada por dedupe refresca la marca de la patente: la ventana
`LPR_DEDUP_SECONDS` corre desde la ÚLTIMA lectura, no desde la emisión. Así un
auto detenido frente a la cámara no vuelve a emitir cada 120 s (el backend no
sabe si una lectura es entrada o salida: cada re-emisión era un paso nuevo).

`processor/worker.py` importa `lpr.detector.yolo_detector`, que a su vez
importa `ultralytics` y `huggingface_hub` (dependencias de visión que no están
en esta máquina de desarrollo, ver conftest.py). Si faltan, se reemplazan por
módulos vacíos: el test no usa YOLO, el detector es un doble.
"""
import importlib
import sys
import time
import types
from types import SimpleNamespace

import numpy as np
import pytest

from lpr.settings import settings

PLATE = 'BBCD12'
DEDUP_SECONDS = 120.0
T0 = 1_000_000.0


def _stub_missing_module(monkeypatch, name, **attrs):
    try:
        importlib.import_module(name)
    except ImportError:
        module = types.ModuleType(name)
        for key, value in attrs.items():
            setattr(module, key, value)
        monkeypatch.setitem(sys.modules, name, module)


@pytest.fixture
def worker_module(monkeypatch):
    _stub_missing_module(monkeypatch, 'ultralytics', YOLO=object)
    _stub_missing_module(monkeypatch, 'huggingface_hub', hf_hub_download=lambda **_: None)
    return importlib.import_module('lpr.processor.worker')


@pytest.fixture
def clock(monkeypatch):
    """Reloj controlado: `time.time()` del worker y de `rules` (mismo módulo)."""
    state = {'now': T0}
    monkeypatch.setattr(time, 'time', lambda: state['now'])
    return state


@pytest.fixture
def emitted(worker_module, monkeypatch):
    """Patentes que el worker envió al backend (`post_event`)."""
    events = []
    monkeypatch.setattr(worker_module, 'post_event',
                        lambda _url, payload, dry_run=False: events.append(payload['plate']))
    return events


@pytest.fixture
def worker(worker_module, tmp_path, monkeypatch):
    from lpr.detector.yolo_detector import Detection
    from lpr.ocr.fast_ocr_adapter import OCRResult

    # Confirmación en un frame y lectura de alta confianza: el único filtro
    # que decide si se emite es el dedupe.
    monkeypatch.setattr(settings, 'LPR_DEDUP_SECONDS', DEDUP_SECONDS)
    monkeypatch.setattr(settings, 'LPR_CONFIRM_FRAMES', 1)
    monkeypatch.setattr(settings, 'LPR_PLATE_REGEX', None)
    monkeypatch.setattr(settings, 'LPR_INCLUDE_SNAPSHOT', False)
    monkeypatch.setattr(settings, 'CLOUDINARY_UPLOAD', False)

    cfg = SimpleNamespace(
        camera_id='cam-1',
        backend_url='http://backend.test',
        dry_run=True,
        min_det_conf=0.1,
        min_crop_w=1,
        min_crop_h=1,
        min_crop_area=1,
        min_crop_ratio=0.1,
        max_crop_ratio=20.0,
        save_crops_dir=None,
        det_high_conf=0.5,
        ocr_high_conf=0.5,
        combined_threshold=0.3,
        min_event_interval=0,
        detections_dir=str(tmp_path),
    )
    detector = lambda _frame, _min_conf: [Detection(100, 100, 300, 160, 0.95)]
    ocr = SimpleNamespace(recognize=lambda _arr: OCRResult(PLATE, 0.99, [0.99] * len(PLATE)))

    lpr_worker = worker_module.LprWorker(cfg, detector, ocr)
    yield lpr_worker
    lpr_worker.executor.shutdown(wait=False)


def _read_at(worker, clock, seconds_after_t0):
    clock['now'] = T0 + seconds_after_t0
    worker._process_frame(np.zeros((480, 640, 3), dtype=np.uint8))


def test_lecturas_continuas_no_reemiten_justo_despues_de_la_ventana_original(worker, clock, emitted):
    _read_at(worker, clock, 0)      # primera lectura: se emite
    _read_at(worker, clock, 60)     # dentro de la ventana: descartada (refresca)
    _read_at(worker, clock, 119)    # dentro de la ventana: descartada (refresca)
    # Justo después de la ventana ORIGINAL (T0 + 120 s), pero a 2 s de la
    # última lectura: el auto sigue ahí, no es un paso nuevo.
    _read_at(worker, clock, DEDUP_SECONDS + 1)

    assert emitted == [PLATE]


def test_control_sin_lecturas_intermedias_reemite_pasada_la_ventana(worker, clock, emitted):
    _read_at(worker, clock, 0)
    _read_at(worker, clock, DEDUP_SECONDS + 1)

    assert emitted == [PLATE, PLATE]


def test_reemite_cuando_la_patente_deja_de_verse_una_ventana_completa(worker, clock, emitted):
    _read_at(worker, clock, 0)      # emite
    _read_at(worker, clock, 100)    # descartada: la ventana corre desde acá
    _read_at(worker, clock, 100 + DEDUP_SECONDS - 1)  # todavía dentro: descartada
    _read_at(worker, clock, 100 + DEDUP_SECONDS - 1 + DEDUP_SECONDS)  # una ventana sin verla: emite

    assert emitted == [PLATE, PLATE]
