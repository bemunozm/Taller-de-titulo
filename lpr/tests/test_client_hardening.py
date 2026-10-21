"""Endurecimiento del cliente HTTP del worker (`api/client.py`).

* Nunca sigue redirects: el `x-api-key` terminaria en otro host.
* Distingue "el request no llego" (se puede reintentar y NO se consume el dedupe)
  de "pudo haber llegado" (timeout leyendo la respuesta: el backend pudo abrir el
  portón; no se reintenta y SI se consume el dedupe para no reabrir).
* El DRY RUN no imprime patentes reales.
"""
import logging

import pytest
import requests
from urllib3.exceptions import MaxRetryError, NewConnectionError, ProtocolError

from lpr.api import client

URL = 'http://backend.test/api/v1/detections/plates'
PLATE = 'BBCD12'


@pytest.fixture(autouse=True)
def _sin_esperas(monkeypatch):
    monkeypatch.setattr(client.time, 'sleep', lambda _s: None)
    monkeypatch.setattr(client.settings, 'LPR_SERVICE_API_KEY', 'k')


class _Resp:
    def __init__(self, status, payload=None):
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload


def _scripted_post(monkeypatch, outcomes):
    """requests.post que devuelve/lanza segun `outcomes` y registra los kwargs."""
    calls = []

    def fake_post(url, json=None, headers=None, timeout=None, allow_redirects=True):
        calls.append({'url': url, 'allow_redirects': allow_redirects})
        outcome = outcomes[min(len(calls) - 1, len(outcomes) - 1)]
        if isinstance(outcome, BaseException):
            raise outcome
        return _Resp(outcome)

    monkeypatch.setattr(client.requests, 'post', fake_post)
    return calls


# --- redirects ---------------------------------------------------------------

def test_post_no_sigue_redirects(monkeypatch):
    calls = _scripted_post(monkeypatch, [302])
    status = client._post_request(URL, {'plate': PLATE}, dry_run=False)
    assert status == 302 and not client.is_success(status)
    assert calls[0]['allow_redirects'] is False


def test_get_no_sigue_redirects(monkeypatch):
    seen = {}

    def fake_get(url, headers=None, timeout=None, allow_redirects=True):
        seen['allow_redirects'] = allow_redirects
        return _Resp(302)

    monkeypatch.setattr(client.requests, 'get', fake_get)
    assert client.fetch_camera_json('http://backend.test/api/v1', '/workers/cameras/c1/lpr-settings') is None
    assert seen['allow_redirects'] is False


# --- clasificacion del fallo ------------------------------------------------------

def _refused():
    return requests.exceptions.ConnectionError(
        MaxRetryError(None, URL, reason=NewConnectionError(None, 'refused')))


def _aborted():
    return requests.exceptions.ConnectionError(ProtocolError('Connection aborted.', OSError('reset')))


@pytest.mark.parametrize('exc,expected', [
    (_refused(), client.STATUS_NOT_SENT),                              # conexion rechazada / DNS
    (requests.exceptions.ConnectTimeout('connect'), client.STATUS_NOT_SENT),
    (requests.exceptions.SSLError('handshake'), client.STATUS_NOT_SENT),
    (requests.exceptions.ReadTimeout('read'), client.STATUS_MAYBE_SENT),   # pudo procesarlo
    (_aborted(), client.STATUS_MAYBE_SENT),                            # corte con la conexion abierta
    (RuntimeError('inesperado'), client.STATUS_MAYBE_SENT),            # ante la duda, no reabrir
])
def test_clasificacion_de_excepciones(exc, expected):
    assert client.classify_post_exception(exc) == expected


def test_timeout_de_lectura_no_se_reintenta_y_consume_el_dedupe(monkeypatch):
    calls = _scripted_post(monkeypatch, [requests.exceptions.ReadTimeout('read'), 201])
    status = client._post_request(URL, {'plate': PLATE}, dry_run=False)
    assert status == client.STATUS_MAYBE_SENT
    assert len(calls) == 1                      # reintentar duplicaria el evento / la apertura
    assert not client.is_success(status) and client.consumes_dedupe(status)


def test_request_que_no_llego_se_reintenta_y_no_consume_el_dedupe(monkeypatch):
    calls = _scripted_post(monkeypatch, [_refused()])
    status = client._post_request(URL, {'plate': PLATE}, dry_run=False)
    assert status == client.STATUS_NOT_SENT and len(calls) == 3
    assert not client.consumes_dedupe(status)


def test_request_que_no_llego_y_luego_funciona(monkeypatch):
    calls = _scripted_post(monkeypatch, [_refused(), 201])
    assert client._post_request(URL, {'plate': PLATE}, dry_run=False) == 201 and len(calls) == 2


@pytest.mark.parametrize('status,consumes', [
    (200, True), (201, True), (client.STATUS_MAYBE_SENT, True),
    (client.STATUS_NOT_SENT, False), (400, False), (401, False), (500, False), (302, False),
])
def test_consumes_dedupe(status, consumes):
    assert client.consumes_dedupe(status) is consumes


# --- logs -------------------------------------------------------------------------

def test_dry_run_no_loguea_la_patente_real(caplog):
    dto = {'plate': PLATE, 'plate_raw': PLATE, 'cameraId': 'cam-1',
           'meta': {'snapshot_jpeg_b64': 'AAAA', 'char_confidences': [0.9], 'direction': 'entry'}}
    with caplog.at_level(logging.INFO):
        assert client._post_request(URL, dto, dry_run=True) == 200
    assert PLATE not in caplog.text and 'BB**12' in caplog.text
    assert 'AAAA' not in caplog.text and 'entry' in caplog.text
    assert dto['plate'] == PLATE   # el payload real no se toca
