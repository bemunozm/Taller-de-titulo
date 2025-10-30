from __future__ import annotations

import os
import sys
import time
import threading
import subprocess
from pathlib import Path
from typing import Dict, Optional
import requests

from fastapi import FastAPI, HTTPException, Request, status, Depends
from pydantic import BaseModel
from lpr.settings import settings

APP = FastAPI(title="LPR Worker Manager")


class RegisterPayload(BaseModel):
    cameraId: str
    rtspUrl: str
    mountPath: Optional[str] = None


class UnregisterPayload(BaseModel):
    cameraId: str


_LOCK = threading.Lock()
# cameraId -> { proc: Popen, start_time: float, cmd: list[str], log_path: Path }
_PROCS: Dict[str, Dict] = {}

LOG_DIR = Path(__file__).parent.parent / 'logs'
LOG_DIR.mkdir(parents=True, exist_ok=True)

SECRET = settings.WORKER_MANAGER_SECRET
BACKEND_URL = settings.WORKER_BACKEND_URL or settings.WORKER_BACKEND_URL
BACKEND_TOKEN = settings.WORKER_BACKEND_TOKEN


def _check_secret(request: Request):
    if not SECRET:
        return True
    auth = request.headers.get('authorization') or request.headers.get('x-worker-secret')
    if not auth:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='missing auth')
    # support 'Bearer <secret>' or raw header
    if auth.lower().startswith('bearer '):
        token = auth.split(None, 1)[1]
    else:
        token = auth
    if token != SECRET:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='invalid secret')
    return True


def _sanitize_fname(s: str) -> str:
    # keep alnum and -_. otherwise replace with '_'
    out = []
    for c in s:
        if c.isalnum() or c in '-_.':
            out.append(c)
        else:
            out.append('_')
    return ''.join(out)


@APP.post('/register-camera')
def register_camera(payload: RegisterPayload, auth: bool = Depends(_check_secret)):
    if not payload.rtspUrl:
        raise HTTPException(status_code=400, detail='rtspUrl required')
    camera_id = payload.cameraId
    with _LOCK:
        if camera_id in _PROCS:
            proc_info = _PROCS[camera_id]
            return {'status': 'already_running', 'pid': proc_info['proc'].pid}

        # build command: use same python executable
        py = sys.executable or 'python'
        backend_arg = BACKEND_URL or ''
        cmd = [py, '-m', 'lpr.execute_worker', payload.rtspUrl, camera_id, backend_arg]

        fname = f"worker_{_sanitize_fname(camera_id)}.log"
        log_path = LOG_DIR / fname
        # ensure log dir exists (race-free-ish)
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
        except Exception:
            # if mkdir fails, we'll let open() raise below with a clear error
            pass

        # open log file in append-binary and keep handle so we can close it on stop
        try:
            log_file = open(log_path, 'ab')
        except Exception as e:
            raise HTTPException(status_code=500, detail=f'failed to open log file {log_path}: {e}')

        try:
            # ensure the subprocess can import the `lpr` package:
            # package_dir = <repo>/lpr, project_root = parent of lpr (repo root)
            package_dir = Path(__file__).parent.parent.resolve()
            project_root = package_dir.parent
            env = os.environ.copy()
            # prepend project_root (repo root) to PYTHONPATH so `-m lpr.execute_worker` can find the package
            proj_str = str(project_root)
            old_pp = env.get('PYTHONPATH', '')
            if proj_str not in [p for p in old_pp.split(os.pathsep) if p]:
                env['PYTHONPATH'] = proj_str + (os.pathsep + old_pp if old_pp else '')

            proc = subprocess.Popen(cmd, stdout=log_file, stderr=subprocess.STDOUT, env=env, cwd=proj_str)
        except Exception as e:
            try:
                log_file.close()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail=f'failed to start worker: {e}')

        _PROCS[camera_id] = {'proc': proc, 'start_time': time.time(), 'cmd': cmd, 'log_path': str(log_path), 'log_handle': log_file}
        return {'status': 'started', 'pid': proc.pid, 'log': str(log_path)}


@APP.post('/unregister-camera')
def unregister_camera(payload: UnregisterPayload, auth: bool = Depends(_check_secret)):
    camera_id = payload.cameraId
    with _LOCK:
        if camera_id not in _PROCS:
            return {'status': 'not_found'}
        info = _PROCS[camera_id]
        proc = info['proc']
        # try graceful termination
        try:
            proc.terminate()
        except Exception:
            pass

    # wait outside lock
    try:
        proc.wait(timeout=10)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass

    with _LOCK:
        try:
            info['log_handle'].close()
        except Exception:
            pass
        del _PROCS[camera_id]

    return {'status': 'stopped'}


@APP.get('/status')
def get_status(auth: bool = Depends(_check_secret)):
    with _LOCK:
        out = {}
        for k, v in _PROCS.items():
            out[k] = {'pid': v['proc'].pid, 'start_time': v['start_time'], 'cmd': v['cmd'], 'log': v['log_path']}
        return out


@APP.get('/')
def index():
    return {'ok': True}


@APP.get('/health')
def health():
    """Health endpoint for external callers. Returns ok and number of running workers."""
    with _LOCK:
        running = len(_PROCS)
    return {'ok': True, 'running_workers': running}


@APP.on_event('startup')
def reconcile_with_backend():
    """Al iniciar, consulta el backend (si está configurado) y registra cámaras con enableLpr=true.
    Requiere que el backend exponga `GET /cameras` y `GET /cameras/{id}/source`.
    Si el backend requiere autenticación, poner token en WORKER_BACKEND_TOKEN (Bearer).
    """
    if not BACKEND_URL:
        return
    try:
        url_base = BACKEND_URL.rstrip('/')
        headers = {}
        if BACKEND_TOKEN:
            headers['Authorization'] = f'Bearer {BACKEND_TOKEN}'

        resp = requests.get(f'{url_base}/cameras', timeout=5, headers=headers)
        if resp.status_code != 200:
            return
        cams = resp.json()
        if not isinstance(cams, list):
            return
        for cam in cams:
            try:
                if not cam.get('enableLpr'):
                    continue
                cam_id = cam.get('id') or cam.get('mountPath')
                if not cam_id:
                    continue
                # attempt to get decrypted source
                sresp = requests.get(f"{url_base}/cameras/{cam_id}/source", timeout=5, headers=headers)
                if sresp.status_code != 200:
                    continue
                src = sresp.json().get('sourceUrl')
                if not src:
                    continue
                # call internal register function to spawn worker
                try:
                    payload = RegisterPayload(cameraId=cam_id, rtspUrl=src, mountPath=cam.get('mountPath'))
                    register_camera(payload, True)
                except Exception:
                    continue
            except Exception:
                continue
    except Exception:
        return


if __name__ == '__main__':
    # run uvicorn when executed directly
    import uvicorn

    uvicorn.run('lpr.api.manager:APP', host=settings.WORKER_MANAGER_HOST, port=int(settings.WORKER_MANAGER_PORT), reload=False)
