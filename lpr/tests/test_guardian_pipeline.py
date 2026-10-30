"""Camino por frame del Guardián (`guardian_pipeline.py`) y worker refactorizado.

Sin GPU ni ultralytics: el modelo es un doble que devuelve cajas con la forma de
los resultados de `model.track`, y el sustractor MOG2 se reemplaza por uno falso
donde hace falta controlar el movimiento.
"""
import importlib
import sys
import threading
import types
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from lpr.processor import guardian_pipeline as gp
from lpr.processor.guardian_rules import GuardianConfig, GuardianRules, parse_guardian_zones

FRAME = np.zeros((1000, 1000, 3), dtype=np.uint8)
SQUARE = [{'x': 0.4, 'y': 0.4}, {'x': 0.6, 'y': 0.4}, {'x': 0.6, 'y': 0.6}, {'x': 0.4, 'y': 0.6}]
IN_ZONE = (480.0, 420.0, 520.0, 580.0)


class FakeSubtractor:
    """Devuelve una máscara con `motion_pixels` píxeles en blanco dentro de la zona del cuadro."""

    def __init__(self):
        self.motion_pixels = 0

    def apply(self, frame):
        mask = np.zeros(frame.shape[:2], dtype=np.uint8)
        if self.motion_pixels:
            side = int(self.motion_pixels ** 0.5) + 1
            mask[450:450 + side, 450:450 + side] = 255
        return mask


class FakeBoxes:
    def __init__(self, items):
        self.items = items

    def __len__(self):
        return len(self.items)

    def __iter__(self):
        return iter(self.items)


def fake_box(tid, bbox, conf=0.9):
    return SimpleNamespace(
        id=None if tid is None else SimpleNamespace(item=lambda: tid),
        xyxy=np.array([list(bbox)]),
        conf=SimpleNamespace(item=lambda: conf),
    )


class FakeModel:
    def __init__(self):
        self.people = []        # lista de (tid, bbox) a devolver
        self.calls = []

    def track(self, frame, **kwargs):
        self.calls.append(kwargs)
        return [SimpleNamespace(boxes=FakeBoxes([fake_box(t, b) for t, b in self.people]))]


def make_pipeline(zones=(), retention=10.0):
    sub = FakeSubtractor()
    model = FakeModel()
    rules = GuardianRules(GuardianConfig())
    rules.set_zones(zones)
    gate = gp.MotionGate(retention_seconds=retention, subtractor=sub)
    return gp.GuardianPipeline(model, rules, gate, device='cuda:0', imgsz=960), model, sub


# ----------------------------------------------------------------------------
# Motion gating con retención
# ----------------------------------------------------------------------------
def test_gate_skips_yolo_without_motion_or_recent_people():
    pipe, model, _sub = make_pipeline()
    res = pipe.process(FRAME, 0.0)
    assert res.ran_inference is False and model.calls == []


def test_gate_runs_yolo_on_motion_and_passes_device_and_classes():
    pipe, model, sub = make_pipeline()
    sub.motion_pixels = 400
    res = pipe.process(FRAME, 0.0)
    assert res.ran_inference is True and res.motion is True
    call = model.calls[0]
    assert call['classes'] == [0] and call['persist'] is True and call['imgsz'] == 960
    assert call['device'] == 'cuda:0' and call['tracker'] == 'bytetrack.yaml'


def test_gate_retention_keeps_yolo_running_for_a_still_person():
    pipe, model, sub = make_pipeline()
    sub.motion_pixels = 400
    model.people = [(1, IN_ZONE)]
    pipe.process(FRAME, 0.0)           # se ve a la persona
    sub.motion_pixels = 0              # se queda quieta: MOG2 la absorbe
    for t in (1.0, 5.0, 10.0):
        res = pipe.process(FRAME, t)
        assert res.ran_inference is True and res.retained is True and res.motion is False
    assert len(model.calls) == 4


