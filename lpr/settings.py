import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional
from types import SimpleNamespace
from pydantic import BaseModel, Field, field_validator

from lpr.utils.direction import DirectionLine
try:
    # pydantic v2+: BaseSettings moved to pydantic-settings package
    from pydantic import BaseSettings  # type: ignore
except Exception:
    try:
        from pydantic_settings import BaseSettings  # type: ignore
    except Exception:
        # fallback: try older pydantic import (v1)
        from pydantic import BaseSettings  # type: ignore


# Secreto compartido backend <-> manager (Fase 4 · P2, hallazgo M4). Mismas
# reglas que backend/src/config/env.validation.ts: secreto real de al menos 32
# caracteres y sin valores de ejemplo. Los mensajes nunca incluyen el valor.
MIN_MANAGER_SECRET_LENGTH = 32
_PLACEHOLDER_PATTERNS = (
    re.compile(r'change[-_ ]?me'),
    re.compile(r'^your[-_]'),
    re.compile(r'^<.*>$'),
    re.compile(r'example'),
    re.compile(r'placeholder'),
    re.compile(r'^(?:changeme|todo|xxx+)$'),
)


def is_placeholder_secret(value: str) -> bool:
    """True si `value` parece un valor de relleno (p. ej. el del .env.example)."""
    normalized = value.strip().lower()
    return any(pattern.search(normalized) for pattern in _PLACEHOLDER_PATTERNS)


