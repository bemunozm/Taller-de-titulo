from __future__ import annotations

import os
import re
import sys
import time
import hmac
import threading
import subprocess
import logging
from pathlib import Path
from typing import Dict, List, Optional
import requests

from fastapi import FastAPI, HTTPException, Request, status, Depends
from pydantic import BaseModel
from lpr.settings import settings
from lpr.utils.logging_setup import configure_logging
from lpr.utils.retention import purge_old_files

# Logging con rotación acotada (sin esto el log del manager crecía sin cota).
# Ver utils/logging_setup.py — LPR_LOG_MAX_BYTES / LPR_LOG_BACKUP_COUNT.
configure_logging('manager', add_console=True)
logger = logging.getLogger(__name__)

APP = FastAPI(title="LPR Worker Manager")


class RegisterPayload(BaseModel):
    cameraId: str
    rtspUrl: str
    mountPath: Optional[str] = None
    mode: str = 'patente'


class UnregisterPayload(BaseModel):
    cameraId: str


_LOCK = threading.Lock()
# cameraId -> { proc, start_time, cmd, mode, log_path, bootstrap_log_handle,
#               restarts, restart_window_start, status, pending_restart_at }
_PROCS: Dict[str, Dict] = {}

_SHUTDOWN_EVENT = threading.Event()
_SUPERVISOR_THREAD: Optional[threading.Thread] = None
_RETENTION_THREAD: Optional[threading.Thread] = None

LOG_DIR = Path(__file__).parent.parent / 'logs'
LOG_DIR.mkdir(parents=True, exist_ok=True)

SECRET = settings.WORKER_MANAGER_SECRET
BACKEND_URL = settings.WORKER_BACKEND_URL or settings.WORKER_BACKEND_URL
BACKEND_TOKEN = settings.WORKER_BACKEND_TOKEN
# Escape hatch SOLO para desarrollo local. En producción el manager escucha en
# la red del condominio y controla la apertura del portón: sin secreto, cualquiera
# en la LAN podría registrar/dar de baja cámaras.
ALLOW_NO_SECRET = bool(settings.WORKER_MANAGER_ALLOW_NO_SECRET)

if not SECRET and not ALLOW_NO_SECRET:
    logger.error(
        'WORKER_MANAGER_SECRET no está configurado: el manager RECHAZARÁ toda petición '
        '(fail-closed). Configura el secreto, o pon WORKER_MANAGER_ALLOW_NO_SECRET=true '
        'solo para desarrollo local.'
    )
elif not SECRET and ALLOW_NO_SECRET:
    logger.warning('WORKER_MANAGER_ALLOW_NO_SECRET=true: manager SIN autenticación. NO usar en producción.')

# cameraId legítimo = UUID o UUID_guardia → solo alfanuméricos, guion y guion bajo.
# Rechazar cualquier otra cosa cierra el path traversal vía nombres de archivo.
_CAMERA_ID_RE = re.compile(r'^[A-Za-z0-9_-]+$')


def _check_secret(request: Request):
    if not SECRET:
        if ALLOW_NO_SECRET:
            return True
        # fail-closed: un secreto ausente NO abre el manager
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail='manager mal configurado: falta WORKER_MANAGER_SECRET')
    auth = request.headers.get('authorization') or request.headers.get('x-worker-secret')
    if not auth:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='missing auth')
    # support 'Bearer <secret>' or raw header
    if auth.lower().startswith('bearer '):
        token = auth.split(None, 1)[1]
    else:
        token = auth
    # comparación timing-safe
    if not hmac.compare_digest(str(token), str(SECRET)):
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


