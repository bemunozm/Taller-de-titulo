import requests
import logging
import time
from typing import Optional
from lpr.settings import settings
from lpr.utils.pii import mask_plate

# Estados que `post_event`/`_post_request` devuelven cuando NO hubo respuesta HTTP:
# * STATUS_NOT_SENT: el request no llegó al backend (DNS, conexión rechazada,
#   timeout al conectar): es seguro reintentar y NO se consume el dedupe.
# * STATUS_MAYBE_SENT: el request pudo llegar (timeout leyendo la respuesta,
#   conexión cortada a mitad): el backend pudo haberlo procesado y abierto el
#   portón. No se reintenta (duplicaría el evento) y el dedupe SÍ se consume para
#   no reabrir.
STATUS_NOT_SENT = -1
STATUS_MAYBE_SENT = -2

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


def classify_post_exception(exc: BaseException) -> int:
    """`STATUS_NOT_SENT` si el request seguro no llegó al backend; `STATUS_MAYBE_SENT`
    ante cualquier duda (ante la duda, el dedupe se consume: es más seguro perder
    un evento que reabrir el portón)."""
    if isinstance(exc, requests.exceptions.ConnectTimeout):
        return STATUS_NOT_SENT
    if isinstance(exc, requests.exceptions.ReadTimeout):
        return STATUS_MAYBE_SENT
    if isinstance(exc, requests.exceptions.SSLError):
        return STATUS_NOT_SENT  # falla el handshake antes de enviar el cuerpo
    if isinstance(exc, requests.exceptions.ConnectionError):
        # `ConnectionError(MaxRetryError(reason=NewConnectionError|NameResolutionError))`
        # = no se pudo ni abrir la conexión. Un "Connection aborted" (ProtocolError)
        # ocurre con la conexión ya abierta: el request pudo haberse enviado.
        reason = getattr(exc.args[0], 'reason', None) if exc.args else None
        name = type(reason).__name__
        if name in ('NewConnectionError', 'NameResolutionError', 'ConnectTimeoutError'):
            return STATUS_NOT_SENT
        return STATUS_MAYBE_SENT
    return STATUS_MAYBE_SENT


def _redact_dto_for_log(dto: dict) -> dict:
    """Copia del DTO apta para logs: patente enmascarada y sin la imagen base64."""
    safe = dict(dto)
    for key in ('plate', 'plate_raw'):
        if key in safe:
            safe[key] = mask_plate(safe[key])
    meta = safe.get('meta')
    if isinstance(meta, dict):
        safe['meta'] = {k: v for k, v in meta.items() if k not in ('snapshot_jpeg_b64', 'char_confidences')}
    return safe


def _post_request(url: str, dto: dict, dry_run: bool = True) -> int:
    """Función base para envíos POST al backend con reintentos y auth.

    Devuelve el código HTTP, `STATUS_NOT_SENT` (-1) o `STATUS_MAYBE_SENT` (-2).
    Solo se reintenta cuando el request seguro no llegó. Nunca sigue redirects:
    el `x-api-key` terminaría en otro host.
    """
    if dry_run:
        logging.info('DRY RUN - evento (no enviado) a %s: %s', url, _redact_dto_for_log(dto))
        return 200

    headers = {'Content-Type': 'application/json', **service_headers()}

    attempts = 3
    backoff = 1.0
    for attempt in range(1, attempts + 1):
        try:
            resp = requests.post(url, json=dto, headers=headers, timeout=10, allow_redirects=False)
            logging.info('POST %s -> %s (attempt %d)', url, resp.status_code, attempt)
            return resp.status_code
        except Exception as exc:
            outcome = classify_post_exception(exc)
            logging.exception('Error POST hacia backend %s (attempt %d, %s)', url, attempt,
                              'no enviado' if outcome == STATUS_NOT_SENT else 'posiblemente enviado')
            if outcome == STATUS_MAYBE_SENT:
                return STATUS_MAYBE_SENT  # reintentar duplicaría el evento
            if attempt < attempts:
                time.sleep(backoff)
                backoff *= 2
    return STATUS_NOT_SENT

def backend_base_url(backend_url: str) -> str:
    """Raíz de la API a partir de la URL de ingesta configurada.

    `backend_url` puede venir como la raíz (`.../api/v1`) o ya apuntando a la
    ingesta (`.../detections`, `.../detections/plates`, `.../anomalies`); las
    rutas de lectura cuelgan siempre de la raíz.
    """
    base = (backend_url or '').rstrip('/')
    for suffix in ('/detections/plates', '/detections', '/anomalies'):
        if base.endswith(suffix):
            return base[: -len(suffix)]
    return base


def fetch_camera_json(backend_url: str, path: str, timeout: float = 5.0) -> Optional[dict]:
    """GET autenticado (API key de servicio) de una ruta de lectura del backend.

    Devuelve el JSON (objeto) solo ante un 200; ante cualquier otra cosa (4xx,
    5xx, red caída, cuerpo no JSON u otro tipo que un objeto) loguea y devuelve
    `None`. NUNCA lanza: los llamadores deciden qué conservar ante un fallo
    (zonas anteriores, última config válida), así que un `None` jamás debe
    interpretarse como "sin configuración". No se loguea el cuerpo ni los
    headers (la respuesta puede traer datos de la cámara; el request, la key).
    No aplica `dry_run`: es lectura, y un dry-run igual debe usar la config real.
    """
    url = f"{backend_base_url(backend_url)}/{path.lstrip('/')}"
    try:
        resp = requests.get(url, headers=service_headers(), timeout=timeout, allow_redirects=False)
    except Exception as exc:
        logging.warning('GET %s falló sin respuesta (%s)', path, type(exc).__name__)
        return None
    if resp.status_code != 200:
        logging.warning('GET %s respondió %s', path, resp.status_code)
        return None
    try:
        data = resp.json()
    except Exception:
        logging.warning('GET %s respondió 200 con un cuerpo que no es JSON', path)
        return None
    if not isinstance(data, dict):
        logging.warning('GET %s respondió 200 con un JSON que no es un objeto', path)
        return None
    return data


def is_success(status_code: int) -> bool:
    """True si el POST fue aceptado (2xx). Negativos = no hubo respuesta HTTP."""
    return 200 <= int(status_code) < 300


def consumes_dedupe(status_code: int) -> bool:
    """¿El worker debe marcar el dedupe de la patente? Sí si el backend la aceptó
    o si pudo haberla recibido (`STATUS_MAYBE_SENT`); no si seguro no llegó."""
    return is_success(status_code) or int(status_code) == STATUS_MAYBE_SENT


def post_event(backend_url: str, payload: dict, dry_run: bool = True) -> int:
    """Envía una detección de patente (LPR) al backend.

    Devuelve el código HTTP (o -1 sin respuesta); usar `is_success` para saber
    si el backend la aceptó: el dedupe del worker solo se consume en ese caso.
    """
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
    # `direction` ('entry'|'exit'|'unknown') y `track` ({id, reads, votes,
    # winner_share}) son el contrato de la ingesta con el seguimiento + voto.
    allowed_meta = ['bbox', 'snapshot_jpeg_b64', 'char_confidences', 'char_conf_min', 'char_conf_mean',
                    'confirmed_by', 'direction', 'track']
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