class Settings(BaseSettings):
    # Manager / backend
    # URL base de la API del backend, CON el prefijo global (p. ej.
    # http://localhost:3000/api/v1). El manager consulta `/workers/cameras`.
    WORKER_BACKEND_URL: Optional[str] = Field(None, min_length=1)
    # Secreto que el backend envía al manager (Authorization: Bearer). Sin
    # valor, el manager rechaza toda petición (fail-closed) salvo el escape
    # hatch de abajo. Con valor, debe ser un secreto real (ver
    # `_validate_manager_secret`): un valor débil impide arrancar.
    WORKER_MANAGER_SECRET: Optional[str] = None
    # Escape hatch solo-dev: permite arrancar el manager SIN secreto. En
    # producción debe quedar en False (fail-closed).
    WORKER_MANAGER_ALLOW_NO_SECRET: bool = False
    WORKER_MANAGER_PORT: int = 8000
    WORKER_MANAGER_HOST: str = '0.0.0.0'
    WORKER_MANAGER_RELOAD: bool = False
    WORKER_MANAGER_WORKERS: int = 1

    # Supervisión de procesos (Fase 3.C — operabilidad). El manager hacía
    # Popen y nunca poll()/wait(): un worker caído quedaba zombie y /health
    # mentía. Este hilo cosecha procesos muertos y los reinicia con backoff,
    # hasta un tope de reinicios por cámara dentro de una ventana.
    LPR_SUPERVISOR_INTERVAL: float = Field(5.0, gt=0)
    LPR_SUPERVISOR_MAX_RESTARTS: int = Field(5, ge=0)
    LPR_SUPERVISOR_RESTART_WINDOW_SECONDS: float = Field(300.0, gt=0)
    LPR_SUPERVISOR_BACKOFF_BASE_SECONDS: float = Field(2.0, gt=0)
    LPR_SUPERVISOR_BACKOFF_MAX_SECONDS: float = Field(60.0, gt=0)
    # Límite duro de procesos worker concurrentes que el manager acepta arrancar.
    LPR_MAX_PROCS: int = Field(8, ge=1)
    # Hilos del ThreadPoolExecutor DENTRO de cada proceso worker (no confundir
    # con LPR_MAX_PROCS, que cuenta procesos). Declarada acá porque Settings
    # rechaza variables extra del .env; antes los workers la leían de os.environ
    # y ponerla en el .env impedía arrancar.
    LPR_MAX_WORKERS: int = Field(1, ge=1)

    # LPR worker
    LPR_RTSP_URL: Optional[str] = None
    LPR_CAMERA_ID: Optional[str] = None
    LPR_BACKEND_URL: Optional[str] = None
    # Frecuencia de muestreo del stream (fotogramas por segundo que se envían
    # al detector). Precedencia de la fuente (ver `resolve_sample_fps`):
    #   1. `lprSettings.sampleFps` de la cámara (se fusiona en `apply_camera_settings`),
    #   2. LPR_SAMPLE_FPS,
    #   3. LPR_POLL_INTERVAL (obsoleto, en segundos: fps = 1 / valor),
    #   4. el argv `poll_interval` que pasa el manager,
    #   5. 1 fps.
    # Antes `LPR_POLL_INTERVAL` tenía default 1.0 y `x or y` hacía que el argv
    # NUNCA se usara. Ahora ambos son None si no se configuran.
    LPR_SAMPLE_FPS: Optional[float] = Field(None, gt=0, le=30)
    LPR_POLL_INTERVAL: Optional[float] = Field(None, gt=0)
    # Resolución de entrada del detector (YOLO `imgsz`). 640 es el default de
    # ultralytics y lo que corría en producción; el portón 1920x1080 necesita
    # 1920 para ver patentes de ~40-80 px (evaluación 2026-10-20).
    LPR_DETECTOR_IMGSZ: int = Field(640, ge=32, le=4096)
    # Dispositivo del detector ("cpu", "cuda:0"...). None = automático de
    # ultralytics. Es del HOST (hardware), por eso es global y no por cámara.
    LPR_DEVICE: Optional[str] = None
    LPR_OCR_DEVICE: str = Field('cpu', min_length=1)
    # Filtro de forma del recorte de la patente (antes hardcodeado). `MAX_W`
    # vacío = sin tope. Defaults conservadores = el comportamiento previo.
    LPR_CROP_MIN_W: int = Field(30, ge=0)
    LPR_CROP_MAX_W: Optional[int] = Field(None, ge=1)
    LPR_CROP_MIN_H: int = Field(10, ge=0)
    LPR_CROP_MIN_AREA: int = Field(300, ge=0)
    LPR_CROP_MIN_RATIO: float = Field(2.0, gt=0)
    LPR_CROP_MAX_RATIO: float = Field(12.0, gt=0)
    # Seguimiento + voto (reemplaza `plate_sightings`/`should_confirm`): lecturas
    # concordantes de UN mismo vehículo necesarias para emitir, y segundos sin
    # ver la patente tras los cuales el seguimiento se cierra.
    LPR_CONFIRM_READS: int = Field(3, ge=1, le=10)
    LPR_TRACK_MAX_GAP_SECONDS: float = Field(1.5, gt=0)
    # Participación mínima del texto ganador (ponderada por confianza OCR) para emitir.
    LPR_MIN_WINNER_SHARE: float = Field(0.6, ge=0, le=1)
    # Direccion por linea de cruce: tras confirmar la patente, la emision espera
    # hasta este tiempo a que el VEHICULO cruce la linea configurada; vencido,
    # emite con el mejor respaldo (motion > width > unknown). 0 = no esperar.
    # Solo por entorno (no por camara): el backend no lo gobierna.
    LPR_DIRECTION_WAIT_SECONDS: float = Field(4.0, ge=0, le=30)
    # Modelo COCO para seguir vehiculos (ByteTrack). Vacio = el `yolo11n.pt` de lpr/.
    LPR_VEHICLE_MODEL: str = ''
    LPR_DRY_RUN: bool = False
    LPR_DETECTOR_MODEL: str = 'morsetechlab/yolov11-license-plate-detection'
    LPR_OCR_MODEL: str = 'cct-s-v1-global-model'
    LPR_MIN_DET_CONF: float = 0.3
    LPR_DETECTIONS_DIR: str = './lpr/detecciones'
    LPR_SAVE_CROPS_DIR: str = './lpr/detecciones/crops'
    LPR_SAVE_FRAMES_DIR: str = './lpr/detecciones/frames'
    # OBSOLETOS desde el seguimiento + voto (sin efecto en el worker): LPR_DET_HIGH_CONF,
    # LPR_OCR_HIGH_CONF, LPR_MIN_CHAR_CONF_RATIO, LPR_DET_CONF_THRESHOLD,
    # LPR_OCR_CONF_THRESHOLD, LPR_CONFIRM_FRAMES, LPR_CONFIRM_SECONDS,
    # LPR_SIGHTING_TTL_SECONDS, LPR_COMBINED_ALPHA, LPR_COMBINED_THRESHOLD y
    # LPR_MIN_EVENT_INTERVAL. Se declaran igual porque Settings rechaza variables
    # extra: quitarlas rompería el arranque de un .env existente.
    LPR_DET_HIGH_CONF: float = 0.55
    LPR_OCR_HIGH_CONF: float = 0.98
    LPR_MIN_EVENT_INTERVAL: float = 2.0
    LPR_FORCE_SAVE_ON_OCR: bool = True
    LPR_SAVE_ONLY_ON_PLATE: bool = True
    LPR_MIN_CHAR_CONF_RATIO: float = 0.6
    LPR_DEDUP_SECONDS: float = 120.0
    LPR_DET_CONF_THRESHOLD: float = 0.55
    LPR_OCR_CONF_THRESHOLD: float = 0.98
    LPR_CONFIRM_FRAMES: int = 3
    LPR_CONFIRM_SECONDS: float = 5.0
    # Ventana de avistamiento: tras este tiempo sin ver una patente, se olvida
    # su conteo. Acota `plate_sightings` al paso ACTUAL de un vehículo para que
    # la confirmación multi-frame no se degrade con el uptime del proceso.
    LPR_SIGHTING_TTL_SECONDS: float = 30.0
    LPR_COMBINED_ALPHA: float = 0.75
    LPR_COMBINED_THRESHOLD: float = 0.3
    # plate regex may be empty in .env; treat empty as unset/None
    LPR_PLATE_REGEX: Optional[str] = None
    LPR_MIN_CHAR_CONF: float = Field(0.30, ge=0, le=1)
    LPR_INCLUDE_SNAPSHOT: bool = True
    # ÚNICA credencial del LPR contra el backend (Fase 4 · P2: se retiraron
    # WORKER_BACKEND_TOKEN y LPR_WORKER_TOKEN, que mandaban un Bearer JWT que
    # el backend ya no acepta). API key de servicio (plugin `apiKey` de
    # better-auth) enviada en el header `x-api-key` por:
    #   - el worker, en la ingesta (POST /detections/plates,
    #     /detections/plates/attempts, POST/GET /anomalies);
    #   - el manager, al reconciliar (GET /workers/cameras y
    #     /workers/cameras/:id/source).
    # Debe emitirla un admin CON condominio vía
    # `POST /api/v1/auth/service-api-keys` (permiso
    # "auth.manage-service-tokens"): la key queda acotada a ese condominio y
    # sin él /workers/* responde 403. La key en texto plano se muestra una
    # sola vez en esa respuesta.
    LPR_SERVICE_API_KEY: Optional[str] = None

    # Reconexión RTSP (Fase 3.C — operabilidad). Antes el stream se abría una
    # sola vez: si caía, `cap.read()` devolvía False para siempre (o
    # bloqueaba indefinidamente sin timeouts) y el worker quedaba "vivo" pero
    # ciego. Ver `utils/capture.py`.
    LPR_STREAM_OPEN_TIMEOUT_MS: int = Field(10000, gt=0)
    LPR_STREAM_READ_TIMEOUT_MS: int = Field(8000, gt=0)
    # Lecturas fallidas consecutivas antes de forzar una reconexión.
    LPR_STREAM_MAX_READ_FAILURES: int = Field(15, ge=1)
    # Si no llega un frame nuevo en N segundos, forzar reconexión aunque
    # `read()` no esté devolviendo False (stream congelado).
    LPR_STREAM_STALE_SECONDS: float = Field(20.0, gt=0)
    # Intentos de reapertura por ciclo de reconexión antes de rendirse y
    # terminar el proceso (para que el supervisor del manager lo reinicie).
    LPR_STREAM_RECONNECT_MAX_ATTEMPTS: int = Field(5, ge=1)
    LPR_STREAM_RECONNECT_BACKOFF_SECONDS: float = Field(2.0, gt=0)

    # Guardián — refetch periódico de zonas/config (Fase 3.C). Antes
    # `_fetch_zones()` solo corría en `__init__`: editar zonas o el toggle
    # `enableGuardian` en la UI no tenía efecto hasta reiniciar el proceso.
    LPR_ZONES_REFETCH_SECONDS: float = Field(60.0, gt=0)

    # Retención de disco (Fase 3.C). Sin esto, detecciones/crops/frames
    # crecen sin cota y llenan la SD de la Raspberry Pi.
    LPR_RETENTION_DAYS: float = Field(7, ge=0)
    LPR_RETENTION_MAX_MB: float = Field(2000, ge=0)
    LPR_RETENTION_CHECK_INTERVAL_SECONDS: float = Field(3600.0, gt=0)

    # Logging
    LOG_LEVEL: str = 'INFO'
    # Rotación de logs (Fase 3.C): antes el log crecía sin cota (~48MB/día/cámara
    # medido con verbose=True en YOLO). Ver utils/logging_setup.py.
    LPR_LOG_MAX_BYTES: int = Field(10_000_000, gt=0)
    LPR_LOG_BACKUP_COUNT: int = Field(3, ge=0)

    # Cloudinary
    CLOUDINARY_CLOUD_NAME: Optional[str] = None
    CLOUDINARY_API_KEY: Optional[str] = None
    CLOUDINARY_API_SECRET: Optional[str] = None
    CLOUDINARY_UPLOAD: bool = False
    CLOUDINARY_DELETE_LOCAL: bool = False
    CLOUDINARY_UPLOAD_RETRIES: int = 3
    CLOUDINARY_RETRY_BACKOFF: float = 1.0

    class Config:
        # `LPR_ENV_FILE` permite apuntar a otro archivo (los tests lo fijan a uno
        # inexistente para no leer el `.env` local con credenciales reales). Sin
        # definir, es `lpr/.env`: el comportamiento de producción no cambia.
        env_file = os.environ.get('LPR_ENV_FILE') or str(Path(__file__).parent / '.env')
        env_file_encoding = 'utf-8'
        # Los errores de validación no repiten el valor recibido: un secreto
        # inválido no debe terminar en logs.
        hide_input_in_errors = True

    @field_validator('LPR_SAMPLE_FPS', 'LPR_POLL_INTERVAL', 'LPR_DEVICE', 'LPR_CROP_MAX_W', mode='before')
    @classmethod
    def _empty_is_unset(cls, value: object) -> object:
        # Un `.env` con `LPR_CROP_MAX_W=` (vacío) significa "sin configurar".
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator('WORKER_MANAGER_SECRET', mode='before')
    @classmethod
    def _validate_manager_secret(cls, value: object) -> Optional[str]:
        if value is None:
            return None
        secret = str(value).strip()
        if not secret:
            # Vacío = no configurado (el manager queda fail-closed).
            return None
        if is_placeholder_secret(secret):
            raise ValueError(
                'WORKER_MANAGER_SECRET tiene un valor de ejemplo/placeholder; '
                'genera uno con `openssl rand -base64 32`'
            )
        if len(secret) < MIN_MANAGER_SECRET_LENGTH:
            raise ValueError(
                f'WORKER_MANAGER_SECRET debe tener al menos {MIN_MANAGER_SECRET_LENGTH} '
                'caracteres (genera uno con `openssl rand -base64 32`)'
            )
        return secret

    # validators in BaseSettings are easier in pydantic v2 via model_validators;
    # keep simple helper that resolves relative paths when Settings is created.
    def model_post_init(self, __context):  # pydantic v2 hook
        # resolve commonly used directories to absolute paths relative to package
        pkg_dir = Path(__file__).parent
        project_root = pkg_dir.parent

        def _resolve(p: Optional[str]) -> Optional[str]:
            if not p:
                return p
            pth = Path(p)
            if pth.is_absolute():
                return str(pth)
            s = str(p).lstrip('./\\')
            first = Path(s).parts[0] if Path(s).parts else ''
            if first == 'lpr':
                return str((project_root / Path(s)).resolve())
            return str((pkg_dir / Path(s)).resolve())

        # mutate self in-place (acceptable for settings bootstrap)
        try:
            self.LPR_DETECTIONS_DIR = _resolve(self.LPR_DETECTIONS_DIR)
            self.LPR_SAVE_CROPS_DIR = _resolve(self.LPR_SAVE_CROPS_DIR)
            self.LPR_SAVE_FRAMES_DIR = _resolve(self.LPR_SAVE_FRAMES_DIR)
        except Exception:
            # non-fatal: leave values as-is
            pass


