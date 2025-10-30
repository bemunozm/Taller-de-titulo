"""Paquete principal del servicio LPR (Lectura de Patentes).

Contiene módulos para configuración, captura RTSP, detector, OCR, persistencia,
API y el worker que orquesta el flujo.
"""

__all__ = [
    'config', 'detector', 'ocr', 'processor', 'storage', 'api', 'utils', 'cli'
]
try:
    # Importar settings centralizados y exponer la instancia como `lpr.settings`
    # `lpr.settings` será el objeto pydantic Settings() instanciado en lpr/settings.py
    from .settings import settings  # noqa: F401
except Exception:
    # no bloquear la importación del paquete si settings falla
    pass
