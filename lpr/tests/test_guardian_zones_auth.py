"""Zonas del Guardián con la API key de servicio (Fase 4 · P5.C).

`GET /anomalies/cameras/:id/zones` exige `x-api-key` desde la P5.B
(ServiceApiKeyGuard, acotada al condominio de la key). Sin el header el
backend respondía 401 y el Guardián corría SIN zonas (todo el cuadro).
`_fetch_zones` debe mandar la misma `LPR_SERVICE_API_KEY` que la ingesta.

`processor/guardian_worker.py` importa `ultralytics` (no está en esta máquina
de desarrollo): si falta, se reemplaza por un módulo vacío. El test no
construye el worker (no carga YOLO): crea la instancia sin `__init__`, le pone
la configuración mínima y llama a `_fetch_zones` (que ahora corre en un hilo
de fondo y entrega las zonas tipadas al motor de reglas).
"""
import importlib
import sys
import types
from types import SimpleNamespace

import pytest

from lpr.processor.guardian_rules import GuardianRules, parse_guardian_zones
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


def _worker_double(guardian_module, backend_url=f'{BACKEND}/detections'):
    """Worker sin `__init__` (sin YOLO ni executor) con el estado que usa `_fetch_zones`."""
    worker = object.__new__(guardian_module.GuardianWorker)
    worker.cfg = SimpleNamespace(backend_url=backend_url, camera_id=CAMERA_ID)
    worker.rules = GuardianRules()
    worker.guardian_enabled = True
    worker.zones_last_fetched = 0
    return worker


SQUARE_ZONE = parse_guardian_zones([SQUARE])


def test_fetch_zones_sends_service_api_key(guardian_module, monkeypatch):
    backend = FakeBackend({'enableGuardian': True, 'guardianZones': [SQUARE]})
    monkeypatch.setattr(settings, 'LPR_SERVICE_API_KEY', API_KEY)
    monkeypatch.setattr(guardian_module.requests, 'get', backend.get)
    worker = _worker_double(guardian_module)

    guardian_module.GuardianWorker._fetch_zones(worker)

    assert backend.calls == [
        {'url': ZONES_URL, 'headers': {'x-api-key': API_KEY}},
    ]
    assert list(worker.rules.zones) == SQUARE_ZONE
    assert worker.guardian_enabled is True
    assert worker.zones_last_fetched > 0


def test_fetch_zones_respects_disabled_guardian(guardian_module, monkeypatch):
    backend = FakeBackend({'enableGuardian': False, 'guardianZones': []})
    monkeypatch.setattr(settings, 'LPR_SERVICE_API_KEY', API_KEY)
    monkeypatch.setattr(guardian_module.requests, 'get', backend.get)
    worker = _worker_double(guardian_module)

    guardian_module.GuardianWorker._fetch_zones(worker)

    assert backend.calls[0]['headers'] == {'x-api-key': API_KEY}
    assert worker.guardian_enabled is False


def test_fetch_zones_without_key_keeps_previous_zones(guardian_module, monkeypatch):
    """Sin key el backend responde 401: no se pisan las zonas ni se apaga el
    Guardián, y el intento queda marcado (respeta el refetch)."""
    backend = FakeBackend({'enableGuardian': True, 'guardianZones': []})
    monkeypatch.setattr(settings, 'LPR_SERVICE_API_KEY', None)
    monkeypatch.setattr(guardian_module.requests, 'get', backend.get)
    worker = _worker_double(guardian_module)
    worker.rules.set_zones(SQUARE_ZONE)

    guardian_module.GuardianWorker._fetch_zones(worker)

    assert backend.calls[0]['headers'] == {}
    assert list(worker.rules.zones) == SQUARE_ZONE
    assert worker.guardian_enabled is True
    assert worker.zones_last_fetched > 0


def test_fetch_zones_accepts_the_new_typed_format(guardian_module, monkeypatch):
    payload = {'enableGuardian': True, 'guardianZones': [
        {'points': SQUARE, 'type': 'loitering', 'loiterSeconds': 45},
        {'points': SQUARE, 'type': 'intrusion'},
        SQUARE,  # legacy mezclado: intrusión
    ]}
    backend = FakeBackend(payload)
    monkeypatch.setattr(settings, 'LPR_SERVICE_API_KEY', API_KEY)
    monkeypatch.setattr(guardian_module.requests, 'get', backend.get)
    worker = _worker_double(guardian_module)

    guardian_module.GuardianWorker._fetch_zones(worker)

    assert [(z.type, z.loiter_seconds) for z in worker.rules.zones] == [
        ('loitering', 45.0), ('intrusion', 20.0), ('intrusion', 20.0)]


def test_fetch_zones_passes_the_requested_timeout(guardian_module, monkeypatch):
    seen = {}

    def fake_get(url, headers=None, timeout=None, allow_redirects=True):
        seen['timeout'] = timeout
        return FakeResponse(200, {'enableGuardian': True, 'guardianZones': []})

    monkeypatch.setattr(settings, 'LPR_SERVICE_API_KEY', API_KEY)
    monkeypatch.setattr(guardian_module.requests, 'get', fake_get)
    guardian_module.GuardianWorker._fetch_zones(_worker_double(guardian_module), timeout=3.0)
    assert seen['timeout'] == 3.0