settings = Settings()


# Compatibility: lightweight worker config builder moved here so
# all configuration logic is centralized in settings.py. This replaces the
# previous lpr/config.py implementation. We return a SimpleNamespace instead
# of a dedicated dataclass to keep the public API minimal.
import os


class WorkerConfig(BaseModel):
    mode: str = Field('patente', min_length=1)
    rtsp_url: Optional[str] = Field(None)
    camera_id: Optional[str] = Field(None, min_length=1)
    backend_url: Optional[str] = Field(None, min_length=1)
    # Segundos entre fotogramas muestreados (= 1 / sample_fps). Lo usa el bucle
    # de captura; se mantiene derivado de `sample_fps` en un solo lugar.
    poll_interval: float = Field(1.0, gt=0)
    sample_fps: float = Field(1.0, gt=0, le=30)
    ocr_device: str = Field('cpu', min_length=1)
    # Dispositivo del detector; None = automático de ultralytics.
    device: Optional[str] = None
    detector_imgsz: int = Field(640, ge=32, le=4096)
    detector_model: str = Field('morsetechlab/yolov11-license-plate-detection', min_length=1)
    ocr_model: str = Field('cct-s-v1-global-model', min_length=1)
    min_det_conf: float = Field(0.3, ge=0, le=1)
    dry_run: bool = True
    save_crops_dir: Optional[str] = Field('', description='path to save crop images')
    save_frames_dir: Optional[str] = Field('', description='path to save frames')
    detections_dir: str = Field('detecciones', min_length=1)
    min_crop_w: int = Field(30, ge=0)
    max_crop_w: Optional[int] = Field(None, ge=1)
    min_crop_h: int = Field(10, ge=0)
    min_crop_area: int = Field(300, ge=0)
    min_crop_ratio: float = Field(2.0, gt=0)
    max_crop_ratio: float = Field(12.0, gt=0)
    # --- Configuración por cámara (lprSettings del backend, ver
    # `apply_camera_settings`). Los defaults equivalen a "sin configuración".
    # `action` solo viaja para que el worker sepa el modo: la política de
    # apertura vive en el backend, que es quien abre el portón.
    action: str = Field('access', pattern='^(register|access)$')
    # entry/exit fijan la dirección; 'both' la infiere por la tendencia del
    # ancho de la caja; 'unknown' (default sin config) no infiere nada.
    direction: str = Field('unknown', pattern='^(entry|exit|both|unknown)$')
    # Polígonos normalizados 0-1 (misma forma que las zonas del Guardián).
    zone: Optional[List[List[Dict[str, float]]]] = None
    confirm_reads: int = Field(3, ge=1, le=10)
    track_max_gap_seconds: float = Field(1.5, gt=0)
    # Participación mínima (ponderada por confianza OCR) del texto ganador para
    # emitir: un track con lecturas muy divididas no se emite aunque llegue a N.
    min_winner_share: float = Field(0.6, ge=0, le=1)
    # Linea de direccion normalizada 0-1 (contrato `lprSettings.directionLine`):
    # {'from': {'x','y'}, 'to': {'x','y'}, 'exitSide': 'left'|'right'}. None = sin linea.
    direction_line: Optional[Dict[str, Any]] = None
    # Fail-closed: zona de detección inválida y sin una válida previa. La cámara
    # no detecta nada (ver `apply_camera_settings`).
    detection_blocked: bool = False


