"""Purga de disco por antigüedad/tamaño (Fase 3.C — operabilidad).

Sin esto, `detecciones/`, los crops y los frames crecen sin cota y en un
despliegue edge (SD de la Raspberry Pi) terminan llenando el disco. La
función es puro I/O de filesystem — sin dependencias de visión (cv2/torch) —
para que sea trivial de testear y de llamar desde el hilo de retención del
manager sin tocar el hot-path de procesamiento de frames.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Dict


def purge_old_files(directory: str, retention_days: float = 0, max_mb: float = 0) -> Dict[str, int]:
    """Elimina archivos de `directory` (recursivo) más viejos que
    `retention_days`, y si el tamaño total restante sigue excediendo
    `max_mb`, sigue borrando los más antiguos hasta entrar en el presupuesto.

    `retention_days <= 0` desactiva el borrado por antigüedad; `max_mb <= 0`
    desactiva el borrado por tamaño. Directorios inexistentes se ignoran
    silenciosamente (no es un error: un worker recién instalado puede no
    tener aún `crops/` o `frames/`).

    Devuelve `{'deleted': N, 'freed_bytes': N}`. Nunca lanza — los errores de
    borrado de un archivo puntual (permisos, archivo ya borrado por otro
    proceso) se loguean y se continúa con el resto.
    """
    result = {'deleted': 0, 'freed_bytes': 0}
    if not directory:
        return result

    root = Path(directory)
    if not root.is_dir():
        return result

    now = time.time()
    max_age_seconds = float(retention_days) * 86400.0

    entries = []  # (path, mtime, size)
    for f in root.rglob('*'):
        if not f.is_file():
            continue
        try:
            st = f.stat()
        except OSError:
            continue
        entries.append((f, st.st_mtime, st.st_size))

    remaining = []
    if retention_days and retention_days > 0:
        for f, mtime, size in entries:
            if (now - mtime) > max_age_seconds:
                if _unlink(f):
                    result['deleted'] += 1
                    result['freed_bytes'] += size
            else:
                remaining.append((f, mtime, size))
    else:
        remaining = entries

    if max_mb and max_mb > 0:
        budget_bytes = float(max_mb) * 1024 * 1024
        total_bytes = sum(size for _, _, size in remaining)
        if total_bytes > budget_bytes:
            # más antiguos primero, para conservar las detecciones recientes
            remaining.sort(key=lambda t: t[1])
            for f, mtime, size in remaining:
                if total_bytes <= budget_bytes:
                    break
                if _unlink(f):
                    result['deleted'] += 1
                    result['freed_bytes'] += size
                    total_bytes -= size

    return result


def _unlink(path: Path) -> bool:
    try:
        path.unlink()
        return True
    except OSError:
        logging.exception('Retención: no se pudo borrar %s', path)
        return False
