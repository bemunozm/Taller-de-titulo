import requests
import logging
import time
from lpr.settings import settings

def service_headers() -> dict:
    """Headers de autenticación del worker contra el backend.

    Los endpoints de máquina (ingesta: detections/plates,
    detections/plates/attempts, POST anomalies; y la lectura de zonas del
    Guardián, GET anomalies/cameras/:id/zones) exigen la API key de servicio
    de better-auth en el header `x-api-key` (ServiceApiKeyGuard en el
    backend). Es la única credencial: el Bearer JWT legacy se retiró en la
    Fase 4 (P2). Sin `LPR_SERVICE_API_KEY` el backend responde 401.
    """
    headers = {}
    if settings.LPR_SERVICE_API_KEY:
        headers['x-api-key'] = settings.LPR_SERVICE_API_KEY
    else:
        logging.warning(
            'LPR_SERVICE_API_KEY no está configurada — el backend rechazará este request '
            'con 401 si el endpoint exige API key de servicio (ver docs/modulos/auth-multitenant.md).'
        )
    return headers


def _post_request(url: str, dto: dict, dry_run: bool = True) -> int:
    """Función base para envíos POST al backend con reintentos y auth."""
    if dry_run:
        logging.info('DRY RUN - evento (no enviado) a %s: %s', url, dto)
        return 200

    headers = {'Content-Type': 'application/json', **service_headers()}

    attempts = 3
    backoff = 1.0
    for attempt in range(1, attempts + 1):
        try:
            resp = requests.post(url, json=dto, headers=headers, timeout=10)
            logging.info('POST %s -> %s (attempt %d)', url, resp.status_code, attempt)
            return resp.status_code
        except Exception:
            logging.exception('Error POST hacia backend %s (attempt %d)', url, attempt)
            if attempt < attempts:
                time.sleep(backoff)
                backoff *= 2
            else:
                return -1

def post_event(backend_url: str, payload: dict, dry_run: bool = True) -> int:
    """Envía una detección de patente (LPR) al backend."""
    # Asegurar endpoint de detecciones
    url = backend_url.rstrip('/')
    if not url.endswith('/detections/plates'):
        url += '/detections/plates'

    # Build payload according to CreatePlateDetectionDto
    dto = {
        'cameraId': payload.get('cameraId'),
        'plate': payload.get('plate'),
        'plate_raw': payload.get('plate_raw'),
        'det_confidence': payload.get('det_confidence'),
        'ocr_confidence': payload.get('ocr_confidence'),
        'detectionTimestamp': payload.get('detectionTimestamp'),
        'full_frame_path': payload.get('full_frame_path'),
    }

    # Meta de patente
    meta = {}
    allowed_meta = ['bbox', 'snapshot_jpeg_b64', 'char_confidences', 'char_conf_min', 'char_conf_mean', 'confirmed_by']
    for k in allowed_meta:
        if k in payload: meta[k] = payload.get(k)
    
    # Fusionar meta si existe
    if 'meta' in payload and isinstance(payload['meta'], dict):
        for k, v in payload['meta'].items():
            if k in allowed_meta: meta[k] = v
            
    if meta: dto['meta'] = meta
    
    return _post_request(url, dto, dry_run)

def post_anomaly(backend_url: str, payload: dict, dry_run: bool = True) -> int:
    """Envía una anomalía visual (Guardia) al backend."""
    # Asegurar endpoint de anomalías
    url = backend_url.rstrip('/')
    if '/detections' in url:
        url = url.replace('/detections', '/anomalies')
    elif not url.endswith('/anomalies'):
        url += '/anomalies'

    # El DTO de anomalía es más flexible pero requiere cameraId y anomalyType.
    # NO se envía mountPath: contenía la URL RTSP con credenciales y el backend
    # identifica la cámara por cameraId.
    dto = {
        'cameraId': payload.get('cameraId'),
        'anomalyType': payload.get('anomalyType'),
        'confidence': payload.get('confidence'),
        'detectionTimestamp': payload.get('detectionTimestamp'),
        'meta': payload.get('meta', {})
    }
    
    return _post_request(url, dto, dry_run)