def resolve_sample_fps(poll_interval_arg: Optional[float] = None) -> float:
    """Fuente de la frecuencia de muestreo, en fps, con precedencia explícita:
    LPR_SAMPLE_FPS > LPR_POLL_INTERVAL (obsoleto, 1/s) > argv `poll_interval` > 1 fps.
    La fuente por cámara (`lprSettings.sampleFps`) se aplica DESPUÉS, encima del
    resultado, en `apply_camera_settings`."""
    if settings.LPR_SAMPLE_FPS:
        return float(settings.LPR_SAMPLE_FPS)
    if settings.LPR_POLL_INTERVAL:
        return 1.0 / float(settings.LPR_POLL_INTERVAL)
    if poll_interval_arg:
        return 1.0 / float(poll_interval_arg)
    return 1.0


def build_worker_config(rtsp_url: Optional[str], camera_id: Optional[str], backend_url: Optional[str], poll_interval: Optional[float], mode: str = 'patente') -> WorkerConfig:
    """Construye LprConfig a partir de los valores en `settings` y argumentos.

    Esta función mantiene la resolución de rutas relativas respecto al repo
    y al paquete `lpr` para compatibilidad con el código existente.
    """
    rtsp = rtsp_url if rtsp_url is not None else settings.LPR_RTSP_URL
    cam = camera_id if camera_id is not None else settings.LPR_CAMERA_ID
    if not cam:
        cam = 'cam-unknown'
    # Sanear el cameraId: todo path/nombre de archivo se construye a partir de él
    # (defensa contra path traversal si el worker se lanza directo, sin pasar por
    # el validador del manager). Un UUID / UUID_guardia legítimo no se altera.
    cam = re.sub(r'[^A-Za-z0-9_-]', '_', str(cam))
    backend = settings.LPR_BACKEND_URL or backend_url or settings.WORKER_BACKEND_URL or 'http://127.0.0.1:3000/lpr/events'
    fps = resolve_sample_fps(poll_interval)
    dry = bool(settings.LPR_DRY_RUN)
    # build a WorkerConfig pydantic model with the expected attributes
    cfg = WorkerConfig(
        mode=mode,
        rtsp_url=rtsp,
        camera_id=cam,
        backend_url=backend,
        poll_interval=1.0 / fps,
        sample_fps=fps,
        ocr_device=settings.LPR_OCR_DEVICE,
        device=settings.LPR_DEVICE,
        detector_imgsz=settings.LPR_DETECTOR_IMGSZ,
        confirm_reads=settings.LPR_CONFIRM_READS,
        track_max_gap_seconds=settings.LPR_TRACK_MAX_GAP_SECONDS,
        min_winner_share=settings.LPR_MIN_WINNER_SHARE,
        detector_model=(settings.LPR_DETECTOR_MODEL or 'morsetechlab/yolov11-license-plate-detection'),
        ocr_model=(settings.LPR_OCR_MODEL or 'cct-s-v1-global-model'),
        min_det_conf=settings.LPR_MIN_DET_CONF or 0.3,
        dry_run=dry,
        save_crops_dir=(settings.LPR_SAVE_CROPS_DIR or ''),
        save_frames_dir=(settings.LPR_SAVE_FRAMES_DIR or ''),
        detections_dir=(settings.LPR_DETECTIONS_DIR or 'detecciones'),
        min_crop_w=settings.LPR_CROP_MIN_W,
        max_crop_w=settings.LPR_CROP_MAX_W,
        min_crop_h=settings.LPR_CROP_MIN_H,
        min_crop_area=settings.LPR_CROP_MIN_AREA,
        min_crop_ratio=settings.LPR_CROP_MIN_RATIO,
        max_crop_ratio=settings.LPR_CROP_MAX_RATIO,
    )

    pkg_dir = Path(__file__).parent
    project_root = pkg_dir.parent

    def _resolve_path(p: Optional[str]) -> Optional[str]:
        if not p:
            return p
        path = Path(p)
        if path.is_absolute():
            return str(path)
        s = str(p).lstrip('./\\')
        first_part = Path(s).parts[0] if Path(s).parts else ''
        if first_part == 'lpr':
            return str((project_root / Path(s)).resolve())
        return str((pkg_dir / Path(s)).resolve())

    cfg.detections_dir = _resolve_path(settings.LPR_DETECTIONS_DIR or cfg.detections_dir)
    cfg.save_crops_dir = _resolve_path(settings.LPR_SAVE_CROPS_DIR or cfg.save_crops_dir)
    cfg.save_frames_dir = _resolve_path(settings.LPR_SAVE_FRAMES_DIR or cfg.save_frames_dir)
    return cfg


