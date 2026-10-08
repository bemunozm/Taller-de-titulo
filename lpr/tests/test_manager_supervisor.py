"""Tests del supervisor de procesos y de /health en api/manager.py.

`api/manager.py` no importa cv2/torch/ultralytics (a diferencia de cli.py y
los workers de processor/), así que es seguro de importar y testear
directamente en esta máquina de desarrollo (ver tests/conftest.py y el
comentario en requirements.txt sobre dependencias de visión no instaladas).

Los subprocesos reales (`python -m lpr.execute_worker ...`) se reemplazan
por un doble de prueba (`FakeProc`) vía monkeypatch de `subprocess.Popen`:
testear la supervisión no debería depender de spawnear procesos reales ni de
tener los modelos de visión instalados.
"""
from fastapi.testclient import TestClient

from lpr.api import manager as mgr


class FakeProc:
    """Doble de `subprocess.Popen` con el subconjunto de API que usa el
    supervisor: poll/wait/terminate/kill + pid."""

    _next_pid = 1000

    def __init__(self, exit_code=None):
        FakeProc._next_pid += 1
        self.pid = FakeProc._next_pid
        self._exit_code = exit_code

    def poll(self):
        return self._exit_code

    def terminate(self):
        if self._exit_code is None:
            self._exit_code = 0

    def kill(self):
        self._exit_code = -9

    def wait(self, timeout=None):
        return self._exit_code


def _clear_procs():
    with mgr._LOCK:
        for info in mgr._PROCS.values():
            mgr._close_bootstrap_handle(info)
        mgr._PROCS.clear()


def test_start_worker_process_builds_expected_entry(tmp_path, monkeypatch):
    monkeypatch.setattr(mgr, 'LOG_DIR', tmp_path)
    fake_proc = FakeProc(exit_code=None)
    monkeypatch.setattr(mgr.subprocess, 'Popen', lambda *a, **k: fake_proc)

    info = mgr._start_worker_process('cam1', ['python', '-c', 'pass'], 'patente')
    try:
        assert info['proc'] is fake_proc
        assert info['status'] == 'running'
        assert info['restarts'] == 0
        assert info['mode'] == 'patente'
        assert (tmp_path / 'worker_cam1.bootstrap.log').exists()
    finally:
        mgr._close_bootstrap_handle(info)


def test_supervisor_reconnects_and_restarts_dead_worker(tmp_path, monkeypatch):
    monkeypatch.setattr(mgr, 'LOG_DIR', tmp_path)
    monkeypatch.setattr(mgr.settings, 'LPR_SUPERVISOR_BACKOFF_BASE_SECONDS', 0.0)
    monkeypatch.setattr(mgr.settings, 'LPR_SUPERVISOR_BACKOFF_MAX_SECONDS', 0.0)
    monkeypatch.setattr(mgr.settings, 'LPR_SUPERVISOR_MAX_RESTARTS', 5)
    monkeypatch.setattr(mgr.settings, 'LPR_SUPERVISOR_RESTART_WINDOW_SECONDS', 300)

    proc1 = FakeProc(exit_code=None)
    proc2 = FakeProc(exit_code=None)
    popen_calls = [proc1, proc2]
    monkeypatch.setattr(mgr.subprocess, 'Popen', lambda *a, **k: popen_calls.pop(0))

    try:
        with mgr._LOCK:
            mgr._PROCS['cam1'] = mgr._start_worker_process('cam1', ['python'], 'patente')
        assert mgr._PROCS['cam1']['proc'] is proc1

        # el worker "muere" con exit code 1
        proc1._exit_code = 1
        mgr._supervise_once()
        info = mgr._PROCS['cam1']
        assert info['status'] == 'restarting'
        assert info['restarts'] == 1
        assert info['proc'] is proc1  # todavía no se relanzó, solo se agendó

        # backoff=0 -> el próximo ciclo ya puede reintentar
        mgr._supervise_once()
        info = mgr._PROCS['cam1']
        assert info['status'] == 'running'
        assert info['proc'] is proc2
        assert info['restarts'] == 1  # el contador no se resetea al reiniciar con éxito
    finally:
        _clear_procs()


