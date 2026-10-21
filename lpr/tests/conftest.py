"""Asegura que el paquete `lpr` sea importable al correr pytest desde el
subproyecto, sin depender de una instalación (`pip install -e .`).

Agrega la raíz del repo (padre de `lpr/`) al `sys.path`. Una vez que el
empaquetado (`pyproject.toml`) quede arreglado en Fase 3.B, esto se vuelve
redundante pero inofensivo.
"""
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


# --- Aislamiento del entorno -------------------------------------------------
# `lpr.settings` instancia `Settings()` al IMPORTARSE y lee `lpr/.env` (con la API
# key real y LPR_DEVICE de la máquina de desarrollo). Los tests no deben depender
# de eso ni hablar con el backend/manager vivos: el manager reconcilia al arrancar
# (`TestClient`) y lanzaría workers reales. Por eso, ANTES de que cualquier test
# importe `lpr.settings`: se apunta el env file a uno inexistente y se limpian las
# variables del proceso que Settings leería. Los tests que necesitan un valor lo
# fijan con monkeypatch.
import os  # noqa: E402

os.environ['LPR_ENV_FILE'] = str(Path(__file__).resolve().parent / '.env.does-not-exist')
for _name in [n for n in os.environ if n.startswith(('LPR_', 'WORKER_', 'CLOUDINARY_')) and n != 'LPR_ENV_FILE']:
    del os.environ[_name]