# --------------------------------------------------------------------------
# Configuración por cámara (contrato con el backend, `lprSettings`)
# --------------------------------------------------------------------------
# Las reglas de validación están en `contracts/lpr-settings.cases.json` (raíz del
# repo), que comparten backend, frontend y este worker: si cambias una, cambia el
# archivo (ver `tests/test_lpr_settings_contract.py`).
ALLOWED_DETECTOR_IMGSZ = (640, 960, 1280, 1920)
# En modo acceso (el que puede abrir el portón) menos de 3 lecturas concordantes
# por vehículo no es aceptable (la evaluación con N=2 dio una patente incorrecta).
# Solo `action='register'` puede bajar de ahí.
MIN_CONFIRM_READS_ACCESS = 3
MAX_ZONE_POLYGONS = 20
MAX_ZONE_POINTS = 100
# Clave interna que `camera_settings_updates` agrega cuando la zona vino rota.
ZONE_INVALID_KEY = '_zone_invalid'
# Idem para `directionLine` (se conserva la previa, como con la zona).
DIRECTION_LINE_INVALID_KEY = '_direction_line_invalid'


def _as_int(value: Any) -> Optional[int]:
    # bool es subclase de int: `True` no es un entero válido acá.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value) if float(value).is_integer() else None


def _as_number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _clean_zone(raw: Any) -> Optional[List[List[Dict[str, float]]]]:
    """Polígonos válidos (3-100 puntos con x, y en 0-1), o None si no hay ninguno
    (o si hay más de MAX_ZONE_POLYGONS)."""
    if not isinstance(raw, list) or len(raw) > MAX_ZONE_POLYGONS:
        return None
    polygons: List[List[Dict[str, float]]] = []
    for polygon in raw:
        if not isinstance(polygon, list) or not 3 <= len(polygon) <= MAX_ZONE_POINTS:
            continue
        points: List[Dict[str, float]] = []
        for point in polygon:
            x = _as_number(point.get('x')) if isinstance(point, dict) else None
            y = _as_number(point.get('y')) if isinstance(point, dict) else None
            if x is None or y is None or not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
                points = []
                break
            points.append({'x': x, 'y': y})
        if points:
            polygons.append(points)
    return polygons or None


