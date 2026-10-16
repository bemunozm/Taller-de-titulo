"""Autenticación del LPR contra el backend (Fase 4 · P2).

El manager reconcilia las cámaras al arrancar con `GET /workers/cameras` y
`GET /workers/cameras/{id}/source`, autenticado SOLO con la API key de
servicio en `x-api-key` (`LPR_SERVICE_API_KEY`). El Bearer JWT legacy
(`WORKER_BACKEND_TOKEN` / `LPR_WORKER_TOKEN`) se retiró.

`requests` se reemplaza por un doble: no hay red ni backend en estos tests.
"""
import pytest
import requests
from pydantic import ValidationError

from lpr.api import client
from lpr.api import manager as mgr
from lpr.settings import Settings

API_KEY = 'svc_test_key'
BACKEND = 'http://backend.test/api/v1'


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class FakeBackend:
    """Registra cada GET y responde según la ruta."""

    def __init__(self, cameras_status=200, cameras=None, sources=None):
        self.calls = []
        self.cameras_status = cameras_status
        self.cameras = cameras or []
        self.sources = sources or {}

    def get(self, url, timeout=None, headers=None):
        self.calls.append({'url': url, 'headers': dict(headers or {})})
        if url == f'{BACKEND}/workers/cameras':
            return FakeResponse(self.cameras_status, self.cameras)
        prefix = f'{BACKEND}/workers/cameras/'
        if url.startswith(prefix) and url.endswith('/source'):
            cam_id = url[len(prefix):-len('/source')]
            if cam_id in self.sources:
                return FakeResponse(200, {'sourceUrl': self.sources[cam_id]})
            return FakeResponse(404, {'message': 'not found'})
        return FakeResponse(404, None)


def _wire(monkeypatch, backend, api_key=API_KEY):
    registered = []
    monkeypatch.setattr(mgr, 'BACKEND_URL', BACKEND)
    monkeypatch.setattr(mgr.settings, 'LPR_SERVICE_API_KEY', api_key)
    monkeypatch.setattr(mgr.requests, 'get', backend.get)
    monkeypatch.setattr(mgr, 'register_camera', lambda payload, auth: registered.append(payload))
    return registered


def test_reconcile_usa_rutas_de_workers_con_x_api_key(monkeypatch):
    backend = FakeBackend(
        cameras=[
            {'id': 'cam-1', 'mountPath': 'porton', 'enableLpr': True, 'enableGuardian': False},
            {'id': 'cam-2', 'mountPath': 'patio', 'enableLpr': False, 'enableGuardian': True},
            {'id': 'cam-3', 'mountPath': 'off', 'enableLpr': False, 'enableGuardian': False},
        ],
        sources={'cam-1': 'rtsp://cam-1/stream', 'cam-2': 'rtsp://cam-2/stream'},
    )
    registered = _wire(monkeypatch, backend)

    mgr.reconcile_with_backend()

    urls = [call['url'] for call in backend.calls]
    assert urls == [
        f'{BACKEND}/workers/cameras',
        f'{BACKEND}/workers/cameras/cam-1/source',
        f'{BACKEND}/workers/cameras/cam-2/source',
    ]
    for call in backend.calls:
        assert call['headers'] == {'x-api-key': API_KEY}
        assert 'Authorization' not in call['headers']

    assert [(p.cameraId, p.rtspUrl, p.mode) for p in registered] == [
        ('cam-1', 'rtsp://cam-1/stream', 'patente'),
        ('cam-2_guardia', 'rtsp://cam-2/stream', 'guardia'),
    ]


def test_reconcile_sin_api_key_no_llama_al_backend(monkeypatch):
    backend = FakeBackend(cameras=[{'id': 'cam-1', 'enableLpr': True}])
    registered = _wire(monkeypatch, backend, api_key=None)

    mgr.reconcile_with_backend()

    assert backend.calls == []
    assert registered == []


def test_reconcile_key_sin_condominio_403_no_registra(monkeypatch):
    backend = FakeBackend(cameras_status=403, cameras={'message': 'sin condominio'})
    registered = _wire(monkeypatch, backend)

    mgr.reconcile_with_backend()

    assert [call['url'] for call in backend.calls] == [f'{BACKEND}/workers/cameras']
    assert registered == []


def test_reconcile_source_ajena_404_se_omite(monkeypatch):
    backend = FakeBackend(
        cameras=[{'id': 'cam-x', 'enableLpr': True}],
        sources={},
    )
    registered = _wire(monkeypatch, backend)

    mgr.reconcile_with_backend()

    assert registered == []


