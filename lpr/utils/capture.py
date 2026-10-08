"""Apertura/reconexión de captura RTSP con timeouts (Fase 3.C — operabilidad).

Antes `cv2.VideoCapture(rtsp, CAP_FFMPEG)` se abría UNA sola vez en `cli.py`;
si el stream caía, `cap.read()` devolvía `False` para siempre (o bloqueaba
indefinidamente sin timeouts) y el loop solo hacía `continue` — el warning
"reconectando..." mentía, no reabría nada.

Vive en `utils/` (no en `cli.py`) para evitar un ciclo de imports: `cli.py`
importa `LprWorker`/`GuardianWorker` desde `processor/`, y esos workers
también necesitan poder reabrir el stream tras una desconexión — si el
helper viviera en `cli.py`, `processor/worker.py` tendría que importar
`cli.py`, que a su vez importa `processor/worker.py`.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

import cv2

from lpr.settings import settings

# Valores de respaldo por si la build de OpenCV no expone las constantes
# (viejas versiones de opencv-python-headless). Coinciden con los códigos
# numéricos oficiales de cv2.CAP_PROP_OPEN_TIMEOUT_MSEC / READ_TIMEOUT_MSEC.
_CAP_PROP_OPEN_TIMEOUT_MSEC = getattr(cv2, 'CAP_PROP_OPEN_TIMEOUT_MSEC', 53)
_CAP_PROP_READ_TIMEOUT_MSEC = getattr(cv2, 'CAP_PROP_READ_TIMEOUT_MSEC', 54)


def open_capture(rtsp_url: str) -> 'cv2.VideoCapture':
    """Abre un `VideoCapture` FFmpeg con timeouts de apertura/lectura.

    Los timeouts deben fijarse ANTES de abrir el stream (por eso se crea el
    `VideoCapture` vacío y se llama `.open()` después de `.set(...)`) — si no,
    un stream caído o congelado puede dejar `cap.read()` bloqueado
    indefinidamente (ver LPR_STREAM_OPEN_TIMEOUT_MS / LPR_STREAM_READ_TIMEOUT_MS
    en settings.py).
    """
    cap = cv2.VideoCapture()
    try:
        cap.set(_CAP_PROP_OPEN_TIMEOUT_MSEC, float(settings.LPR_STREAM_OPEN_TIMEOUT_MS))
        cap.set(_CAP_PROP_READ_TIMEOUT_MSEC, float(settings.LPR_STREAM_READ_TIMEOUT_MS))
    except Exception:
        logging.exception('No se pudieron configurar los timeouts de captura RTSP')
    cap.open(rtsp_url, cv2.CAP_FFMPEG)
    return cap


def reconnect_capture(rtsp_url: str, old_cap=None) -> Optional['cv2.VideoCapture']:
    """Libera `old_cap` (si corresponde) y reintenta reabrir el stream con
    backoff exponencial acotado (`LPR_STREAM_RECONNECT_MAX_ATTEMPTS`,
    `LPR_STREAM_RECONNECT_BACKOFF_SECONDS`).

    Devuelve el nuevo `VideoCapture` abierto, o `None` si se agotaron los
    intentos — en ese caso el llamador debe terminar el proceso
    (`sys.exit(1)`) para que el supervisor del manager lo reinicie limpio
    (ver `LPR_SUPERVISOR_*` en settings.py y `api/manager.py`).
    """
    if old_cap is not None:
        try:
            old_cap.release()
        except Exception:
            pass

    max_attempts = int(settings.LPR_STREAM_RECONNECT_MAX_ATTEMPTS)
    backoff = float(settings.LPR_STREAM_RECONNECT_BACKOFF_SECONDS)

    for attempt in range(1, max_attempts + 1):
        logging.warning('Reintentando conexión RTSP (intento %d/%d)...', attempt, max_attempts)
        new_cap = open_capture(rtsp_url)
        if new_cap is not None and new_cap.isOpened():
            logging.info('Reconexión RTSP exitosa (intento %d/%d)', attempt, max_attempts)
            return new_cap
        try:
            new_cap.release()
        except Exception:
            pass
        if attempt < max_attempts:
            time.sleep(min(backoff * (2 ** (attempt - 1)), 30.0))

    logging.error('No se pudo reabrir el stream RTSP tras %d intentos', max_attempts)
    return None
