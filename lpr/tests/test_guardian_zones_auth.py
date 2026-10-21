"""Zonas del Guardián con la API key de servicio (Fase 4 · P5.C).

`GET /anomalies/cameras/:id/zones` exige `x-api-key` desde la P5.B
(ServiceApiKeyGuard, acotada al condominio de la key). Sin el header el
backend respondía 401 y el Guardián corría SIN zonas (todo el cuadro).
`_fetch_zones` debe mandar la misma `LPR_SERVICE_API_KEY` que la ingesta.

`processor/guardian_worker.py` importa `ultralytics` (no está en esta máquina
de desarrollo): si falta, se reemplaza por un módulo vacío. El test no
construye el worker (no carga YOLO): llama a `_fetch_zones` sobre un doble
con la configuración mínima.
"""
import importlib
import sys
import types
from types import SimpleNamespace

import pytest

from lpr.settings import settings

API_KEY = 'svc_guardian_key'
BACKEND = 'http://backend.test/api/v1'
CAMERA_ID = '6f1c2a40-0000-4000-8000-000000000001'
ZONES_URL = f'{BACKEND}/anomalies/cameras/{CAMERA_ID}/zones'
SQUARE = [{'x': 0.1, 'y': 0.1}, {'x': 0.9, 'y': 0.1}, {'x': 0.9, 'y': 0.9}]


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class FakeBackend:
    """Registra cada GET; responde 401 si falta la key correcta."""

    def __init__(self, payload):
        self.calls = []
        self.payload = payload

    def get(self, url, headers=None, timeout=None, allow_redirects=True):
        sent = dict(headers or {})
        self.calls.append({'url': url, 'headers': sent})
        if sent.get('x-api-key') != API_KEY:
            return FakeResponse(401, {'message': 'Unauthorized'})
        if url != ZONES_URL:
            return FakeResponse(404, None)
        return FakeResponse(200, self.payload)


@pytest.fixture
def guardian_module(monkeypatch):
    try:
        importlib.import_module('ultralytics')
    except ImportError:
        module = types.ModuleType('ultralytics')
        module.YOLO = object
        monkeypatch.setitem(sys.modules, 'ultralytics', module)
    return importlib.import_module('lpr.processor.guardian_worker')


def _worker_double(backend_url=f'{BACKEND}/detections'):
    """Estado mínimo que usa `_fetch_zones` (sin YOLO ni executor)."""
    return SimpleNamespace(
        cfg=SimpleNamespace(backend_url=backend_url, camera_id=CAMERA_ID),
        guardian_zones=[],
        guardian_enabled=True,
        zones_last_fetched=0,
    )


def test_fetch_zones_sends_service_api_key(guardian_module, monkeypatch):
    backend = FakeBackend({'enableGuardian': True, 'guardianZones': [SQUARE]})
    monkeypatch.setattr(settings, 'LPR_SERVICE_API_KEY', API_KEY)
    monkeypatch.setattr(guardian_module.requests, 'get', backend.get)
    worker = _worker_double()

    guardian_module.GuardianWorker._fetch_zones(worker)

    assert backend.calls == [
        {'url': ZONES_URL, 'headers': {'x-api-key': API_KEY}},
    ]
    assert worker.guardian_zones == [SQUARE]
    assert worker.guardian_enabled is True
    assert worker.zones_last_fetched > 0


def test_fetch_zones_respects_disabled_guardian(guardian_module, monkeypatch):
    backend = FakeBackend({'enableGuardian': False, 'guardianZones': []})
    monkeypatch.setattr(settings, 'LPR_SERVICE_API_KEY', API_KEY)
    monkeypatch.setattr(guardian_module.requests, 'get', backend.get)
    worker = _worker_double()

    guardian_module.GuardianWorker._fetch_zones(worker)

    assert backend.calls[0]['headers'] == {'x-api-key': API_KEY}
    assert worker.guardian_enabled is False


def test_fetch_zones_without_key_keeps_previous_zones(guardian_module, monkeypatch):
    """Sin key el backend responde 401: no se pisan las zonas ni se apaga el
    Guardián, y el intento queda marcado (respeta el refetch)."""
    backend = FakeBackend({'enableGuardian': True, 'guardianZones': []})
    monkeypatch.setattr(settings, 'LPR_SERVICE_API_KEY', None)
    monkeypatch.setattr(guardian_module.requests, 'get', backend.get)
    worker = _worker_double()
    worker.guardian_zones = [SQUARE]

    guardian_module.GuardianWorker._fetch_zones(worker)

    assert backend.calls[0]['headers'] == {}
    assert worker.guardian_zones == [SQUARE]
    assert worker.guardian_enabled is True
    assert worker.zones_last_fetched > 0
