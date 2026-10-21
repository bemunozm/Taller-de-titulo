"""Config por cámara del `LprWorker`: pull al arrancar + refetch en caliente (F3).

El backend (`GET /workers/cameras/:id/lpr-settings`) se reemplaza por un doble
sobre `fetch_camera_json` (sin red). `processor/worker.py` importa `ultralytics`
y `huggingface_hub` (ausentes en CI, ver conftest.py): se stubean si faltan.
"""
import importlib
import logging
import sys
import types
from types import SimpleNamespace

import pytest
import requests

from lpr.api import client
from lpr.settings import WorkerConfig, settings

CAMERA_ID = '6f1c2a40-0000-4000-8000-000000000001'
BACKEND = 'http://backend.test/api/v1'
SQUARE = [[{'x': 0.1, 'y': 0.1}, {'x': 0.9, 'y': 0.1}, {'x': 0.9, 'y': 0.9}]]
OTHER = [[{'x': 0.0, 'y': 0.0}, {'x': 0.5, 'y': 0.0}, {'x': 0.5, 'y': 0.5}]]


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


class FakeBackend:
    """Respuestas encoladas; `None` simula un fallo (el helper real devuelve None)."""

    def __init__(self):
        self.responses = []
        self.calls = []

    def __call__(self, backend_url, path, timeout=5.0):
        self.calls.append((backend_url, path))
        return self.responses.pop(0) if self.responses else None


@pytest.fixture
def backend(worker_module, monkeypatch):
    fake = FakeBackend()
    monkeypatch.setattr(worker_module, 'fetch_camera_json', fake)
    return fake


@pytest.fixture
def worker(worker_module, backend, tmp_path):
    base = WorkerConfig(
        camera_id=CAMERA_ID, backend_url=f'{BACKEND}/detections', detections_dir=str(tmp_path),
        confirm_reads=3, direction='unknown', detector_imgsz=640, sample_fps=1.0, poll_interval=1.0,
    )
    lpr_worker = worker_module.LprWorker(base, lambda _f, _c: [], SimpleNamespace())
    yield lpr_worker
    lpr_worker._settings_stop.set()
    lpr_worker.executor.shutdown(wait=False)


def _payload(settings_dict, enable=True):
    return {'cameraId': CAMERA_ID, 'enableLpr': enable, 'lprSettings': settings_dict}


def test_startup_merges_settings_and_uses_real_camera_id(worker, backend):
    backend.responses = [_payload({'zone': SQUARE, 'detectorImgsz': 960, 'sampleFps': 4, 'confirmReads': 5})]

    assert worker.refresh_camera_settings() is True

    assert backend.calls == [(f'{BACKEND}/detections', f'/workers/cameras/{CAMERA_ID}/lpr-settings')]
    assert worker.cfg.zone == SQUARE
    assert worker.cfg.detector_imgsz == 960
    assert worker.cfg.sample_fps == 4
    assert worker.cfg.poll_interval == pytest.approx(0.25)
    assert worker.cfg.confirm_reads == 5
    assert worker.tracker.confirm_reads == 5


def test_hot_reload_updates_cfg_and_tracker(worker, backend):
    backend.responses = [
        _payload({'zone': SQUARE, 'detectorImgsz': 960, 'sampleFps': 4, 'confirmReads': 5}),
        _payload({'zone': OTHER, 'detectorImgsz': 1280, 'sampleFps': 2, 'confirmReads': 2, 'direction': 'entry',
                  'action': 'register'}),
    ]
    worker.refresh_camera_settings()
    first_tracker = worker.tracker

    worker.refresh_camera_settings()

    assert worker.cfg.zone == OTHER
    assert worker.cfg.detector_imgsz == 1280
    assert worker.cfg.poll_interval == pytest.approx(0.5)
    assert worker.cfg.confirm_reads == 2
    assert worker.cfg.direction == 'entry'
    assert worker.tracker is not first_tracker
    assert worker.tracker.confirm_reads == 2


def test_failed_fetch_keeps_last_valid_config(worker, backend):
    backend.responses = [_payload({'zone': SQUARE, 'confirmReads': 4}), None]
    worker.refresh_camera_settings()
    cfg_before, tracker_before = worker.cfg, worker.tracker

    assert worker.refresh_camera_settings() is False

    assert worker.cfg is cfg_before
    assert worker.tracker is tracker_before
    assert worker.cfg.zone == SQUARE


def test_never_fetched_failure_uses_env_base(worker, backend, caplog):
    """404/403/red caída desde el arranque: queda la base del env (sin zona) y se loguea."""
    backend.responses = [None]
    with caplog.at_level(logging.WARNING):
        assert worker.refresh_camera_settings() is False

    assert worker.cfg is worker.base_cfg
    assert worker.cfg.zone is None
    assert any('config vigente' in r.getMessage() for r in caplog.records)


def test_tracker_not_rebuilt_when_only_zone_changes(worker, backend):
    backend.responses = [_payload({'confirmReads': 4}), _payload({'confirmReads': 4, 'zone': SQUARE})]
    worker.refresh_camera_settings()
    tracker = worker.tracker

    worker.refresh_camera_settings()

    assert worker.cfg.zone == SQUARE
    assert worker.tracker is tracker


def test_identical_settings_do_not_republish(worker, backend):
    backend.responses = [_payload({'zone': SQUARE}), _payload({'zone': SQUARE})]
    worker.refresh_camera_settings()
    cfg = worker.cfg

    worker.refresh_camera_settings()

    assert worker.cfg is cfg


