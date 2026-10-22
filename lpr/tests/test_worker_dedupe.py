"""Emision por vehiculo y dedupe DESLIZANTE de `LprWorker` (seguimiento + voto).

El worker ya no cuenta textos: el `PlateTracker` asocia las lecturas de UN
vehiculo entre frames y emite una vez cuando N lecturas concuerdan. Encima
corre el dedupe de `LPR_DEDUP_SECONDS` por patente, que es deslizante (una
emision descartada refresca la marca) y solo se consume si el POST fue aceptado.

`processor/worker.py` importa `lpr.detector.yolo_detector`, que a su vez
importa `ultralytics` y `huggingface_hub` (no estan en CI, ver conftest.py).
Si faltan, se reemplazan por modulos vacios: el detector es un doble.
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
FRAME_STEP = 0.125  # 8 fps


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
    """Reloj controlado: `time.time()` del worker."""
    state = {'now': T0}
    monkeypatch.setattr(time, 'time', lambda: state['now'])
    return state


@pytest.fixture
def backend(worker_module, monkeypatch):
    """Doble del backend: guarda cada payload y responde con `statuses` (200 por defecto)."""
    state = SimpleNamespace(payloads=[], statuses=[])

    def fake_post(_url, payload, dry_run=False):
        state.payloads.append(payload)
        return state.statuses.pop(0) if state.statuses else 200

    monkeypatch.setattr(worker_module, 'post_event', fake_post)
    return state


@pytest.fixture
def worker(worker_module, tmp_path, monkeypatch):
    from lpr.detector.yolo_detector import Detection
    from lpr.ocr.fast_ocr_adapter import OCRResult

    monkeypatch.setattr(settings, 'LPR_DEDUP_SECONDS', DEDUP_SECONDS)
    monkeypatch.setattr(settings, 'LPR_PLATE_REGEX', None)
    monkeypatch.setattr(settings, 'LPR_INCLUDE_SNAPSHOT', False)
    monkeypatch.setattr(settings, 'CLOUDINARY_UPLOAD', False)
    # El seguimiento de vehiculos se crea siempre (voto por vehiculo): estos tests
    # parten SIN modelo (degradado) para no cargar ultralytics; los que lo necesitan
    # inyectan un doble en `worker.vehicle_tracker`.
    from lpr.processor.vehicle_tracker import VehicleTracker

    def no_weights(_ref):
        raise OSError('sin pesos')

    monkeypatch.setattr(worker_module, 'VehicleTracker',
                        lambda **kw: VehicleTracker(model_loader=no_weights, **kw))

    cfg = SimpleNamespace(
        camera_id='cam-1',
        backend_url='http://backend.test',
        dry_run=True,
        min_det_conf=0.1,
        min_crop_w=1,
        max_crop_w=None,
        min_crop_h=1,
        min_crop_area=1,
        min_crop_ratio=0.1,
        max_crop_ratio=20.0,
        zone=None,
        detector_imgsz=640,
        confirm_reads=3,
        track_max_gap_seconds=1.5,
        direction='both',
        save_crops_dir=None,
        detections_dir=str(tmp_path),
    )
    detector = lambda _frame, _min_conf: [Detection(100, 100, 300, 160, 0.95)]
    ocr = SimpleNamespace(recognize=lambda _arr: OCRResult(PLATE, 0.99, [0.99] * len(PLATE)))

    lpr_worker = worker_module.LprWorker(cfg, detector, ocr)
    yield lpr_worker
    lpr_worker.executor.shutdown(wait=False)


def _frame_at(worker, clock, seconds_after_t0):
    clock['now'] = T0 + seconds_after_t0
    worker._process_frame(np.zeros((480, 640, 3), dtype=np.uint8))


def _pass_at(worker, clock, start, frames=3):
    """Un vehiculo frente a la camara: `frames` lecturas seguidas a 8 fps."""
    for i in range(frames):
        _frame_at(worker, clock, start + i * FRAME_STEP)
    return start + (frames - 1) * FRAME_STEP


def _plates(backend):
    return [p['plate'] for p in backend.payloads]


def test_no_emite_antes_de_n_lecturas(worker, clock, backend):
    _pass_at(worker, clock, 0, frames=2)
    assert backend.payloads == []


def test_un_vehiculo_emite_una_sola_vez_aunque_siga_visible(worker, clock, backend):
    _pass_at(worker, clock, 0, frames=3)
    for i in range(3, 40):  # sigue frente a la camara
        _frame_at(worker, clock, i * FRAME_STEP)
    assert _plates(backend) == [PLATE]


def test_payload_lleva_direccion_y_track(worker, clock, backend):
    _pass_at(worker, clock, 0)
    (payload,) = backend.payloads
    meta = payload['meta']
    assert meta['direction'] in ('entry', 'exit', 'unknown')
    assert meta['track'] == {'id': 1, 'reads': 3, 'votes': 3, 'winner_share': 1.0, 'settled': False}
    assert meta['bbox'] == [100, 100, 300, 160]
    assert payload['cameraId'] == 'cam-1' and payload['plate_raw'] == PLATE


def test_pasadas_seguidas_no_reemiten_justo_despues_de_la_ventana_original(worker, clock, backend):
    _pass_at(worker, clock, 0)        # primera pasada: se emite
    _pass_at(worker, clock, 60)       # dentro de la ventana: descartada (refresca)
    _pass_at(worker, clock, 119)      # dentro de la ventana: descartada (refresca)
    # Justo despues de la ventana ORIGINAL (T0 + 120 s), pero a ~2 s de la
    # ultima lectura: el auto sigue ahi, no es un paso nuevo.
    _pass_at(worker, clock, DEDUP_SECONDS + 1)
    assert _plates(backend) == [PLATE]


def test_control_sin_pasadas_intermedias_reemite_pasada_la_ventana(worker, clock, backend):
    _pass_at(worker, clock, 0)
    _pass_at(worker, clock, DEDUP_SECONDS + 1)
    assert _plates(backend) == [PLATE, PLATE]


def test_reemite_cuando_la_patente_deja_de_verse_una_ventana_completa(worker, clock, backend):
    _pass_at(worker, clock, 0)                                   # emite
    end = _pass_at(worker, clock, 100)                           # descartada: la ventana corre desde aca
    _pass_at(worker, clock, end + DEDUP_SECONDS - 5)             # todavia dentro: descartada
    _pass_at(worker, clock, end + 2 * DEDUP_SECONDS)             # una ventana sin verla: emite
    assert _plates(backend) == [PLATE, PLATE]


def test_post_fallido_no_consume_el_dedupe(worker, clock, backend):
    backend.statuses = [500, -1]
    _pass_at(worker, clock, 0)        # POST 500
    _pass_at(worker, clock, 10)       # POST sin respuesta (-1)
    assert len(backend.payloads) == 2
    _pass_at(worker, clock, 20)       # POST 200: se emite y ahora si consume el dedupe
    assert len(backend.payloads) == 3
    _pass_at(worker, clock, 30)       # ya consumido: descartada
    assert len(backend.payloads) == 3


def test_post_con_error_de_cliente_tampoco_consume_el_dedupe(worker, clock, backend):
    backend.statuses = [422]
    _pass_at(worker, clock, 0)
    _pass_at(worker, clock, 10)
    assert len(backend.payloads) == 2


def test_dos_patentes_distintas_no_se_deduplican_entre_si(worker, clock, backend, monkeypatch):
    from lpr.ocr.fast_ocr_adapter import OCRResult

    _pass_at(worker, clock, 0)
    worker.fast_ocr = SimpleNamespace(recognize=lambda _a: OCRResult('KRZT45', 0.99, [0.99] * 6))
    _pass_at(worker, clock, 10)
    assert _plates(backend) == [PLATE, 'KRZT45']


def test_timeout_de_lectura_consume_el_dedupe_para_no_reabrir(worker, clock, backend):
    from lpr.api.client import STATUS_MAYBE_SENT

    backend.statuses = [STATUS_MAYBE_SENT]
    _pass_at(worker, clock, 0)         # el backend pudo haberlo procesado
    _pass_at(worker, clock, 10)        # misma patente: descartada, NO se vuelve a enviar
    assert len(backend.payloads) == 1


def test_request_que_no_llego_no_consume_el_dedupe(worker, clock, backend):
    from lpr.api.client import STATUS_NOT_SENT

    backend.statuses = [STATUS_NOT_SENT]
    _pass_at(worker, clock, 0)
    _pass_at(worker, clock, 10)
    assert len(backend.payloads) == 2


def test_los_logs_no_llevan_la_patente_real_pero_el_payload_si(worker, clock, backend, caplog):
    import logging

    with caplog.at_level(logging.DEBUG):
        _pass_at(worker, clock, 0)
        _pass_at(worker, clock, 10)    # duplicada: tambien se loguea
    assert backend.payloads[0]['plate'] == PLATE and backend.payloads[0]['plate_raw'] == PLATE
    assert PLATE not in caplog.text
    assert 'BB**12' in caplog.text


# --------------------------------------------------------------------------
# Direccion por linea + seguimiento de vehiculos (G1)
# --------------------------------------------------------------------------
LINE = {'from': {'x': 0.2, 'y': 0.5}, 'to': {'x': 0.8, 'y': 0.5}, 'exitSide': 'right'}  # bajar = salir


class _FakeVehicles:
    """Doble de `VehicleTracker`: un auto cuyo borde inferior sigue `bottoms`."""

    def __init__(self, bottoms, available=True):
        self.bottoms = list(bottoms)
        self.available = available
        self._paths = {}

    def sync_line(self, _line):
        pass

    def update(self, _image, offset=(0, 0), now=None):
        y2 = self.bottoms.pop(0) if self.bottoms else self.bottoms_last
        self.bottoms_last = y2
        self._paths.setdefault(7, []).append((now, 200.0, float(y2)))
        return [(7, (80.0, 60.0, 320.0, float(y2)))]

    def paths(self):
        return self._paths


def _with_line(worker, vehicles):
    from lpr.processor.pipeline import make_tracker

    worker.cfg = SimpleNamespace(**{**vars(worker.cfg), 'direction_line': LINE})
    worker.tracker = make_tracker(worker.cfg)
    worker.vehicle_tracker = vehicles
    return worker


def test_payload_lleva_direction_source(worker, clock, backend):
    _pass_at(worker, clock, 0)
    meta = backend.payloads[0]['meta']
    # camara 'both', sin linea y con la patente del mismo ancho en los 3 cuadros:
    # el ancho no muestra tendencia => ni direccion ni fuente.
    assert (meta['direction'], meta['direction_source']) == ('unknown', 'none')


def test_con_linea_la_emision_espera_el_cruce_y_lleva_vehicle_id(worker, clock, backend):
    _with_line(worker, _FakeVehicles([180, 200, 220, 300]))   # la linea esta en y=240 (cuadro de 480)
    _pass_at(worker, clock, 0, frames=3)
    assert backend.payloads == []                             # patente confirmada, sin direccion aun
    _frame_at(worker, clock, 3 * FRAME_STEP)                  # el auto cruza la linea
    (payload,) = backend.payloads
    meta = payload['meta']
    assert (meta['direction'], meta['direction_source']) == ('exit', 'line')
    assert meta['track']['vehicle_id'] == 7


def test_con_linea_sin_cruce_emite_al_vencer_la_espera(worker, clock, backend):
    _with_line(worker, _FakeVehicles([200]))                  # el auto no se mueve ni cruza (la caja contiene la patente)
    end = _pass_at(worker, clock, 0, frames=3)
    assert backend.payloads == []
    for step in range(1, 5):                                  # sigue a la vista 4 s mas
        _frame_at(worker, clock, end + step)
    (payload,) = backend.payloads
    assert payload['plate'] == PLATE
    # el auto no se movio (sin motion) y el ancho de la patente no cambio (sin width)
    assert (payload['meta']['direction'], payload['meta']['direction_source']) == ('unknown', 'none')


def test_si_el_modelo_de_vehiculos_no_carga_el_worker_sigue_emitiendo(worker, worker_module, clock, backend,
                                                                    monkeypatch):
    from lpr.processor.pipeline import make_tracker
    from lpr.processor.vehicle_tracker import VehicleTracker

    def boom(_ref):
        raise OSError('sin pesos')

    monkeypatch.setattr(worker_module, 'VehicleTracker',
                        lambda **kw: VehicleTracker(model_loader=boom, **kw))
    worker.cfg = SimpleNamespace(**{**vars(worker.cfg), 'direction_line': LINE})
    worker.tracker = make_tracker(worker.cfg)
    _pass_at(worker, clock, 0)
    assert worker.vehicle_tracker is not None and worker.vehicle_tracker.available is False
    (payload,) = backend.payloads
    assert (payload['meta']['direction'], payload['meta']['direction_source']) == ('unknown', 'none')


def test_sin_linea_tambien_se_crea_el_seguimiento_de_vehiculos(worker, clock, backend):
    # Premisa anterior: sin linea no se creaba. Ahora el voto es por vehiculo y el
    # seguimiento corre siempre; aqui sin pesos (fixture) queda degradado y se emite igual.
    _pass_at(worker, clock, 0)
    assert worker.vehicle_tracker is not None and worker.vehicle_tracker.available is False
    assert _plates(backend) == [PLATE]


def test_sin_linea_el_seguimiento_alimenta_el_voto_por_vehiculo(worker, clock, backend):
    worker.vehicle_tracker = _FakeVehicles([200])             # sin direction_line en la config
    _pass_at(worker, clock, 0, frames=3)
    (payload,) = backend.payloads
    assert payload['meta']['track']['vehicle_id'] == 7
    assert payload['meta']['track']['vehicle_uid'] == 7


def test_flush_al_detener_emite_la_patente_confirmada_que_esperaba_direccion(worker, clock, backend):
    _with_line(worker, _FakeVehicles([200]))                  # nunca cruza
    _pass_at(worker, clock, 0, frames=3)
    assert backend.payloads == []                             # esperando la direccion
    assert worker.flush_pending() == 1                        # el worker se detiene
    (payload,) = backend.payloads
    assert payload['plate'] == PLATE and payload['meta']['direction_source'] == 'none'
    assert payload['meta']['track']['vehicle_id'] == 7
    assert worker.flush_pending() == 0                        # no se emite dos veces
    assert len(backend.payloads) == 1


def test_flush_al_detener_sin_pendientes_no_hace_nada(worker, clock, backend):
    _pass_at(worker, clock, 0, frames=2)                      # ni siquiera confirmada
    assert worker.flush_pending() == 0 and backend.payloads == []


def test_el_bucle_de_captura_libera_los_pendientes_al_terminar(worker, clock, backend, monkeypatch):
    import signal
    monkeypatch.setattr(signal, "signal", lambda *a, **k: None)  # no tocar los handlers del proceso de pytest
    _with_line(worker, _FakeVehicles([200]))
    _pass_at(worker, clock, 0, frames=3)

    class _Cap:
        def read(self):
            raise KeyboardInterrupt                           # el proceso se detiene

    worker.start_settings_sync = lambda *a, **k: None
    with pytest.raises(KeyboardInterrupt):
        worker.start_capture_loop(_Cap())
    assert [p['plate'] for p in backend.payloads] == [PLATE]


def test_cambiar_sample_fps_reconfigura_el_mismo_tracker_sin_recargar_el_modelo(worker):
    class Byte:
        args = SimpleNamespace(track_buffer=24)
        max_time_lost = 24
        frame_id = 5

        def reset(self):
            self.frame_id = 0

    class FakeModel:
        predictor = SimpleNamespace(trackers=[Byte()])

        def track(self, *_a, **_k):
            return []

    from lpr.processor.vehicle_tracker import VehicleTracker

    model = FakeModel()
    tracker = VehicleTracker(model=model, sample_fps=8)
    byte = model.predictor.trackers[0]
    worker.vehicle_tracker = tracker
    same = SimpleNamespace(**{**vars(worker.cfg), 'sample_fps': 8.0})
    assert worker._ensure_vehicle_tracker(same) is tracker
    assert byte.frame_id == 5                                      # mismo buffer: no se toca
    other = SimpleNamespace(**{**vars(worker.cfg), 'sample_fps': 4.0})
    assert worker._ensure_vehicle_tracker(other) is tracker        # mismo objeto y mismo modelo
    assert tracker._model is model and model.predictor.trackers[0] is byte
    assert (byte.args.track_buffer, byte.max_time_lost, byte.frame_id) == (12, 12, 0)
    assert tracker.sample_fps == 4.0