def test_gate_retention_expires_and_is_renewed_while_people_are_seen():
    pipe, model, sub = make_pipeline()
    sub.motion_pixels = 400
    model.people = [(1, IN_ZONE)]
    pipe.process(FRAME, 0.0)
    sub.motion_pixels = 0
    assert pipe.process(FRAME, 8.0).ran_inference is True   # la ve de nuevo -> renueva
    assert pipe.process(FRAME, 17.0).ran_inference is True  # 9 s desde la última vez
    model.people = []
    assert pipe.process(FRAME, 25.0).ran_inference is True  # 8 s después de verla por última vez
    assert pipe.process(FRAME, 40.0).ran_inference is False  # ya nadie en 15 s


def test_gate_with_zones_only_counts_motion_inside_zones():
    zones = parse_guardian_zones([SQUARE])
    pipe, model, sub = make_pipeline(zones)
    sub.motion_pixels = 400  # el bloque 450..470 cae DENTRO de la zona (400..600)
    assert pipe.process(FRAME, 0.0).motion is True
    # Movimiento fuera de la zona: otra máscara.
    pipe2, _m2, _s2 = make_pipeline(zones)
    pipe2.gate._sub = SimpleNamespace(apply=lambda f: _outside_mask(f))
    assert pipe2.process(FRAME, 0.0).ran_inference is False


def _outside_mask(frame):
    mask = np.zeros(frame.shape[:2], dtype=np.uint8)
    mask[10:60, 10:60] = 255
    return mask


def test_pipeline_feeds_rules_and_reports_decisions():
    pipe, model, sub = make_pipeline(parse_guardian_zones([SQUARE]))
    sub.motion_pixels = 400
    model.people = [(7, IN_ZONE)]
    decisions = []
    for t in (0.0, 1.0, 2.0):
        decisions += pipe.process(FRAME, t).decisions
    assert [(d.type, d.track_id) for d in decisions] == [('intrusion', 7)]


def test_extract_detections_skips_boxes_without_id():
    results = [SimpleNamespace(boxes=FakeBoxes([fake_box(None, IN_ZONE), fake_box(3, IN_ZONE, 0.5)]))]
    assert gp.extract_detections(results) == [(3, IN_ZONE, 0.5)]
    assert gp.count_people(results) == 2
    assert gp.extract_detections([]) == [] and gp.extract_detections([SimpleNamespace(boxes=None)]) == []


def test_load_model_requires_a_local_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        gp.load_model(tmp_path / 'no-existe.pt')


def test_effective_device_prefers_the_predictor_device():
    model = SimpleNamespace(predictor=SimpleNamespace(model=SimpleNamespace(device='cuda:0')))
    assert gp.effective_device(model, 'cpu') == 'cuda:0'
    assert gp.effective_device(SimpleNamespace(), None) == 'auto'
    assert gp.effective_device(SimpleNamespace(), 'cpu') == 'cpu'


def test_mog2_gate_works_with_the_real_subtractor():
    gate = gp.MotionGate()
    assert isinstance(gate._sub, type(cv2.createBackgroundSubtractorMOG2()))
    assert gate.check(FRAME, 0.0, []).run in (True, False)


# ----------------------------------------------------------------------------
# Worker refactorizado
# ----------------------------------------------------------------------------
@pytest.fixture
def guardian_module(monkeypatch):
    try:
        importlib.import_module('ultralytics')
    except ImportError:
        module = types.ModuleType('ultralytics')
        module.YOLO = object
        monkeypatch.setitem(sys.modules, 'ultralytics', module)
    return importlib.import_module('lpr.processor.guardian_worker')


def make_cfg(**over):
    base = dict(backend_url='http://backend.test/api/v1/detections', camera_id='cam-1_guardia',
                rtsp_url='rtsp://x', poll_interval=1.0, dry_run=True, include_snapshot=True, device='cuda:0')
    base.update(over)
    return SimpleNamespace(**base)


def make_worker(guardian_module, monkeypatch, model=None, zones_payload=None):
    monkeypatch.setattr(guardian_module, 'fetch_camera_json',
                        lambda *a, **k: zones_payload)
    return guardian_module.GuardianWorker(make_cfg(), model=model or FakeModel(), start_zones_thread=False)


def test_worker_exits_cleanly_when_the_local_model_is_missing(guardian_module, tmp_path, monkeypatch):
    monkeypatch.setattr(guardian_module, 'fetch_camera_json', lambda *a, **k: None)
    with pytest.raises(SystemExit) as exc:
        guardian_module.GuardianWorker(make_cfg(), model_path=tmp_path / 'no-existe.pt')
    assert exc.value.code == 1