def _crop_updates(crop: Mapping[str, Any], warn: Any) -> Dict[str, Any]:
    """Pares de recorte. Cada par va completo o no va: ancho (`minWidth` +
    `maxWidth`, este puede ser null = sin tope) y razón (`minRatio` + `maxRatio`),
    con min <= max. Un par incoherente se descarta SOLO él (vuelve al env); el otro
    par y el resto de la config no se tocan."""
    updates: Dict[str, Any] = {}
    if 'minWidth' in crop or 'maxWidth' in crop:
        min_w = _as_int(crop.get('minWidth'))
        has_max = 'maxWidth' in crop
        max_raw = crop.get('maxWidth')
        max_w = _as_int(max_raw)
        valid = (min_w is not None and 0 <= min_w <= 2000 and has_max
                 and (max_raw is None or (max_w is not None and 1 <= max_w <= 4000 and min_w <= max_w)))
        if valid:
            updates['min_crop_w'] = min_w
            updates['max_crop_w'] = None if max_raw is None else max_w
        else:
            warn('crop.minWidth/maxWidth', {'minWidth': crop.get('minWidth'), 'maxWidth': max_raw})
    if 'minRatio' in crop or 'maxRatio' in crop:
        min_r = _as_number(crop.get('minRatio'))
        max_r = _as_number(crop.get('maxRatio'))
        if (min_r is not None and max_r is not None and 0.1 <= min_r <= 20
                and 0.1 <= max_r <= 20 and min_r <= max_r):
            updates['min_crop_ratio'] = min_r
            updates['max_crop_ratio'] = max_r
        else:
            warn('crop.minRatio/maxRatio', {'minRatio': crop.get('minRatio'), 'maxRatio': crop.get('maxRatio')})
    return updates