def _start_worker_process(camera_id: str, cmd: List[str], mode: str) -> Dict:
    """Lanza el proceso worker para `camera_id` y arma la entrada de `_PROCS`.

    Reutilizado por `register_camera` (arranque nuevo) y por el supervisor
    (reinicio tras caída) para no duplicar la lógica de Popen/env/logging.
    El llamador debe tener `_LOCK` tomado.
    """
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    sanitized = _sanitize_fname(camera_id)
    # `log_path`: el worker hijo configura su PROPIO logging con rotación
    # acotada sobre este archivo (ver utils/logging_setup.py). El manager NO
    # escribe aquí — solo lo reporta como referencia en /status y /register-camera.
    log_path = LOG_DIR / f"worker_{sanitized}.log"
    # `bootstrap_log_path`: captura el stdout/stderr crudo del subproceso
    # SOLO para el arranque (tracebacks de import, crashes antes de que el
    # worker alcance a configurar su propio logger). Se trunca ('wb') en cada
    # arranque/reinicio para que nunca crezca sin cota — es justo lo que esta
    # fase busca eliminar. Si redirigiéramos aquí TODO el stdout de forma
    # continua duplicaríamos el log rotado de arriba.
    bootstrap_log_path = LOG_DIR / f"worker_{sanitized}.bootstrap.log"

    try:
        bootstrap_log_file = open(bootstrap_log_path, 'wb')
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'failed to open bootstrap log file {bootstrap_log_path}: {e}')

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

        proc = subprocess.Popen(cmd, stdout=bootstrap_log_file, stderr=subprocess.STDOUT, env=env, cwd=proj_str)
        logger.info(f"--- [STARTED] Worker for {camera_id} (PID {proc.pid}) ---")
        logger.info(f"--- [LOGS] {log_path} (bootstrap: {bootstrap_log_path}) ---")
    except Exception as e:
        try:
            bootstrap_log_file.close()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f'failed to start worker: {e}')

    return {
        'proc': proc,
        'start_time': time.time(),
        'cmd': cmd,
        'mode': mode,
        'log_path': str(log_path),
        'bootstrap_log_handle': bootstrap_log_file,
        'restarts': 0,
        'restart_window_start': time.time(),
        'status': 'running',
        'pending_restart_at': None,
    }


def _close_bootstrap_handle(info: Dict):
    handle = info.get('bootstrap_log_handle')
    if handle is not None:
        try:
            handle.close()
        except Exception:
            pass


@APP.post('/register-camera')
def register_camera(payload: RegisterPayload, auth: bool = Depends(_check_secret)):
    if not payload.rtspUrl:
        raise HTTPException(status_code=400, detail='rtspUrl required')
    camera_id = payload.cameraId
    # Validar el cameraId antes de usarlo para construir nombres de archivo /
    # argumentos de subprocess (defensa contra path traversal).
    if not camera_id or not _CAMERA_ID_RE.fullmatch(camera_id):
        raise HTTPException(status_code=400, detail='invalid cameraId')
    with _LOCK:
        existing = _PROCS.get(camera_id)
        if existing is not None:
            if existing['proc'].poll() is None:
                return {'status': 'already_running', 'pid': existing['proc'].pid}
            # Entrada muerta (crasheó / status failed / restarting): cosechar y
            # reemplazar, en vez de mentir con 'already_running'.
            try:
                existing['proc'].wait(timeout=1)
            except Exception:
                pass
            _close_bootstrap_handle(existing)
            del _PROCS[camera_id]

        max_procs = int(settings.LPR_MAX_PROCS)
        if len(_PROCS) >= max_procs:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f'límite de procesos concurrentes alcanzado ({max_procs}); no se registra {camera_id}',
            )

        # build command: use same python executable
        py = sys.executable or 'python'
        backend_arg = BACKEND_URL or ''
        cmd = [py, '-m', 'lpr.execute_worker', payload.rtspUrl, camera_id, backend_arg, '1.0', payload.mode]

        info = _start_worker_process(camera_id, cmd, payload.mode)
        _PROCS[camera_id] = info
        return {'status': 'started', 'pid': info['proc'].pid, 'log': info['log_path']}


@APP.post('/unregister-camera')
def unregister_camera(payload: UnregisterPayload, auth: bool = Depends(_check_secret)):
    camera_id = payload.cameraId
    with _LOCK:
        if camera_id not in _PROCS:
            return {'status': 'not_found'}
        info = _PROCS[camera_id]
        # Marcar 'stopping' bajo lock: evita que el supervisor lo reinicie
        # mientras esperamos (fuera del lock) a que el proceso termine.
        info['status'] = 'stopping'
        proc = info['proc']
        logger.info(f"--- [STOPPING] Worker for {camera_id} (PID {proc.pid}) ---")
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
        # puede haber sido reemplazado por un reinicio del supervisor mientras
        # esperábamos fuera del lock; solo borrar si sigue siendo la misma entrada
        current = _PROCS.get(camera_id)
        if current is info:
            _close_bootstrap_handle(info)
            del _PROCS[camera_id]

    return {'status': 'stopped'}


@APP.get('/status')
def get_status(auth: bool = Depends(_check_secret)):
    with _LOCK:
        out = {}
        for k, v in _PROCS.items():
            proc = v['proc']
            alive = bool(proc.poll() is None)
            # NO exponer 'cmd': contiene la URL RTSP con credenciales de la cámara.
            out[k] = {
                'pid': proc.pid,
                'start_time': v['start_time'],
                'mode': v.get('mode'),
                'log': v['log_path'],
                'alive': alive,
                'restarts': v.get('restarts', 0),
                'status': v.get('status'),
            }
        return out


@APP.get('/')
def index():
    return {'ok': True}