def test_worker_payload_has_no_disk_path_and_no_file_written(guardian_module, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    sent = []
    monkeypatch.setattr(guardian_module, 'post_anomaly', lambda url, payload, dry_run=True: sent.append(payload) or 201)
    worker = make_worker(guardian_module, monkeypatch, zones_payload={'enableGuardian': True, 'guardianZones': [SQUARE]})
    frame = np.full((1000, 1000, 3), 80, dtype=np.uint8)
    worker.pipeline.gate._sub = FakeSubtractor()
    worker.pipeline.gate._sub.motion_pixels = 400
    worker.model.people = [(9, IN_ZONE)]
    for _ in range(3):
        worker._process_frame(frame)

    # `_process_frame` usa el reloj real: los tres frames caen en el mismo segundo,
    # lo que basta para 3 hits estables.
    assert len(sent) == 1
    payload = sent[0]
    assert set(payload) == {'cameraId', 'anomalyType', 'confidence', 'meta', 'detectionTimestamp'}
    assert payload['cameraId'] == 'cam-1' and payload['anomalyType'] == 'intrusion'
    assert set(payload['meta']) == {'bbox', 'snapshot_jpeg_b64', 'anomaly_type', 'duration_seconds', 'track_id'}
    assert payload['meta']['bbox'] == [480, 420, 520, 580] and payload['meta']['track_id'] == 9
    assert payload['meta']['snapshot_jpeg_b64']
    assert list(tmp_path.iterdir()) == []  # nada escrito a disco (ni detecciones/ ni JPG)


def test_worker_skips_processing_when_guardian_is_disabled(guardian_module, monkeypatch):
    worker = make_worker(guardian_module, monkeypatch, zones_payload={'enableGuardian': False, 'guardianZones': []})
    assert worker.guardian_enabled is False
    worker._process_frame(FRAME)
    assert worker.model.calls == []


def test_zones_refresh_runs_in_a_daemon_thread_and_replaces_zones(guardian_module, monkeypatch):
    payloads = [{'enableGuardian': True, 'guardianZones': []},
                {'enableGuardian': True, 'guardianZones': [{'points': SQUARE, 'type': 'loitering', 'loiterSeconds': 30}]}]
    refreshed = threading.Event()

    def fake_fetch(*args, **kwargs):
        value = payloads.pop(0) if len(payloads) > 1 else payloads[0]
        if value['guardianZones']:
            refreshed.set()
        return value

    monkeypatch.setattr(guardian_module, 'fetch_camera_json', fake_fetch)
    monkeypatch.setattr(guardian_module.settings, 'LPR_ZONES_REFETCH_SECONDS', 0.05)
    monkeypatch.setattr(guardian_module, 'MIN_ZONES_REFETCH_SECONDS', 0.01)
    worker = guardian_module.GuardianWorker(make_cfg(), model=FakeModel())  # hilo habilitado
    assert worker.guardian_zones == ()
    worker._ensure_zones_thread()
    try:
        assert worker._zones_thread.daemon is True
        assert refreshed.wait(3.0)
        deadline = threading.Event()
        for _ in range(100):
            if worker.guardian_zones:
                break
            deadline.wait(0.02)
        assert [(z.type, z.loiter_seconds) for z in worker.guardian_zones] == [('loitering', 30.0)]
    finally:
        worker._stop_zones.set()
        worker._zones_thread.join(2.0)


def test_heartbeat_reports_and_resets_counters(guardian_module, monkeypatch, caplog):
    worker = make_worker(guardian_module, monkeypatch)
    worker._reads, worker._inferences, worker._inference_ms = 60, 10, 250.0
    worker.last_heartbeat = 0.0
    with caplog.at_level('INFO'):
        worker._maybe_heartbeat(30.5)
    line = next(r.getMessage() for r in caplog.records if 'HEARTBEAT' in r.getMessage())
    assert 'cuda:0' in line and '25.0 ms' in line and 'captura 1.97 fps' in line
    assert (worker._reads, worker._inferences, worker._inference_ms) == (0, 0, 0.0)