def camera_settings_updates(settings_dict: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    """Traduce `lprSettings` (contrato del backend) a campos de `WorkerConfig`.

    Un campo ausente o `null` no aparece en el resultado (= default del env).
    Excepciones: `crop.maxWidth` y `zone` son opcionales por naturaleza, así
    que `maxWidth: null` (clave presente) quita el tope y `zone: []` quita la
    zona. Un valor inválido se ignora con un warning (nunca lanza): una config
    corrupta no debe tumbar al worker. Una zona que viene pero no es válida NO
    se ignora en silencio: se marca con `ZONE_INVALID_KEY` para que
    `apply_camera_settings` decida (conservar la anterior o no detectar).
    """
    updates: Dict[str, Any] = {}
    if not isinstance(settings_dict, Mapping):
        return updates

    def warn(name: str, value: Any) -> None:
        logging.warning('lprSettings.%s inválido (%r): se ignora', name, value)

    action = settings_dict.get('action')
    if action is not None:
        if action in ('register', 'access'):
            updates['action'] = action
        else:
            warn('action', action)
    # `action` ausente = access (la política segura).
    effective_action = updates.get('action', 'access')

    direction = settings_dict.get('direction')
    if direction is not None:
        if direction in ('entry', 'exit', 'both'):
            updates['direction'] = direction
        else:
            warn('direction', direction)

    raw_zone = settings_dict.get('zone')
    if raw_zone is not None:
        if raw_zone == []:
            updates['zone'] = None  # limpieza explícita
        else:
            zone = _clean_zone(raw_zone)
            if zone is None:
                warn('zone', raw_zone)
                updates[ZONE_INVALID_KEY] = True
            else:
                updates['zone'] = zone

    raw_line = settings_dict.get('directionLine')
    if raw_line is not None:
        line = DirectionLine.from_settings(raw_line)
        if line is None:
            warn('directionLine', raw_line)
            updates[DIRECTION_LINE_INVALID_KEY] = True
        else:
            updates['direction_line'] = line.to_settings()

    imgsz = settings_dict.get('detectorImgsz')
    if imgsz is not None:
        if _as_int(imgsz) in ALLOWED_DETECTOR_IMGSZ:
            updates['detector_imgsz'] = _as_int(imgsz)
        else:
            warn('detectorImgsz', imgsz)

    fps = settings_dict.get('sampleFps')
    if fps is not None:
        value = _as_number(fps)
        if value is not None and 1.0 <= value <= 15.0:
            updates['sample_fps'] = value
            updates['poll_interval'] = 1.0 / value
        else:
            warn('sampleFps', fps)

    reads = settings_dict.get('confirmReads')
    if reads is not None:
        value_i = _as_int(reads)
        if value_i is None or not 1 <= value_i <= 10:
            warn('confirmReads', reads)
        elif value_i < MIN_CONFIRM_READS_ACCESS and effective_action != 'register':
            logging.warning('lprSettings.confirmReads=%d no se aplica en modo acceso (mínimo %d)',
                            value_i, MIN_CONFIRM_READS_ACCESS)
        else:
            updates['confirm_reads'] = value_i

    crop = settings_dict.get('crop')
    if isinstance(crop, Mapping):
        updates.update(_crop_updates(crop, warn))
    elif crop is not None:
        warn('crop', crop)
    return updates


_CROP_FIELDS = ('min_crop_w', 'max_crop_w', 'min_crop_ratio', 'max_crop_ratio')


def apply_camera_settings(
    cfg: WorkerConfig,
    settings_dict: Optional[Mapping[str, Any]],
    previous: Optional[WorkerConfig] = None,
) -> WorkerConfig:
    """Fusiona los `lprSettings` de una cámara sobre una config base (env).

    Punto ÚNICO de fusión (lo usa el refetch en caliente). Pura: no muta `cfg` ni
    `previous` y devuelve una `WorkerConfig` nueva. Pasar siempre la config BASE
    (la que sale de `build_worker_config`), no la ya fusionada: así una clave que
    desaparece del backend vuelve al default del env.

    `previous` es la config que el worker tiene vigente. Solo sirve para la zona:
    la zona NUNCA se pierde por un dato roto.
    * zona válida -> se aplica;
    * `zone: []` o ausente -> sin zona (cuadro completo, configurado a propósito);
    * zona presente pero inválida -> se conserva la zona válida de `previous`; si
      nunca hubo una, FAIL-CLOSED: `detection_blocked=True` y la cámara no
      detecta (con log de error) en vez de ensanchar la detección a todo el cuadro.
    Un recorte incoherente descarta solo sus claves en conflicto.
    """
    updates = camera_settings_updates(settings_dict)
    zone_invalid = bool(updates.pop(ZONE_INVALID_KEY, False))
    if zone_invalid:
        if previous is not None and previous.zone:
            updates['zone'] = previous.zone
            logging.warning('lprSettings.zone inválida: se conserva la última zona válida')
        else:
            updates['detection_blocked'] = True
            logging.error('lprSettings.zone inválida y sin zona válida previa: la cámara %s NO detectará '
                          'patentes hasta recibir una zona válida (fail-closed)', cfg.camera_id)
    line_invalid = bool(updates.pop(DIRECTION_LINE_INVALID_KEY, False))
    if line_invalid:
        # A diferencia de la zona, sin linea previa NO hay fail-closed: sin linea
        # la direccion cae a los respaldos (ancho / unknown), no se pierde nada.
        if previous is not None and previous.direction_line:
            updates['direction_line'] = previous.direction_line
            logging.warning('lprSettings.directionLine inválida: se conserva la última línea válida')
        else:
            logging.warning('lprSettings.directionLine inválida y sin línea previa: se ignora')
    if not updates:
        return cfg
    merged = cfg
    for name, value in updates.items():
        try:
            merged = WorkerConfig.model_validate({**merged.model_dump(), name: value})
        except Exception:
            logging.warning('lprSettings: %s=%r rechazado por la validación de WorkerConfig', name, value)
    if merged.min_crop_ratio > merged.max_crop_ratio or (
            merged.max_crop_w is not None and merged.max_crop_w < merged.min_crop_w):
        # Solo posible si el propio env es incoherente: se revierte el recorte, no la config.
        logging.warning('Recorte incoherente tras la fusión: se vuelve a los valores base del recorte')
        merged = merged.model_copy(update={f: getattr(cfg, f) for f in _CROP_FIELDS})
    return merged
