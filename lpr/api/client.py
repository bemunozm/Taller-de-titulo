import requests
import logging
import time
from lpr.settings import settings


def _compose_url(base: str) -> str:
    # If base already points to the plates endpoint, return as-is.
    if base.endswith('/detections/plates') or base.endswith('/detections/plates/'):
        return base.rstrip('/')
    # strip possible trailing slash and append
    return base.rstrip('/') + '/detections/plates'


def post_event(backend_url: str, payload: dict, dry_run: bool = True) -> int:
    """Envía una detección al endpoint /detections/plates del backend.

    - Si `backend_url` ya contiene la ruta completa, se usa tal cual.
    - Reempaqueta metadatos bajo la clave `meta` para cumplir el DTO del backend.
    - Soporta LPR_WORKER_TOKEN en las env para Authorization.
    - Reintentos simples con backoff.
    """
    if dry_run:
        logging.info('DRY RUN - evento (no enviado): %s', payload)
        return 200

    url = _compose_url(backend_url)

    # Build payload according to CreatePlateDetectionDto shape: top-level fields
    # are only the core ones; bbox/snapshot/char confidences go under `meta`.
    dto = {
        'cameraId': payload.get('cameraId'),
        'plate': payload.get('plate'),
        'plate_raw': payload.get('plate_raw'),
        'det_confidence': payload.get('det_confidence'),
        'ocr_confidence': payload.get('ocr_confidence'),
    }
    # optional fields
    if 'full_frame_path' in payload:
        dto['full_frame_path'] = payload.get('full_frame_path')
    if 'detectionTimestamp' in payload:
        dto['detectionTimestamp'] = payload.get('detectionTimestamp')

    # Collect meta but only include keys declared in backend DTO MetaPlateDto
    meta = {}
    allowed_meta_keys = ['bbox', 'snapshot_jpeg_b64', 'char_confidences', 'char_conf_min', 'char_conf_mean', 'confirmed_by']
    for k in allowed_meta_keys:
        if k in payload:
            meta[k] = payload.get(k)

    # Merge any existing meta object provided by caller, but only keep allowed keys
    if 'meta' in payload and isinstance(payload['meta'], dict):
        for k, v in payload['meta'].items():
            if k in allowed_meta_keys:
                meta[k] = v

    if meta:
        dto['meta'] = meta

    headers = {'Content-Type': 'application/json'}
    token = settings.LPR_WORKER_TOKEN or settings.WORKER_BACKEND_TOKEN
    if token:
        headers['Authorization'] = f'Bearer {token}'

    attempts = 3
    backoff = 1.0
    for attempt in range(1, attempts + 1):
        try:
            resp = requests.post(url, json=dto, headers=headers, timeout=5)
            logging.info('POST %s -> %s (attempt %d)', url, resp.status_code, attempt)
            return resp.status_code
        except Exception:
            logging.exception('Error POST hacia backend %s (attempt %d)', url, attempt)
            if attempt < attempts:
                time.sleep(backoff)
                backoff *= 2
            else:
                return -1