@APP.get('/health')
def health():
    """Health honesto: cuenta solo procesos VIVOS (poll() is None), no
    entradas del dict (`_PROCS` puede tener workers muertos aún no
    cosechados por el supervisor, o en `restarting`/`failed`)."""
    with _LOCK:
        workers = []
        alive_count = 0
        for cam_id, info in _PROCS.items():
            proc = info.get('proc')
            alive = bool(proc is not None and proc.poll() is None)
            if alive:
                alive_count += 1
            workers.append({
                'cameraId': cam_id,
                'alive': alive,
                'restarts': info.get('restarts', 0),
                'mode': info.get('mode'),
                'status': info.get('status'),
            })
    return {'ok': True, 'running_workers': alive_count, 'workers': workers}


# ---------------------------------------------------------------------------
# Supervisor de procesos (Fase 3.C — operabilidad)
# ---------------------------------------------------------------------------
# Antes: Popen y nunca poll()/wait() -> zombies, y /health mentía. Este hilo
# cosecha procesos muertos, loguea el exit code, y reinicia con backoff
# exponencial hasta un tope de reinicios por cámara dentro de una ventana.
# Superado el tope, la cámara se deja caída (status='failed') sin más
# reintentos automáticos — evita un loop de reinicio infinito.

def _backoff_seconds(restarts: int) -> float:
    base = float(settings.LPR_SUPERVISOR_BACKOFF_BASE_SECONDS)
    cap = float(settings.LPR_SUPERVISOR_BACKOFF_MAX_SECONDS)
    return min(base * (2 ** max(0, restarts - 1)), cap)


def _supervise_once():
    now = time.time()
    with _LOCK:
        items = list(_PROCS.items())

    for camera_id, info in items:
        with _LOCK:
            current = _PROCS.get(camera_id)
            if current is None or current is not info:
                # se borró/reemplazó entre la copia y ahora (unregister o
                # reinicio concurrente) — nada que hacer con esta entrada vieja
                continue

            if info['status'] == 'failed':
                continue

            if info['status'] == 'stopping':
                # unregister en curso lo está terminando fuera del lock; no tocar.
                continue

            if info['status'] == 'restarting':
                pending_at = info.get('pending_restart_at')
                if pending_at is not None and now < pending_at:
                    continue
                cmd = info['cmd']
                mode = info['mode']
                restarts = info['restarts']
                restart_window_start = info['restart_window_start']
                try:
                    new_info = _start_worker_process(camera_id, cmd, mode)
                except HTTPException as e:
                    logger.error('Reinicio de %s falló al lanzar el proceso: %s', camera_id, e.detail)
                    info['pending_restart_at'] = now + _backoff_seconds(restarts)
                    continue
                new_info['restarts'] = restarts
                new_info['restart_window_start'] = restart_window_start
                _PROCS[camera_id] = new_info
                logger.warning(
                    'Worker %s reiniciado (intento %d/%d)',
                    camera_id, restarts, int(settings.LPR_SUPERVISOR_MAX_RESTARTS),
                )
                continue

            proc = info['proc']
            rc = proc.poll()
            if rc is None:
                continue  # vivo, nada que hacer

            # murió: cosechar (evitar zombie) y decidir si reiniciar
            try:
                proc.wait(timeout=1)
            except Exception:
                pass
            logger.error('Worker %s (PID %s) terminó con código %s', camera_id, proc.pid, rc)
            _close_bootstrap_handle(info)

            window = float(settings.LPR_SUPERVISOR_RESTART_WINDOW_SECONDS)
            if now - info['restart_window_start'] > window:
                info['restarts'] = 0
                info['restart_window_start'] = now

            max_restarts = int(settings.LPR_SUPERVISOR_MAX_RESTARTS)
            if info['restarts'] >= max_restarts:
                info['status'] = 'failed'
                logger.error(
                    'Worker %s superó %d reinicios en %.0fs — se deja caído (status=failed); '
                    'requiere intervención manual (POST /unregister-camera + /register-camera)',
                    camera_id, max_restarts, window,
                )
                continue

            info['restarts'] += 1
            info['status'] = 'restarting'
            delay = _backoff_seconds(info['restarts'])
            info['pending_restart_at'] = now + delay
            logger.warning(
                'Worker %s caído, reintentando en %.1fs (intento %d/%d)',
                camera_id, delay, info['restarts'], max_restarts,
            )


def _supervisor_loop():
    interval = float(settings.LPR_SUPERVISOR_INTERVAL)
    while not _SHUTDOWN_EVENT.wait(interval):
        try:
            _supervise_once()
        except Exception:
            logger.exception('Error en el ciclo del supervisor')