def test_removed_keys_revert_to_env_defaults(worker, backend):
    """Se fusiona siempre sobre la base: lo que el backend deja de mandar vuelve al env."""
    backend.responses = [_payload({'zone': SQUARE, 'confirmReads': 5}), _payload(None)]
    worker.refresh_camera_settings()

    worker.refresh_camera_settings()

    assert worker.cfg.zone is None
    assert worker.cfg.confirm_reads == 3
    assert worker.tracker.confirm_reads == 3


def test_enable_lpr_false_is_logged_once_and_worker_keeps_running(worker, backend, caplog):
    backend.responses = [_payload(None, enable=False), _payload(None, enable=False)]
    with caplog.at_level(logging.WARNING):
        worker.refresh_camera_settings()
        worker.refresh_camera_settings()

    warnings = [r for r in caplog.records if 'enableLpr=false' in r.getMessage()]
    assert len(warnings) == 1
    assert not worker._settings_stop.is_set()


def test_config_change_log_has_no_rtsp_url(worker, backend, caplog):
    worker.base_cfg.rtsp_url = 'rtsp://user:secret@cam/stream'
    worker.cfg = worker.base_cfg
    backend.responses = [_payload({'confirmReads': 4})]
    with caplog.at_level(logging.INFO):
        worker.refresh_camera_settings()

    assert 'secret' not in caplog.text


def test_process_frame_sees_consistent_cfg_and_tracker(worker, worker_module, backend, monkeypatch):
    seen = {}
    monkeypatch.setattr(worker_module, 'process_frame',
                        lambda frame, det, ocr, cfg, tracker, now, **kw: seen.update(cfg=cfg, tracker=tracker) or ([], []))
    backend.responses = [_payload({'confirmReads': 5})]
    worker.refresh_camera_settings()

    import numpy as np
    worker._process_frame(np.zeros((8, 8, 3), dtype=np.uint8))

    assert seen['cfg'] is worker.cfg
    assert seen['tracker'] is worker.tracker


def test_start_settings_sync_pulls_first_then_periodically(worker, backend):
    backend.responses = [_payload({'confirmReads': 4}), _payload({'confirmReads': 6})]
    worker.start_settings_sync(interval=0.01)
    worker._settings_thread.join(timeout=0.5)
    worker._settings_stop.set()
    worker._settings_thread.join(timeout=2)

    assert len(backend.calls) >= 2
    assert worker.cfg.confirm_reads == 6


# --- helper del cliente -------------------------------------------------------

class _Resp:
    def __init__(self, status, payload=None, bad_json=False):
        self.status_code = status
        self._payload = payload
        self._bad = bad_json

    def json(self):
        if self._bad:
            raise ValueError('no json')
        return self._payload


@pytest.mark.parametrize('url,expected', [
    (BACKEND, BACKEND),
    (f'{BACKEND}/', BACKEND),
    (f'{BACKEND}/detections', BACKEND),
    (f'{BACKEND}/detections/plates', BACKEND),
    (f'{BACKEND}/anomalies', BACKEND),
])
def test_backend_base_url(url, expected):
    assert client.backend_base_url(url) == expected


def test_fetch_camera_json_sends_key_and_returns_dict(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_SERVICE_API_KEY', 'k')
    sent = {}

    def fake_get(url, headers=None, timeout=None, allow_redirects=True):
        sent.update(url=url, headers=headers, timeout=timeout, redirects=allow_redirects)
        return _Resp(200, {'a': 1})

    monkeypatch.setattr(requests, 'get', fake_get)

    assert client.fetch_camera_json(f'{BACKEND}/detections/plates', '/x/y', timeout=3) == {'a': 1}
    assert sent == {'url': f'{BACKEND}/x/y', 'headers': {'x-api-key': 'k'}, 'timeout': 3, 'redirects': False}


@pytest.mark.parametrize('response', [
    _Resp(401), _Resp(403), _Resp(404), _Resp(500), _Resp(200, bad_json=True), _Resp(200, [1, 2]),
])
def test_fetch_camera_json_returns_none_on_bad_responses(monkeypatch, response):
    monkeypatch.setattr(requests, 'get', lambda *a, **k: response)
    assert client.fetch_camera_json(BACKEND, '/x') is None


def test_fetch_camera_json_never_raises_on_network_error(monkeypatch):
    def boom(*a, **k):
        raise requests.ConnectionError('down')

    monkeypatch.setattr(requests, 'get', boom)
    assert client.fetch_camera_json(BACKEND, '/x') is None


# --- zona rota: nunca se pierde (SEC) ---------------------------------------------

def test_zona_rota_conserva_la_zona_vigente(worker, backend):
    backend.responses = [_payload({'zone': SQUARE, 'sampleFps': 4})]
    worker.refresh_camera_settings()
    assert worker.cfg.zone == SQUARE

    backend.responses = [_payload({'zone': 'basura', 'sampleFps': 8})]
    worker.refresh_camera_settings()
    assert worker.cfg.zone == SQUARE and worker.cfg.detection_blocked is False
    assert worker.cfg.sample_fps == 8.0


def test_zona_rota_sin_zona_previa_falla_cerrado_y_se_recupera(worker, backend, caplog):
    with caplog.at_level(logging.ERROR):
        backend.responses = [_payload({'zone': 'basura'})]
        worker.refresh_camera_settings()
    assert worker.cfg.zone is None and worker.cfg.detection_blocked is True
    assert 'fail-closed' in caplog.text

    backend.responses = [_payload({'zone': SQUARE})]
    worker.refresh_camera_settings()
    assert worker.cfg.zone == SQUARE and worker.cfg.detection_blocked is False


def test_recorte_incoherente_no_pierde_la_zona_en_el_worker(worker, backend):
    backend.responses = [_payload({'zone': SQUARE, 'crop': {'maxRatio': 1.5}})]
    worker.refresh_camera_settings()
    assert worker.cfg.zone == SQUARE