def test_supervisor_gives_up_after_max_restarts(tmp_path, monkeypatch):
    monkeypatch.setattr(mgr, 'LOG_DIR', tmp_path)
    monkeypatch.setattr(mgr.settings, 'LPR_SUPERVISOR_BACKOFF_BASE_SECONDS', 0.0)
    monkeypatch.setattr(mgr.settings, 'LPR_SUPERVISOR_BACKOFF_MAX_SECONDS', 0.0)
    monkeypatch.setattr(mgr.settings, 'LPR_SUPERVISOR_MAX_RESTARTS', 2)
    monkeypatch.setattr(mgr.settings, 'LPR_SUPERVISOR_RESTART_WINDOW_SECONDS', 300)

    procs = [FakeProc(exit_code=None) for _ in range(5)]
    monkeypatch.setattr(mgr.subprocess, 'Popen', lambda *a, **k: procs.pop(0))

    try:
        with mgr._LOCK:
            mgr._PROCS['cam1'] = mgr._start_worker_process('cam1', ['python'], 'patente')

        # dos caídas dentro del tope: debe reiniciar ambas veces
        for _ in range(2):
            mgr._PROCS['cam1']['proc']._exit_code = 1
            mgr._supervise_once()  # detecta la caída, agenda reinicio
            assert mgr._PROCS['cam1']['status'] == 'restarting'
            mgr._supervise_once()  # ejecuta el reinicio
            assert mgr._PROCS['cam1']['status'] == 'running'

        # tercera caída: supera el tope -> se marca 'failed' y no reintenta más
        mgr._PROCS['cam1']['proc']._exit_code = 1
        mgr._supervise_once()
        info = mgr._PROCS['cam1']
        assert info['status'] == 'failed'
        assert info['restarts'] == 2

        # ciclos posteriores no deben tocar una cámara 'failed'
        proc_before = info['proc']
        mgr._supervise_once()
        assert mgr._PROCS['cam1']['proc'] is proc_before
        assert mgr._PROCS['cam1']['status'] == 'failed'
    finally:
        _clear_procs()


def test_health_counts_only_alive_processes():
    _clear_procs()
    try:
        with mgr._LOCK:
            mgr._PROCS['cam-alive'] = {
                'proc': FakeProc(exit_code=None), 'mode': 'patente', 'restarts': 0, 'status': 'running',
            }
            mgr._PROCS['cam-dead'] = {
                'proc': FakeProc(exit_code=1), 'mode': 'patente', 'restarts': 2, 'status': 'restarting',
            }

        with TestClient(mgr.APP) as client:
            resp = client.get('/health')

        assert resp.status_code == 200
        body = resp.json()
        assert body['ok'] is True
        assert body['running_workers'] == 1

        by_cam = {w['cameraId']: w for w in body['workers']}
        assert by_cam['cam-alive']['alive'] is True
        assert by_cam['cam-dead']['alive'] is False
        assert by_cam['cam-dead']['restarts'] == 2
    finally:
        _clear_procs()


def test_register_camera_rejects_over_max_procs(tmp_path, monkeypatch):
    monkeypatch.setattr(mgr, 'LOG_DIR', tmp_path)
    monkeypatch.setattr(mgr, 'ALLOW_NO_SECRET', True)
    monkeypatch.setattr(mgr.settings, 'LPR_MAX_PROCS', 1)
    monkeypatch.setattr(mgr.subprocess, 'Popen', lambda *a, **k: FakeProc(exit_code=None))

    _clear_procs()
    try:
        with TestClient(mgr.APP) as client:
            r1 = client.post('/register-camera', json={'cameraId': 'cam1', 'rtspUrl': 'rtsp://x'})
            assert r1.status_code == 200
            assert r1.json()['status'] == 'started'

            r2 = client.post('/register-camera', json={'cameraId': 'cam2', 'rtspUrl': 'rtsp://y'})
            assert r2.status_code == 503
    finally:
        _clear_procs()