# ---------------------------------------------------------------------------
# Retención de disco (Fase 3.C)
# ---------------------------------------------------------------------------
# Corre en su propio hilo (no en el hot-path de cada frame, ni acoplado al
# intervalo — mucho más corto — del supervisor de procesos).

def _run_retention_pass():
    dirs = [d for d in (
        settings.LPR_DETECTIONS_DIR,
        settings.LPR_SAVE_CROPS_DIR,
        settings.LPR_SAVE_FRAMES_DIR,
    ) if d]
    retention_days = float(settings.LPR_RETENTION_DAYS)
    max_mb = float(settings.LPR_RETENTION_MAX_MB)
    for d in dirs:
        try:
            result = purge_old_files(d, retention_days=retention_days, max_mb=max_mb)
            if result['deleted']:
                logger.info(
                    'Retención: purgados %d archivos (%.1f MB) en %s',
                    result['deleted'], result['freed_bytes'] / (1024 * 1024), d,
                )
        except Exception:
            logger.exception('Error purgando %s', d)


def _retention_loop():
    interval = float(settings.LPR_RETENTION_CHECK_INTERVAL_SECONDS)
    while True:
        try:
            _run_retention_pass()
        except Exception:
            logger.exception('Error en la pasada de retención')
        if _SHUTDOWN_EVENT.wait(interval):
            break


def _terminate_all_children():
    """Termina y cosecha todos los procesos worker restantes, para no dejar
    huérfanos al bajar el manager."""
    with _LOCK:
        items = list(_PROCS.items())

    for camera_id, info in items:
        proc = info.get('proc')
        if proc is None:
            continue
        try:
            if proc.poll() is None:
                proc.terminate()
        except Exception:
            pass

    for camera_id, info in items:
        proc = info.get('proc')
        if proc is None:
            continue
        try:
            proc.wait(timeout=10)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        _close_bootstrap_handle(info)

    with _LOCK:
        _PROCS.clear()


@APP.on_event('startup')
def _start_background_threads():
    global _SUPERVISOR_THREAD, _RETENTION_THREAD
    _SHUTDOWN_EVENT.clear()
    _SUPERVISOR_THREAD = threading.Thread(target=_supervisor_loop, name='lpr-supervisor', daemon=True)
    _SUPERVISOR_THREAD.start()
    _RETENTION_THREAD = threading.Thread(target=_retention_loop, name='lpr-retention', daemon=True)
    _RETENTION_THREAD.start()


@APP.on_event('shutdown')
def _stop_background_threads():
    _SHUTDOWN_EVENT.set()
    if _SUPERVISOR_THREAD is not None:
        _SUPERVISOR_THREAD.join(timeout=5)
    if _RETENTION_THREAD is not None:
        _RETENTION_THREAD.join(timeout=5)
    _terminate_all_children()


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
                cam_id = cam.get('id') or cam.get('mountPath')
                if not cam_id:
                    continue

                # Decidir qué modos arrancar
                enable_lpr = cam.get('enableLpr', False)
                enable_guardian = cam.get('enableGuardian', False)

                if not (enable_lpr or enable_guardian):
                    continue

                # Intentar obtener source desencriptada
                sresp = requests.get(f"{url_base}/cameras/{cam_id}/source", timeout=5, headers=headers)
                if sresp.status_code != 200:
                    continue
                src = sresp.json().get('sourceUrl')
                if not src:
                    continue

                # Arrancar LPR si aplica
                if enable_lpr:
                    try:
                        payload = RegisterPayload(cameraId=cam_id, rtspUrl=src, mountPath=cam.get('mountPath'))
                        register_camera(payload, True)
                    except Exception as e:
                        logger.error(f"Error arrancando LPR para {cam_id} en startup: {e}")

                # Arrancar Guardián si aplica
                if enable_guardian:
                    try:
                        # Usar ID con sufijo para no colisionar con LPR en el manager
                        payload = RegisterPayload(
                            cameraId=f"{cam_id}_guardia",
                            rtspUrl=src,
                            mountPath=cam.get('mountPath'),
                            mode='guardia'
                        )
                        register_camera(payload, True)
                    except Exception as e:
                        logger.error(f"Error arrancando Guardián para {cam_id} en startup: {e}")

            except Exception as e:
                logger.error(f"Error procesando cámara {cam.get('id')} en startup: {e}")
                continue
    except Exception:
        return


if __name__ == '__main__':
    # run uvicorn when executed directly
    import uvicorn

    uvicorn.run('lpr.api.manager:APP', host=settings.WORKER_MANAGER_HOST, port=int(settings.WORKER_MANAGER_PORT), reload=False)
