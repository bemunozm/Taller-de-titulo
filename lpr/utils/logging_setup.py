"""Configuración de logging compartida por el manager y los workers
(Fase 3.C — operabilidad).

Antes cada proceso llamaba `logging.basicConfig(...)` sin rotación: en un
despliegue edge de larga duración (semanas sin reinicio) el log crece sin
cota hasta llenar la SD. Este módulo centraliza:

- Un `RotatingFileHandler` acotado (`LPR_LOG_MAX_BYTES` / `LPR_LOG_BACKUP_COUNT`)
  por componente (y por cámara, cuando aplica, para no mezclar el log de
  varios workers concurrentes en un solo archivo).
- Silenciar librerías de terceros ruidosas (urllib3, ultralytics) que antes
  imprimían una línea por request/frame.

Vive en `utils/` (no en `cli.py`) por la misma razón que `capture.py`: evita
un ciclo de imports entre `cli.py` y los workers de `processor/`.
"""
from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path
from typing import Optional

from lpr.settings import settings

# lpr/utils/logging_setup.py -> parent = lpr/utils -> parent.parent = lpr/
# (mismo directorio LOG_DIR que ya usaba api/manager.py)
LOG_DIR = Path(__file__).resolve().parent.parent / 'logs'

_NOISY_LOGGERS = ('urllib3', 'urllib3.connectionpool', 'ultralytics')


def configure_logging(component: str, camera_id: Optional[str] = None, add_console: bool = True) -> logging.Logger:
    """Configura el logger raíz con rotación acotada y devuelve el logger.

    `component` identifica el proceso ('manager' o 'worker'); si se pasa
    `camera_id`, el archivo queda scoped a esa cámara
    (`<component>_<camera_id>.log`) para no mezclar logs de workers
    concurrentes en un solo archivo.

    `add_console=False` omite el StreamHandler a stdout — se usa para el
    proceso worker, cuyo stdout el manager ya redirige a un archivo de
    bootstrap acotado (ver `api/manager.py`); duplicar ahí todas las líneas
    de log (no solo las de arranque) reintroduciría el crecimiento sin cota
    que esta fase busca eliminar.
    """
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    level = getattr(logging, str(settings.LOG_LEVEL).upper(), logging.INFO)
    root = logging.getLogger()
    root.setLevel(level)

    fmt = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

    # Idempotente: si ya se configuró este proceso (p.ej. tests que llaman
    # configure_logging más de una vez), no duplicar handlers.
    already_configured = getattr(root, '_lpr_configured', False)
    if already_configured:
        return root

    if add_console:
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(fmt)
        root.addHandler(stream_handler)

    fname = f"{component}_{camera_id}.log" if camera_id else f"{component}.log"
    file_path = LOG_DIR / fname
    try:
        file_handler = logging.handlers.RotatingFileHandler(
            str(file_path),
            maxBytes=int(settings.LPR_LOG_MAX_BYTES),
            backupCount=int(settings.LPR_LOG_BACKUP_COUNT),
            encoding='utf-8',
        )
        file_handler.setFormatter(fmt)
        root.addHandler(file_handler)
    except Exception:
        logging.exception('No se pudo configurar RotatingFileHandler en %s', file_path)

    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)

    root._lpr_configured = True  # type: ignore[attr-defined]
    return root