def _settings_from_env_file(tmp_path, monkeypatch, content):
    """Construye Settings SOLO desde un .env temporal (sin el entorno del host)."""
    for name in ('WORKER_BACKEND_TOKEN', 'LPR_WORKER_TOKEN', 'WORKER_MANAGER_SECRET'):
        monkeypatch.delenv(name, raising=False)
    env_file = tmp_path / '.env'
    env_file.write_text(content, encoding='utf-8')
    return Settings(_env_file=str(env_file))


@pytest.mark.parametrize('legacy_var', ['WORKER_BACKEND_TOKEN', 'LPR_WORKER_TOKEN'])
def test_settings_rechaza_tokens_bearer_legacy_en_el_env(tmp_path, monkeypatch, legacy_var):
    # Un .env viejo con el token legacy debe fallar al arrancar (extra='forbid'),
    # no ignorarse en silencio.
    with pytest.raises(ValidationError) as exc:
        _settings_from_env_file(tmp_path, monkeypatch, f'{legacy_var}=eyJ.legacy.jwt\n')
    message = str(exc.value)
    # pydantic-settings reporta la clave del .env en minúsculas.
    assert legacy_var.lower() in message.lower()
    assert 'extra_forbidden' in message
    assert 'eyJ.legacy.jwt' not in message


def test_settings_acepta_la_api_key_de_servicio(tmp_path, monkeypatch):
    s = _settings_from_env_file(tmp_path, monkeypatch, f'LPR_SERVICE_API_KEY={API_KEY}\n')
    assert s.LPR_SERVICE_API_KEY == API_KEY


STRONG_SECRET = 'Wm7Qz2Lp9Xv4Rt8Ks1Nc6Hd3Jf5Gb0YaUe'


def test_manager_secret_real_se_acepta(tmp_path, monkeypatch):
    s = _settings_from_env_file(tmp_path, monkeypatch, f'WORKER_MANAGER_SECRET={STRONG_SECRET}\n')
    assert s.WORKER_MANAGER_SECRET == STRONG_SECRET


@pytest.mark.parametrize('blank', ['', '   '])
def test_manager_secret_vacio_cuenta_como_no_configurado(tmp_path, monkeypatch, blank):
    s = _settings_from_env_file(tmp_path, monkeypatch, f'WORKER_MANAGER_SECRET={blank}\n')
    assert s.WORKER_MANAGER_SECRET is None


@pytest.mark.parametrize(
    'weak, reason',
    [
        ('secreto-corto-del-manager', '32'),
        ('change-me-to-a-secure-random-value', 'placeholder'),
        ('change-me-generate-with-openssl-rand-base64-32', 'placeholder'),
        ('your_worker_manager_secret_of_at_least_32', 'placeholder'),
    ],
)
def test_manager_secret_debil_impide_arrancar_sin_filtrar_el_valor(tmp_path, monkeypatch, weak, reason):
    with pytest.raises(ValidationError) as exc:
        _settings_from_env_file(tmp_path, monkeypatch, f'WORKER_MANAGER_SECRET={weak}\n')
    message = str(exc.value)
    assert 'WORKER_MANAGER_SECRET' in message
    assert reason in message
    assert weak not in message


def test_reconcile_backend_caido_no_tumba_el_manager(monkeypatch, caplog):
    def connection_refused(url, timeout=None, headers=None):
        raise requests.ConnectionError('connection refused')

    registered = _wire(monkeypatch, FakeBackend())
    monkeypatch.setattr(mgr.requests, 'get', connection_refused)

    # No debe propagar la excepción (el startup de FastAPI seguiría vivo).
    mgr.reconcile_with_backend()

    assert registered == []
    assert 'Error reconciliando cámaras con el backend' in caplog.text


def test_reconcile_source_con_backend_caido_omite_la_camara(monkeypatch):
    backend = FakeBackend(cameras=[{'id': 'cam-1', 'enableLpr': True}])
    registered = _wire(monkeypatch, backend)

    def flaky_get(url, timeout=None, headers=None):
        if url.endswith('/source'):
            raise requests.ConnectionError('connection reset')
        return backend.get(url, timeout=timeout, headers=headers)

    monkeypatch.setattr(mgr.requests, 'get', flaky_get)

    mgr.reconcile_with_backend()

    assert registered == []


def test_cliente_de_ingesta_envia_solo_x_api_key(monkeypatch):
    sent = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        sent['url'] = url
        sent['headers'] = dict(headers or {})
        return FakeResponse(201)

    monkeypatch.setattr(client.settings, 'LPR_SERVICE_API_KEY', API_KEY)
    monkeypatch.setattr(client.requests, 'post', fake_post)

    status = client._post_request(f'{BACKEND}/detections/plates', {'plate': 'ABCD12'}, dry_run=False)

    assert status == 201
    assert sent['headers']['x-api-key'] == API_KEY
    assert 'Authorization' not in sent['headers']
