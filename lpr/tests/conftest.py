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
