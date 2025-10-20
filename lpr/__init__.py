"""Paquete principal del servicio LPR (Lectura de Patentes).

Contiene módulos para configuración, captura RTSP, detector, OCR, persistencia,
API y el worker que orquesta el flujo.
"""

__all__ = [
    'config', 'detector', 'ocr', 'processor', 'storage', 'api', 'utils', 'cli'
]
