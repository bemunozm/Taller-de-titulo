#!/usr/bin/python3 -I
"""vigilia-relay: configura y opera el relay de cámaras de Vigilia.

Una Raspberry Pi 3B en la conserjería corre MediaMTX v1.15.2, que toma
on-demand los streams RTSP del NVR Hikvision y los entrega por Tailscale. Este
CLI genera la config de MediaMTX a partir de /etc/vigilia-relay/relay.env y
cameras.conf, la aplica con rollback y muestra el estado. Ver README.md.

Diseño:
- Solo stdlib, Python >= 3.11 (Bookworm trae 3.11 y Trixie 3.13).
- El núcleo (parseo, validación, encoding, hash, render y redacción) es puro:
  no toca disco, red ni procesos. Los comandos (`cmd_*`) hacen el I/O a través
  de `Runtime`, que los tests reemplazan.
- Ninguna credencial entra por argv ni sale por stdout/stderr: todo texto que
  se imprime pasa por `Redactor`. La única excepción es `rotate-password`, que
  muestra UNA vez la clave nueva del lector a quien la pidió.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import contextlib
import errno
import functools
import getpass
import hashlib
import http.client
import ipaddress
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, TextIO

if sys.version_info < (3, 11):  # pragma: no cover - se ejecuta solo en un Python viejo
    sys.stderr.write("vigilia-relay requiere Python >= 3.11\n")
    raise SystemExit(1)

KIT_VERSION = "0.3.1"
MEDIAMTX_VERSION = "v1.15.2"

# --- Rutas y nombres -----------------------------------------------------------
DEFAULT_ETC_DIR = "/etc/vigilia-relay"
ETC_DIR_ENV = "VIGILIA_RELAY_ETC"
FFPROBE_ENV = "VIGILIA_RELAY_FFPROBE"
DEBUG_ENV = "VIGILIA_RELAY_DEBUG"

ENV_FILE = "relay.env"
CAMERAS_FILE = "cameras.conf"
API_SECRET_FILE = "api.secret"
READER_HASH_FILE = "reader.hash"
CONFIG_FILE = "mediamtx.yml"
PREV_SUFFIX = ".prev"

SERVICE_UNIT = "vigilia-relay.service"
SERVICE_GROUP = "vigilia-relay"
# Usuario sin privilegios con el que corre ffprobe cuando el CLI es root: lo
# que llega por la red (respuestas del NVR o de cualquiera que lo suplante en
# la LAN) no se parsea como root. No es vigilia-relay porque ese lee
# mediamtx.yml (con la clave del NVR).
PROBE_USER = "vigilia-probe"
SYSTEMD_UNIT_DIR = "/etc/systemd/system"
DROPIN_NAME = "10-ipaddress.conf"
FOLLOW_SERVICE_UNIT = "vigilia-relay-follow-nvr.service"
STATUS_UNITS = (SERVICE_UNIT, "tailscaled.service", "vigilia-relay-netwatch.timer", "vigilia-relay-follow-nvr.timer")

SECRET_MODE = 0o600
CONFIG_MODE = 0o640
DIR_MODE = 0o750
DROPIN_MODE = 0o644

# --- Usuarios y redes de MediaMTX --------------------------------------------
READER_USER = "relay-reader"
ADMIN_USER = "vigilia-admin"
LOOPBACK_NETWORKS = ("127.0.0.1/32", "::1/128")
# Rango CGNAT y ULA que usa Tailscale para las IPs de los nodos.
TAILSCALE_NETWORKS = ("100.64.0.0/10", "fd7a:115c:a1e0::/48")

# --- Valores por defecto ---------------------------------------------------------
DEFAULT_NVR_PORT = 554
DEFAULT_NVR_CHANNELS = 11
MAX_NVR_CHANNELS = 64
DEFAULT_RTSP_PORT = 8554
DEFAULT_API_PORT = 9997
MIN_RELAY_PORT = 1024

READER_PASSWORD_BYTES = 24  # token_urlsafe(24) -> 32 caracteres [A-Za-z0-9_-]
API_SECRET_BYTES = 32

PROBE_TIMEOUT_S = 8.0
# Margen del timeout de subprocess sobre el `-timeout` de ffprobe: el análisis
# del stream (analyzeduration) corre después de conectar.
PROBE_SUBPROCESS_MARGIN_S = 10.0
# ffprobe solo puede abrir estos protocolos (sin file:, http:, concat:, ...).
FFPROBE_PROTOCOLS = "rtsp,rtsps,tcp,tls,rtp,udp"
APPLY_WAIT_S = 30.0
ROLLBACK_WAIT_S = 45.0
APPLY_POLL_S = 1.0
# El confwatcher de MediaMTX v1.15.2 DESCARTA (no posterga) los cambios que
# llegan menos de 1 s después de la última recarga (`minInterval`, verificado
# en internal/confwatcher/confwatcher.go). Antes de escribir se espera a que
# la última escritura tenga al menos este margen.
RELOAD_GUARD_S = 1.5
API_TIMEOUT_S = 3.0
MAX_API_BODY_BYTES = 4 * 1024 * 1024

# pathDefaults acordados en el plan (no cambiar sin actualizarlo).
PATH_DEFAULTS: dict[str, Any] = {
    "sourceOnDemand": True,
    "sourceOnDemandStartTimeout": "15s",
    "sourceOnDemandCloseAfter": "30s",
    "rtspTransport": "tcp",
    "maxReaders": 3,
}

NAME_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]{0,31}")
HD_SUFFIX = "-hd"
# Nombres que MediaMTX v1.15.2 trata como comodín ("all_others" y "all").
RESERVED_NAMES = frozenset({"all", "all_others"})
ENV_KEY_PATTERN = re.compile(r"[A-Z][A-Z0-9_]*")
DIGITS_PATTERN = re.compile(r"[0-9]{1,5}")
HASH_PATTERN = re.compile(r"sha256:[A-Za-z0-9+/]{43}=")
CHANNEL_ITEM_PATTERN = re.compile(r"([0-9]{1,2})(?:-([0-9]{1,2}))?")
CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
# URLs de `url:`: solo caracteres de RFC 3986, sin '$' (MediaMTX lo expande)
# ni '#' (fragmento); los demás van como %XX.
URL_ALLOWED = re.compile(r"[A-Za-z0-9._~:/?\[\]@!&'()*+,;=%-]+")
BAD_PERCENT = re.compile(r"%(?![0-9A-Fa-f]{2})")
# validUserinfo de net/url de Go (lo que acepta url.Parse en usuario:clave).
USERINFO_ALLOWED = re.compile(r"[A-Za-z0-9._~!&'()*+,;=%:@-]*")
BOM = chr(0xFEFF)

ENV_KEYS = frozenset(
    {
        "NVR_HOST",
        "NVR_PORT",
        "NVR_USER",
        "NVR_PASS",
        "NVR_CHANNELS",
        "NVR_MAC",
        "READER_ALLOWED_IPS",
        "RTSP_PORT",
        "API_PORT",
    }
)

MAX_NVR_USER_LENGTH = 64
MAX_NVR_PASS_LENGTH = 128
MAX_URL_LENGTH = 2048

# Códigos de salida (2 lo usa argparse para errores de uso). README, "Referencia".
EXIT_OK = 0
EXIT_ERROR = 1
EXIT_PROBE_FAILED = 3
EXIT_ROLLED_BACK = 4
EXIT_ROLLBACK_FAILED = 5
EXIT_STORAGE = 6  # SD en solo lectura, llena o con errores de E/S
EXIT_SYSTEMD = 7  # systemctl daemon-reload falló: no se aplicó nada
EXIT_BUSY = 8  # otro apply/rotate-password/set-nvr/follow-nvr en curso (lock)
# follow-nvr (README, "IP del NVR por DHCP: seguimiento automático"):
EXIT_MAC_DUPLICATE = 9  # la MAC del NVR aparece en 2+ IPs: alerta, ningún cambio
EXIT_NVR_NOT_FOUND = 10  # el NVR no responde y el barrido no lo encontró (o falta NVR_MAC)
EXIT_DAILY_LIMIT = 11  # ya se usaron los cambios (o los intentos) de IP de hoy

MAC_PATTERN = re.compile(r"[0-9a-f]{2}(?::[0-9a-f]{2}){5}")
FOLLOW_STATE_FILE = "follow-nvr.state"
DEFAULT_STATE_DIR = "/var/lib/vigilia-relay"
FOLLOW_FAIL_THRESHOLD = 2  # fallos seguidos antes de buscar (un reinicio breve del NVR no cuenta)
FOLLOW_MAX_CHANGES_PER_DAY = 3  # cambios de IP aplicados con éxito
FOLLOW_MAX_ATTEMPTS_PER_DAY = 12  # intentos (probe + apply a una IP nueva), aunque se reviertan
FOLLOW_TCP_TIMEOUT_S = 3.0
SWEEP_WORKERS = 32  # pings en paralelo durante el barrido
SWEEP_PING_TIMEOUT_S = 1
SD_SECTION = "README, sección «SD en solo lectura o llena»"
IP_REQUIRED = "usa la IP del equipo (pide IP fija o reserva DHCP)"


# =============================================================================
# Errores
# =============================================================================
class RelayError(Exception):
    """Error esperado: se muestra (redactado) y el CLI sale con `exit_code`."""

    exit_code = EXIT_ERROR


class ConfigError(RelayError):
    """relay.env, cameras.conf o los secretos no son válidos."""


class ProbeFailed(RelayError):
    exit_code = EXIT_PROBE_FAILED


class ApplyRolledBack(RelayError):
    exit_code = EXIT_ROLLED_BACK


class RollbackFailed(RelayError):
    exit_code = EXIT_ROLLBACK_FAILED


class ApiError(RelayError):
    """La API de MediaMTX respondió algo inesperado."""


class ApiUnavailable(ApiError):
    """La API de MediaMTX no responde (proceso caído o recargando)."""


class ApiAuthError(ApiError):
    """La API rechazó a vigilia-admin (api.secret no coincide con la config)."""


class SystemdReloadFailed(RelayError):
    exit_code = EXIT_SYSTEMD


class RelayBusy(RelayError):
    exit_code = EXIT_BUSY


def describe_os_error(exc: OSError) -> tuple[str, int]:
    """Mensaje en español y código de salida para un OSError (por errno)."""
    code = exc.errno
    if code == errno.EROFS:
        return (f"la SD quedó en solo lectura (EROFS): sudo reboot; si persiste, cambia la SD ({SD_SECTION})", EXIT_STORAGE)
    if code in (errno.ENOSPC, getattr(errno, "EDQUOT", errno.ENOSPC)):
        return (
            f"no queda espacio en la SD (ENOSPC): sudo journalctl --vacuum-size=32M y revisa `df -h` ({SD_SECTION})",
            EXIT_STORAGE,
        )
    if code == errno.EIO:
        return (f"error de E/S en la SD (EIO), posible SD dañada: cambia la SD ({SD_SECTION})", EXIT_STORAGE)
    name = errno.errorcode.get(code, "sin código") if code is not None else "sin código"
    where = f" en {exc.filename}" if exc.filename else ""
    return f"error del sistema ({name}){where}", EXIT_ERROR


# =============================================================================
# Redacción
# =============================================================================
# Mismo criterio que backend/src/mediamtx/mediamtx-redaction.util.ts: URLs con
# credenciales, palabras `usuario:clave@host` y el valor citado tras "source".
# Además, reemplazo literal de cada secreto conocido, en claro y codificado.
# Cuantificadores posesivos (`*+`, Python >= 3.11): cada clase excluye el
# carácter que viene después, así que son equivalentes a los greedy pero sin
# backtracking (ver los tests de ReDoS).
URL_IN_TEXT = re.compile(r"\b[a-z][a-z0-9+.-]*+://[^\s'\"<>]+", re.IGNORECASE)
USERINFO_TOKEN = re.compile(r"[^\s'\"<>:@]*+:[^\s'\"<>@]*+@[^\s'\"<>]*")
QUOTED_SOURCE = re.compile(r"(source\b[^'\"\n]{0,20}['\"])[^'\"]*+(['\"])", re.IGNORECASE)
PERCENT_ESCAPE = re.compile(r"%[0-9A-F]{2}")
WHITESPACE = re.compile(r"\s")

REDACTED = "[redacted]"
TRUNCATED_MARK = " […] "
# Igual que MAX_SCRUB_TEXT_LENGTH del backend: las regex de arriba son
# cuadráticas sobre un texto largo sin espacios, así que se acota ANTES.
MAX_REDACTION_INPUT = 2048
# Un secreto más corto se reemplazaría en cualquier parte del texto.
MIN_LITERAL_SECRET = 4


def bound_text(text: str, limit: int = MAX_REDACTION_INPUT, keep: str = "head") -> str:
    """`text` acotado a `limit` caracteres para el scrub.

    Al cortar se descarta además la palabra partida (el corte pudo partir una
    URL o un `usuario:clave@host`, y su resto ya no calzaría con las regex).
    `keep="tail"` conserva el final (los errores de ffprobe van al final).
    """
    if len(text) <= limit:
        return text
    room = limit - len(TRUNCATED_MARK)
    if keep == "tail":
        cut = text[-room:]
        match = WHITESPACE.search(cut)
        return TRUNCATED_MARK.lstrip() + (cut[match.end() :] if match else "")
    cut = text[:room]
    last_space = -1
    for index in range(len(cut) - 1, -1, -1):
        if cut[index].isspace():
            last_space = index
            break
    return (cut[:last_space] if last_space > 0 else "") + TRUNCATED_MARK.rstrip()


def secret_variants(value: str) -> set[str]:
    """Formas en que un secreto puede aparecer en un texto (claro y codificado)."""
    if len(value) < MIN_LITERAL_SECRET:
        return set()
    encoded = urllib.parse.quote(value, safe="")
    variants = {
        value,
        encoded,
        urllib.parse.quote(value),
        urllib.parse.quote_plus(value),
        PERCENT_ESCAPE.sub(lambda m: m.group(0).lower(), encoded),
        json.dumps(value)[1:-1],
    }
    return {variant for variant in variants if len(variant) >= MIN_LITERAL_SECRET}


def strip_url_secrets(url: str) -> str:
    """Deja solo esquema, host y puerto de una URL (la ruta y la query, `/***`).

    Con `@` o si no se puede interpretar, se redacta entera: una clave con `/`
    o `@` sin codificar haría que parte de ella pareciera el host.
    """
    scheme = url[: url.index("://") + 3]
    if "@" in url:
        return scheme + REDACTED
    try:
        parts = urllib.parse.urlsplit(url)
        host = parts.hostname
        port = parts.port
    except ValueError:
        return scheme + REDACTED
    if not host:
        return scheme + REDACTED
    host_text = f"[{host}]" if ":" in host else host
    port_text = f":{port}" if port else ""
    path_text = "/***" if parts.path not in ("", "/") else ""
    query_text = "?***" if parts.query or parts.fragment else ""
    return f"{parts.scheme}://{host_text}{port_text}{path_text}{query_text}"


class Redactor:
    """Reemplaza secretos conocidos y URLs con credenciales en un texto."""

    def __init__(self, known_secrets: Iterable[str] = ()) -> None:
        self._literals: list[str] = []
        self.add(*known_secrets)

    def add(self, *values: str | None) -> None:
        literals = set(self._literals)
        for value in values:
            if value:
                literals |= secret_variants(value)
        # Primero los más largos: un secreto puede contener a otro.
        self._literals = sorted(literals, key=len, reverse=True)

    def __call__(self, text: str, *, scrub_urls: bool = True, keep: str = "head") -> str:
        # El reemplazo literal va ANTES de acotar: str.replace es lineal y así
        # el corte no puede dejar a la vista un pedazo de un secreto.
        for literal in self._literals:
            text = text.replace(literal, REDACTED)
        text = bound_text(text, keep=keep)
        if scrub_urls:
            text = QUOTED_SOURCE.sub(r"\1" + REDACTED + r"\2", text)
            text = URL_IN_TEXT.sub(lambda m: strip_url_secrets(m.group(0)), text)
            text = USERINFO_TOKEN.sub(REDACTED, text)
        return text


# =============================================================================
# relay.env
# =============================================================================
def _split_lines(text: str) -> list[str]:
    # No str.splitlines(): también corta en NEL (0x85) y en los separadores
    # Unicode U+2028/U+2029, que podrían ir dentro de una clave. Se acepta un
    # BOM al inicio (Bloc de notas).
    return text.lstrip(BOM).replace("\r\n", "\n").split("\n")


def _unquote(value: str) -> str:
    """Quita UN par de comillas exteriores iguales, sin procesar escapes."""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    return value


def parse_env_text(text: str, *, source: str = ENV_FILE) -> dict[str, str]:
    """Parsea `CLAVE=valor` sin shell. Los errores nunca citan el valor."""
    values: dict[str, str] = {}
    for lineno, raw in enumerate(_split_lines(text), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        key = key.strip()
        if not sep or not ENV_KEY_PATTERN.fullmatch(key):
            raise ConfigError(f"{source}, línea {lineno}: se esperaba CLAVE=valor")
        if key not in ENV_KEYS:
            raise ConfigError(f"{source}, línea {lineno}: clave desconocida {key}")
        if key in values:
            raise ConfigError(f"{source}, línea {lineno}: {key} está repetida")
        value = _unquote(value.strip())
        if CONTROL_CHARS.search(value):
            raise ConfigError(f"{source}, línea {lineno}: {key} tiene caracteres de control")
        values[key] = value
    return values


def format_env_value(value: str) -> str:
    """Valor para escribir en relay.env: siempre entre comillas simples.

    `_unquote` quita solo el par exterior y no procesa escapes, así que
    cualquier valor sin saltos de línea vuelve tal cual.
    """
    if CONTROL_CHARS.search(value):
        raise ConfigError("el valor tiene caracteres de control")
    return f"'{value}'"


def update_env_text(text: str, updates: Mapping[str, str | None]) -> str:
    """Reemplaza (o agrega al final) claves de relay.env conservando el resto.

    Un valor `None` borra la clave.
    """
    pending = dict(updates)
    output: list[str] = []
    for raw in _split_lines(text) if text else []:
        key = raw.strip().partition("=")[0].strip()
        if "=" in raw and key in pending:
            value = pending.pop(key)
            if value is not None:
                output.append(f"{key}={format_env_value(value)}")
            continue
        output.append(raw)
    while output and output[-1] == "":
        output.pop()
    for key, value in pending.items():
        if value is not None:
            output.append(f"{key}={format_env_value(value)}")
    return "\n".join(output) + "\n"


# =============================================================================
# Validación de settings
# =============================================================================
@dataclass(frozen=True)
class NvrSettings:
    host: str
    port: int
    user: str
    password: str = field(repr=False)
    mac: str | None = None  # NVR_MAC: identifica al NVR aunque cambie su IP (follow-nvr)


def validate_mac(value: str) -> str:
    """`aa:bb:cc:dd:ee:ff` (se normaliza a minúsculas). Unicast y no nula."""
    mac = value.strip().lower()
    if not MAC_PATTERN.fullmatch(mac):
        raise ConfigError("NVR_MAC debe tener el formato aa:bb:cc:dd:ee:ff")
    if mac in ("00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff") or int(mac[:2], 16) & 1:
        raise ConfigError("NVR_MAC no es la MAC de un equipo (es nula, broadcast o multicast)")
    return mac


@dataclass(frozen=True)
class RelaySettings:
    nvr: NvrSettings | None
    nvr_channels: int
    reader_networks: tuple[str, ...]
    reader_networks_defaulted: bool
    rtsp_port: int
    api_port: int

    @property
    def secrets(self) -> tuple[str, ...]:
        return (self.nvr.password,) if self.nvr else ()


def parse_port(key: str, value: str, *, minimum: int = 1) -> int:
    if not DIGITS_PATTERN.fullmatch(value):
        raise ConfigError(f"{key} debe ser un número")
    port = int(value)
    if not minimum <= port <= 65535:
        raise ConfigError(f"{key} debe estar entre {minimum} y 65535")
    return port


def validate_ip_host(host: str, label: str = "NVR_HOST") -> str:
    """IP literal: IPv4, o IPv6 sin IPv4 incrustada, sin zona y sin IPvFuture.
    Devuelve la forma canónica.

    Nombres no: con IPAddressDeny=any el servicio no puede hacer DNS (UDP/53),
    así que una cámara por nombre nunca andaría. Y MediaMTX v1.15.2 rechaza
    (imprimiendo la clave) los IPv6 con IPv4 incrustada y los IPvFuture.
    """
    text = host[1:-1] if host.startswith("[") and host.endswith("]") else host
    if not text or len(text) > 45 or "%" in text:
        raise ConfigError(f"{label} no es una IP: {IP_REQUIRED}")
    try:
        address = ipaddress.ip_address(text)
    except ValueError:
        raise ConfigError(f"{label} no es una IP: {IP_REQUIRED}") from None
    if isinstance(address, ipaddress.IPv6Address) and (address.ipv4_mapped is not None or "." in text):
        raise ConfigError(f"{label}: una IPv6 con IPv4 incrustada no sirve; {IP_REQUIRED}")
    return str(address)


def validate_nvr_credential(key: str, value: str, max_length: int) -> str:
    if not value:
        raise ConfigError(f"{key} está vacío")
    if len(value) > max_length:
        raise ConfigError(f"{key} supera {max_length} caracteres")
    if CONTROL_CHARS.search(value):
        raise ConfigError(f"{key} tiene caracteres de control")
    return value


def parse_reader_networks(value: str) -> tuple[str, ...]:
    """Lista de IPs de los consumidores (una IP o /32, /128 por consumidor)."""
    networks: list[str] = []
    for item in (part for part in re.split(r"[,\s]+", value.strip()) if part):
        try:
            network = ipaddress.ip_network(item, strict=True)
        except ValueError:
            raise ConfigError(f"READER_ALLOWED_IPS: '{item}' no es una IP válida") from None
        if network.prefixlen != network.max_prefixlen:
            raise ConfigError(
                f"READER_ALLOWED_IPS: '{item}' es una red; usa la IP de cada consumidor (/32 o /128)"
            )
        text = str(network)
        if text not in networks:
            networks.append(text)
    return tuple(networks)


def networks_outside_tailscale(networks: Iterable[str]) -> list[str]:
    """Redes que no son loopback ni caen dentro de los rangos de Tailscale."""
    tailscale = [ipaddress.ip_network(network) for network in TAILSCALE_NETWORKS]
    outside: list[str] = []
    for text in networks:
        network = ipaddress.ip_network(text)
        if network.is_loopback:
            continue
        if any(network.version == ts.version and network.subnet_of(ts) for ts in tailscale):  # type: ignore[arg-type]
            continue
        outside.append(text)
    return outside


def settings_from_env(values: Mapping[str, str]) -> RelaySettings:
    nvr_keys = ("NVR_HOST", "NVR_USER", "NVR_PASS")
    present = [key for key in nvr_keys if values.get(key)]
    nvr: NvrSettings | None = None
    if present and len(present) != len(nvr_keys):
        missing = ", ".join(key for key in nvr_keys if key not in present)
        raise ConfigError(f"relay.env: falta {missing} (corre `vigilia-relay set-nvr`)")
    if present:
        nvr = NvrSettings(
            host=validate_ip_host(values["NVR_HOST"]),
            port=parse_port("NVR_PORT", values.get("NVR_PORT") or str(DEFAULT_NVR_PORT)),
            user=validate_nvr_credential("NVR_USER", values["NVR_USER"], MAX_NVR_USER_LENGTH),
            password=validate_nvr_credential("NVR_PASS", values["NVR_PASS"], MAX_NVR_PASS_LENGTH),
            mac=validate_mac(values["NVR_MAC"]) if values.get("NVR_MAC") else None,
        )
    elif values.get("NVR_MAC"):
        validate_mac(values["NVR_MAC"])

    channels_text = values.get("NVR_CHANNELS") or str(DEFAULT_NVR_CHANNELS)
    if not DIGITS_PATTERN.fullmatch(channels_text) or not 1 <= int(channels_text) <= MAX_NVR_CHANNELS:
        raise ConfigError(f"NVR_CHANNELS debe estar entre 1 y {MAX_NVR_CHANNELS}")

    # Fail-closed: sin READER_ALLOWED_IPS el lector solo entra desde loopback
    # (apply y status lo marcan como error de configuración).
    readers = parse_reader_networks(values.get("READER_ALLOWED_IPS", ""))
    defaulted = not readers
    for loopback in LOOPBACK_NETWORKS:
        if loopback not in readers:
            readers = (*readers, loopback)

    rtsp_port = parse_port("RTSP_PORT", values.get("RTSP_PORT") or str(DEFAULT_RTSP_PORT), minimum=MIN_RELAY_PORT)
    api_port = parse_port("API_PORT", values.get("API_PORT") or str(DEFAULT_API_PORT), minimum=MIN_RELAY_PORT)
    if rtsp_port == api_port:
        raise ConfigError("RTSP_PORT y API_PORT no pueden ser el mismo puerto")

    return RelaySettings(
        nvr=nvr,
        nvr_channels=int(channels_text),
        reader_networks=readers,
        reader_networks_defaulted=defaulted,
        rtsp_port=rtsp_port,
        api_port=api_port,
    )


# =============================================================================
# cameras.conf
# =============================================================================
@dataclass(frozen=True)
class Camera:
    name: str
    channel: int | None = None
    url: str | None = field(default=None, repr=False)


SAFE_TO_ECHO = re.compile(r"[A-Za-z0-9_.-]{1,40}")


def validate_camera_name(name: str) -> str:
    if not NAME_PATTERN.fullmatch(name):
        # Solo se cita si no puede ser una URL o una clave (columnas invertidas).
        shown = f" '{name}'" if SAFE_TO_ECHO.fullmatch(name) else ""
        raise ConfigError(
            f"nombre de cámara inválido{shown}: usa minúsculas, dígitos, '_' o '-', "
            "empieza con letra o dígito, máximo 32"
        )
    if name.endswith(HD_SUFFIX):
        raise ConfigError(f"'{name}': el sufijo {HD_SUFFIX} está reservado para el stream principal")
    if name in RESERVED_NAMES:
        raise ConfigError(f"'{name}' está reservado por MediaMTX (es un comodín de paths)")
    return name


def validate_channel(text: str) -> int:
    if not DIGITS_PATTERN.fullmatch(text) or not 1 <= int(text) <= MAX_NVR_CHANNELS:
        raise ConfigError(f"canal inválido: debe estar entre 1 y {MAX_NVR_CHANNELS}")
    return int(text)


PATH_SAFE = "/:@!&'()*+,;=-._~%"
QUERY_SAFE = PATH_SAFE + "?"


def _split_host_port(hostport: str) -> tuple[str, str]:
    """`10.0.0.5:554` o `[fd00::5]:554` -> (host sin corchetes, puerto o "")."""
    if hostport.startswith("["):
        end = hostport.find("]")
        if end < 0:
            raise ConfigError("la URL no es válida")
        host, after = hostport[1:end], hostport[end + 1 :]
        if after and not after.startswith(":"):
            raise ConfigError("la URL no es válida")
        if not host or ":" not in host:
            raise ConfigError(f"el host de la URL no es una IP: {IP_REQUIRED}")
        return host, after[1:]
    host, _, port = hostport.partition(":")
    return host, port


def validate_source_url(url: str) -> str:
    """URL rtsp(s) de un `url:` de cameras.conf. Devuelve la URL RE-SERIALIZADA
    desde sus componentes validados (esquema, userinfo codificado, IP
    canónica, puerto, path y query): a MediaMTX nunca llega el string original.
    Los errores no la citan.

    Estricta: lo que MediaMTX v1.15.2 rechazaría lo hace imprimir la `source`
    con la clave en el journal al cargar (verificado: esquema en mayúsculas,
    IPv6 con IPv4 incrustada, IPvFuture, escapes % inválidos, ...).
    """
    if len(url) > MAX_URL_LENGTH or CONTROL_CHARS.search(url) or WHITESPACE.search(url):
        raise ConfigError("la URL es demasiado larga o tiene espacios o caracteres de control")
    if "$" in url:
        # MediaMTX expande $G1, $MTX_QUERY... dentro de `source`.
        raise ConfigError("la URL tiene '$': codifícalo como %24")
    if "#" in url:
        raise ConfigError("la URL tiene '#': codifícalo como %23")
    if not URL_ALLOWED.fullmatch(url):
        raise ConfigError("la URL tiene caracteres fuera de RFC 3986: codifícalos como %XX")
    if BAD_PERCENT.search(url):
        raise ConfigError("la URL tiene un '%' que no es un %XX válido")
    scheme, sep, _ = url.partition("://")
    if not sep or scheme not in ("rtsp", "rtsps"):
        raise ConfigError("la URL debe empezar exactamente con rtsp:// o rtsps:// (en minúsculas)")
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        raise ConfigError("la URL no es válida") from None
    userinfo, at, hostport = parts.netloc.rpartition("@")
    user = password = ""
    has_password = False
    if at:
        if not USERINFO_ALLOWED.fullmatch(userinfo):
            raise ConfigError("el usuario o la clave de la URL tienen caracteres no permitidos: codifícalos como %XX")
        # Como url.Parse de Go: el usuario termina en el primer ':'.
        user_raw, colon, password_raw = userinfo.partition(":")
        user, password, has_password = urllib.parse.unquote(user_raw), urllib.parse.unquote(password_raw), bool(colon)
        if CONTROL_CHARS.search(user) or CONTROL_CHARS.search(password):
            raise ConfigError("el usuario o la clave de la URL tienen caracteres de control (%00-%1F)")
    host_text, port_text = _split_host_port(hostport)
    if not host_text:
        raise ConfigError("la URL debe ser rtsp:// o rtsps:// con host")
    host = validate_ip_host(host_text, "el host de la URL")
    port: int | None = None
    if port_text:
        if not DIGITS_PATTERN.fullmatch(port_text) or not 1 <= int(port_text) <= 65535:
            raise ConfigError("el puerto de la URL debe estar entre 1 y 65535")
        port = int(port_text)
    credentials = ""
    if at:
        credentials = encode_userinfo(user) + (":" + encode_userinfo(password) if has_password else "") + "@"
    path = urllib.parse.quote(parts.path, safe=PATH_SAFE)
    query = urllib.parse.quote(parts.query, safe=QUERY_SAFE)
    return (
        f"{scheme}://{credentials}{format_host(host)}{f':{port}' if port else ''}{path}{f'?{query}' if query else ''}"
    )


def parse_cameras_text(text: str) -> list[Camera]:
    """Una cámara por línea: `nombre nvr:<canal>` o `nombre url:rtsp://...`."""
    cameras: list[Camera] = []
    seen: set[str] = set()
    for lineno, raw in enumerate(_split_lines(text), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        tokens = line.split()
        if len(tokens) != 2:
            raise ConfigError(f"{CAMERAS_FILE}, línea {lineno}: se esperaba `nombre nvr:<canal>` o `nombre url:rtsp://...`")
        name, spec = tokens
        try:
            validate_camera_name(name)
            if name in seen:
                raise ConfigError(f"'{name}' está repetida")
            kind, _, value = spec.partition(":")
            if kind == "nvr":
                camera = Camera(name=name, channel=validate_channel(value))
            elif kind == "url":
                camera = Camera(name=name, url=validate_source_url(value))
            else:
                raise ConfigError("formato no soportado: usa nvr:<canal> o url:rtsp://...")
        except ConfigError as exc:
            raise ConfigError(f"{CAMERAS_FILE}, línea {lineno}: {exc}") from None
        seen.add(name)
        cameras.append(camera)
    return cameras


def default_cameras(channels: int) -> list[Camera]:
    return [Camera(name=f"cam{channel:02d}", channel=channel) for channel in range(1, channels + 1)]


def parse_channel_spec(spec: str) -> list[int]:
    """`1-16`, `3` o `1,3,5-7` -> canales ordenados y sin repetir."""
    channels: set[int] = set()
    for item in (part.strip() for part in spec.split(",")):
        match = CHANNEL_ITEM_PATTERN.fullmatch(item)
        if not match:
            raise ConfigError(f"--channels: '{item[:20]}' no es un canal ni un rango (ej. 1-16)")
        start = validate_channel(match.group(1))
        end = validate_channel(match.group(2)) if match.group(2) else start
        if end < start:
            raise ConfigError(f"--channels: el rango '{item}' está al revés")
        channels.update(range(start, end + 1))
    return sorted(channels)


# =============================================================================
# URLs, hash y render
# =============================================================================
def encode_userinfo(value: str) -> str:
    """Usuario o clave para el userinfo de una URL RTSP.

    `quote(safe='')` ya codifica '$' como %24; se fuerza igual porque MediaMTX
    expande $G1 y $MTX_QUERY dentro de `source`.
    """
    return urllib.parse.quote(value, safe="").replace("$", "%24")


def format_host(host: str) -> str:
    return f"[{host}]" if ":" in host else host


def nvr_stream_url(nvr: NvrSettings, channel: int, stream: str) -> str:
    """URL Hikvision: `{canal}02` es el substream y `{canal}01` el principal."""
    if stream not in ("sub", "main"):
        raise ValueError(f"stream desconocido: {stream}")
    suffix = "02" if stream == "sub" else "01"
    userinfo = f"{encode_userinfo(nvr.user)}:{encode_userinfo(nvr.password)}"
    return f"rtsp://{userinfo}@{format_host(nvr.host)}:{nvr.port}/Streaming/Channels/{channel}{suffix}"


def hash_password(password: str) -> str:
    """Formato `sha256:<base64>` de MediaMTX (`authInternalUsers[].pass`)."""
    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return "sha256:" + base64.b64encode(digest).decode("ascii")


def validate_hash(value: str, source: str) -> str:
    if not HASH_PATTERN.fullmatch(value):
        raise ConfigError(f"{source} no tiene el formato sha256:<base64> (regenéralo con rotate-password)")
    return value


def canonical_ips(values: Iterable[object]) -> list[str]:
    """`ips` tal como las devuelve la API de MediaMTX v1.15.2 (verificado):
    CIDR canónico (agrega /32 o /128, IPv6 comprimida en minúsculas) y la
    lista ordenada como string."""
    result: list[str] = []
    for value in values:
        text = str(value)
        try:
            text = str(ipaddress.ip_network(text, strict=False))
        except ValueError:
            pass
        result.append(text)
    return sorted(result)


@dataclass(frozen=True)
class PathSpec:
    name: str
    camera: str
    stream: str  # "sub" | "main" | "url"
    source: str = field(repr=False)


def build_paths(settings: RelaySettings, cameras: Sequence[Camera]) -> list[PathSpec]:
    paths: list[PathSpec] = []
    for camera in cameras:
        if camera.channel is not None:
            if settings.nvr is None:
                raise ConfigError(
                    f"'{camera.name}' usa nvr:{camera.channel}, pero relay.env no tiene el NVR "
                    "(corre `vigilia-relay set-nvr`)"
                )
            paths.append(PathSpec(camera.name, camera.name, "sub", nvr_stream_url(settings.nvr, camera.channel, "sub")))
            paths.append(
                PathSpec(camera.name + HD_SUFFIX, camera.name, "main", nvr_stream_url(settings.nvr, camera.channel, "main"))
            )
        elif camera.url is not None:
            paths.append(PathSpec(camera.name, camera.name, "url", camera.url))
    return paths


def resolve_cameras(settings: RelaySettings, cameras_text: str | None) -> list[Camera]:
    """cameras.conf si existe; si no, cam01..camNN del NVR (si está configurado)."""
    if cameras_text is not None:
        return parse_cameras_text(cameras_text)
    if settings.nvr is not None:
        return default_cameras(settings.nvr_channels)
    return []


def build_mediamtx_config(
    settings: RelaySettings,
    paths: Sequence[PathSpec],
    *,
    reader_hash: str,
    admin_hash: str,
) -> dict[str, Any]:
    """Config de MediaMTX v1.15.2 (claves verificadas contra el binario real).

    Solo RTSP (TCP, Basic: con `pass: sha256:` el servidor no puede usar
    Digest) y la API en loopback. Sin usuario `any`: la API devuelve la
    `source` con la clave del NVR en claro (decisión P6.M). Las `ips` van
    canónicas y ordenadas, como las devuelve la API.
    """
    validate_hash(reader_hash, READER_HASH_FILE)
    validate_hash(admin_hash, API_SECRET_FILE)
    return {
        "logLevel": "info",
        "logDestinations": ["stdout"],
        "readTimeout": "10s",
        "writeTimeout": "10s",
        "authMethod": "internal",
        "authInternalUsers": [
            {
                "user": READER_USER,
                "pass": reader_hash,
                "ips": canonical_ips(settings.reader_networks),
                "permissions": [{"action": "read", "path": ""}],
            },
            {
                "user": ADMIN_USER,
                "pass": admin_hash,
                "ips": canonical_ips(LOOPBACK_NETWORKS),
                "permissions": [{"action": "api", "path": ""}],
            },
        ],
        "api": True,
        "apiAddress": f"127.0.0.1:{settings.api_port}",
        "apiEncryption": False,
        "apiAllowOrigin": "http://127.0.0.1",
        "apiTrustedProxies": [],
        "metrics": False,
        "pprof": False,
        "playback": False,
        "rtsp": True,
        "rtspTransports": ["tcp"],
        "rtspEncryption": "no",
        "rtspAddress": f":{settings.rtsp_port}",
        "rtspAuthMethods": ["basic"],
        "rtmp": False,
        "hls": False,
        "webrtc": False,
        "srt": False,
        "pathDefaults": dict(PATH_DEFAULTS),
        "paths": {path.name: {"source": path.source} for path in paths},
    }


CONFIG_HEADER = (
    f"# Generado por vigilia-relay {KIT_VERSION} para MediaMTX {MEDIAMTX_VERSION}. NO EDITAR A MANO:\n"
    "# se reescribe con `vigilia-relay apply` desde relay.env y cameras.conf.\n"
    "# Es JSON (YAML válido). Lleva la clave del NVR: 640 root:vigilia-relay.\n"
)


def render_config_text(config: Mapping[str, Any]) -> str:
    return CONFIG_HEADER + json.dumps(config, indent=2, ensure_ascii=True) + "\n"


def parse_rendered_config(text: str) -> dict[str, Any] | None:
    """La config generada por `render_config_text`, o None si no es nuestra."""
    body = "\n".join(line for line in _split_lines(text) if not line.lstrip().startswith("#"))
    try:
        config = json.loads(body)
    except ValueError:
        return None
    return config if isinstance(config, dict) else None


# =============================================================================
# Red permitida al servicio (drop-in de systemd con IPAddressAllow)
# =============================================================================
def build_ip_allowlist(settings: RelaySettings, cameras: Sequence[Camera]) -> list[str]:
    """loopback + NVR + hosts de `url:` + Tailscale (lectores).

    Los hosts ya son IPs literales (validate_ip_host): no se resuelve DNS,
    que el servicio igual no podría usar con IPAddressDeny=any.
    """
    hosts: list[str] = []
    if settings.nvr is not None and any(camera.channel is not None for camera in cameras):
        hosts.append(settings.nvr.host)
    for camera in cameras:
        if camera.url:
            hostname = urllib.parse.urlsplit(camera.url).hostname
            if hostname:
                hosts.append(hostname)
    networks = {str(ipaddress.ip_network(validate_ip_host(host, "el host"))) for host in hosts}
    return ["localhost", *sorted(networks), *TAILSCALE_NETWORKS]


# =============================================================================
# Vecinos de red y barrido (follow-nvr)
# =============================================================================
# Estados de `ip neigh` en los que la MAC no sirve: el kernel no la resolvió.
BAD_NEIGHBOR_STATES = frozenset({"FAILED", "INCOMPLETE", "NONE"})


@dataclass(frozen=True)
class Neighbor:
    ip: str
    mac: str | None
    states: tuple[str, ...] = ()

    @property
    def usable(self) -> bool:
        """Tiene MAC y el kernel no la dio por perdida (STALE, DELAY y PROBE sirven)."""
        return self.mac is not None and not (BAD_NEIGHBOR_STATES & set(self.states))

    @property
    def confirmed(self) -> bool:
        """El equipo respondió al ARP hace poco (REACHABLE) o es una entrada fija."""
        return self.usable and bool({"REACHABLE", "PERMANENT"} & set(self.states))


def _load_json(text: str) -> Any:
    try:
        return json.loads(text or "[]")
    except ValueError:
        return None


def parse_neighbors(text: str) -> list[Neighbor]:
    """Salida de `ip -j -4 neigh show`. Ignora las entradas que no entiende."""
    data = _load_json(text)
    if not isinstance(data, list):
        return []
    neighbors: list[Neighbor] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        try:
            ip = str(ipaddress.IPv4Address(str(entry.get("dst"))))
        except ValueError:
            continue
        lladdr = entry.get("lladdr")
        mac = lladdr.lower() if isinstance(lladdr, str) and MAC_PATTERN.fullmatch(lladdr.lower()) else None
        raw_state = entry.get("state")
        if isinstance(raw_state, str):
            raw_state = [raw_state]
        states = tuple(item.upper() for item in raw_state if isinstance(item, str)) if isinstance(raw_state, list) else ()
        neighbors.append(Neighbor(ip, mac, states))
    return neighbors


def mac_at(neighbors: Iterable[Neighbor], ip: str) -> str | None:
    for neighbor in neighbors:
        if neighbor.ip == ip and neighbor.usable:
            return neighbor.mac
    return None


def parse_default_interface(text: str) -> str | None:
    """`ip -j -4 route show default`: la interfaz de la ruta por defecto (eth0 si hay varias)."""
    data = _load_json(text)
    devices = [str(route["dev"]) for route in data if isinstance(route, dict) and isinstance(route.get("dev"), str)] if isinstance(data, list) else []
    if "eth0" in devices:
        return "eth0"
    return devices[0] if devices else None


def parse_interface_address(text: str) -> ipaddress.IPv4Interface | None:
    """`ip -j -4 addr show dev X`: la primera IPv4 de la interfaz."""
    data = _load_json(text)
    if not isinstance(data, list):
        return None
    for link in data:
        if not isinstance(link, dict):
            continue
        for info in link.get("addr_info") or []:
            if not isinstance(info, dict) or info.get("family") != "inet":
                continue
            try:
                return ipaddress.IPv4Interface(f"{info.get('local')}/{int(info.get('prefixlen'))}")
            except (TypeError, ValueError):
                continue
    return None


def sweep_targets(interface: ipaddress.IPv4Interface) -> list[str]:
    """Hosts a barrer: la red de la interfaz, NUNCA más grande que una /24 (con un
    prefijo más corto, la /24 de la IP propia). Sin la IP propia."""
    network = interface.network
    if network.prefixlen < 24:
        network = ipaddress.IPv4Network(f"{interface.ip}/24", strict=False)
    return [str(host) for host in network.hosts() if host != interface.ip]


class SystemNet:
    """La red de verdad: `ip -j` (netlink), ping y TCP. Los tests usan un falso.

    El TCP solo abre y cierra la conexión (no manda credenciales): no cuenta
    como un login fallido para el NVR."""

    def __init__(self, runtime: Runtime, *, runner: Runner = subprocess.run, workers: int = SWEEP_WORKERS) -> None:
        self._runtime = runtime
        self._runner = runner
        self._workers = workers

    def _ip(self, *args: str) -> str:
        completed = self._runtime.command(["ip", "-j", *args], 10.0)
        return completed.stdout if completed is not None and completed.returncode == 0 else ""

    def local_interface(self) -> tuple[str, ipaddress.IPv4Interface | None]:
        """(interfaz de la ruta por defecto o eth0, su IPv4 con prefijo)."""
        iface = parse_default_interface(self._ip("-4", "route", "show", "default")) or "eth0"
        return iface, parse_interface_address(self._ip("-4", "addr", "show", "dev", iface))

    def neighbors(self) -> list[Neighbor]:
        return parse_neighbors(self._ip("-4", "neigh", "show"))

    def tcp_ok(self, host: str, port: int, timeout: float) -> bool:
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except OSError:
            return False

    def sweep(self, targets: Sequence[str]) -> None:
        """Un ping a cada IP, en paralelo acotado. Aunque el equipo no responda
        ICMP, el kernel registra su MAC en la tabla de vecinos."""

        def ping(ip: str) -> None:
            with contextlib.suppress(OSError, subprocess.TimeoutExpired):
                self._runner(
                    ["ping", "-n", "-q", "-c", "1", "-W", str(SWEEP_PING_TIMEOUT_S), ip],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=SWEEP_PING_TIMEOUT_S + 3,
                    check=False,
                )

        with concurrent.futures.ThreadPoolExecutor(max_workers=self._workers) as pool:
            list(pool.map(ping, targets))


@dataclass
class FollowState:
    fail_count: int = 0
    day: str = ""
    changes_today: int = 0
    attempts_today: int = 0
    last_change: str = ""


def load_follow_state(path: Path) -> tuple[FollowState, str | None]:
    """Estado de follow-nvr. Falta, corrupto o ilegible: se parte de cero (con aviso)."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return FollowState(), None
    except OSError as exc:
        return FollowState(), f"no se pudo leer {path} ({errno.errorcode.get(exc.errno or 0, 'error')}): se parte de cero"
    data = _load_json(text)
    if not isinstance(data, dict):
        return FollowState(), f"{path} está corrupto: se parte de cero"

    def count(key: str) -> int:
        value = data.get(key)
        return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value < 1_000_000 else 0

    day = data.get("day")
    last_change = data.get("last_change")
    return (
        FollowState(
            fail_count=count("fail_count"),
            day=day if isinstance(day, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", day) else "",
            changes_today=count("changes_today"),
            attempts_today=count("attempts_today"),  # falta en un estado de la 0.3.0: 0
            last_change=last_change[:200] if isinstance(last_change, str) else "",
        ),
        None,
    )


def save_follow_state(path: Path, state: FollowState) -> bool:
    """False si no se pudo escribir (SD en solo lectura o llena)."""
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        atomic_write(path, (json.dumps(asdict(state), sort_keys=True) + "\n").encode("utf-8"), mode=SECRET_MODE)
    except OSError:
        return False
    return True


def render_ip_dropin(allow: Sequence[str]) -> str:
    return (
        # Sin la versión del kit: si no, cada actualización cambiaría el texto y el
        # primer apply reiniciaría MediaMTX sin que cambie la red permitida.
        "# Generado por vigilia-relay apply. NO EDITAR A MANO.\n"
        "# Red a la que puede hablar MediaMTX: loopback, el NVR y los hosts de url:\n"
        "# (resueltos al aplicar) y Tailscale (lectores). Todo lo demás lo bloquea\n"
        "# IPAddressDeny=any de vigilia-relay.service (filtro BPF de systemd).\n"
        "[Service]\n"
        "IPAddressAllow=\n"
        f"IPAddressAllow={' '.join(allow)}\n"
    )


# =============================================================================
# Probe (ffprobe)
# =============================================================================
@dataclass(frozen=True)
class ProbeResult:
    label: str
    status: str  # ok | auth | not_found | timeout | unreachable | error
    codec: str = ""
    width: int = 0
    height: int = 0
    fps: float = 0.0
    detail: str = ""  # ya redactado

    @property
    def ok(self) -> bool:
        return self.status == "ok"


AUTH_FAILURE = re.compile(r"\b40[13]\b|unauthorized|forbidden|authorization failed", re.IGNORECASE)
NOT_FOUND = re.compile(r"\b404\b|not found", re.IGNORECASE)
TIMED_OUT = re.compile(r"timed out|timeout", re.IGNORECASE)
UNREACHABLE = re.compile(
    r"connection refused|no route to host|unreachable|could not resolve|failed to resolve|"
    r"name or service not known|cannot assign requested address",
    re.IGNORECASE,
)

Runner = Callable[..., Any]  # firma de subprocess.run


def ffprobe_command(ffprobe: str, url: str, timeout_s: float) -> list[str]:
    """ffprobe por TCP con timeout de socket (`-timeout` en µs; `-stimeout` ya no
    existe) y solo los protocolos de RTSP (`-protocol_whitelist`)."""
    return [
        ffprobe,
        "-hide_banner",
        "-v",
        "error",
        "-protocol_whitelist",
        FFPROBE_PROTOCOLS,
        "-rtsp_transport",
        "tcp",
        "-timeout",
        str(int(timeout_s * 1_000_000)),
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,avg_frame_rate,r_frame_rate",
        "-of",
        "json",
        url,
    ]


def classify_ffprobe_failure(stderr: str) -> str:
    if AUTH_FAILURE.search(stderr):
        return "auth"
    if NOT_FOUND.search(stderr):
        return "not_found"
    if TIMED_OUT.search(stderr):
        return "timeout"
    if UNREACHABLE.search(stderr):
        return "unreachable"
    return "error"


def _parse_rate(text: str) -> float:
    numerator, _, denominator = text.partition("/")
    try:
        value = float(numerator) / float(denominator or "1")
    except (ValueError, ZeroDivisionError):
        return 0.0
    return round(value, 2)


def _last_line(text: str, limit: int = 160) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return ""
    last = lines[-1]
    return last if len(last) <= limit else last[:limit] + "…"


def _as_int(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


@dataclass(frozen=True)
class ProbePrivileges:
    """Cómo correr ffprobe: un prefijo de comando (setpriv) y kwargs extra de
    subprocess.run (usuario sin privilegios, umask, entorno mínimo)."""

    prefix: tuple[str, ...] = ()
    kwargs: Mapping[str, Any] = field(default_factory=dict)


NO_PRIVILEGE_DROP = ProbePrivileges()


def probe_url(
    label: str,
    url: str,
    *,
    ffprobe: str,
    runner: Runner,
    redactor: Redactor,
    timeout_s: float = PROBE_TIMEOUT_S,
    privileges: ProbePrivileges = NO_PRIVILEGE_DROP,
) -> ProbeResult:
    """Un ffprobe. La URL va por argv a ffprobe (inevitable), nunca a la salida."""
    command = [*privileges.prefix, *ffprobe_command(ffprobe, url, timeout_s)]
    try:
        completed = runner(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdin=subprocess.DEVNULL,
            timeout=timeout_s + PROBE_SUBPROCESS_MARGIN_S,
            check=False,
            **dict(privileges.kwargs),
        )
    except subprocess.TimeoutExpired:
        return ProbeResult(label, "timeout", detail=f"sin respuesta en {timeout_s + PROBE_SUBPROCESS_MARGIN_S:.0f} s")
    except FileNotFoundError:
        raise RelayError(f"no se encontró ffprobe ('{ffprobe}'): instala ffmpeg o define {FFPROBE_ENV}") from None
    stderr = completed.stderr or ""
    if completed.returncode != 0:
        # Se clasifica el texto YA redactado: un "%401" de la clave codificada
        # no debe parecer un 401.
        redacted = redactor(stderr, keep="tail")
        return ProbeResult(label, classify_ffprobe_failure(redacted), detail=_last_line(redacted))
    try:
        data = json.loads(completed.stdout or "{}")
        streams = data.get("streams") or []
        stream = streams[0] if streams and isinstance(streams[0], dict) else None
    except (ValueError, AttributeError):
        stream = None
    if stream is None:
        return ProbeResult(label, "error", detail="el stream no tiene video")
    return ProbeResult(
        label,
        "ok",
        codec=str(stream.get("codec_name") or "?")[:16],
        width=_as_int(stream.get("width")),
        height=_as_int(stream.get("height")),
        fps=_parse_rate(str(stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "0/1")),
    )


def probe_sequence(
    targets: Sequence[tuple[str, str]],
    probe_one: Callable[[str, str], ProbeResult],
    *,
    stop_at_first_ok: bool = False,
    on_result: Callable[[ProbeResult], None] | None = None,
) -> list[ProbeResult]:
    """Prueba en orden, de a uno. Se detiene en el primer rechazo de credenciales:
    el NVR Hikvision bloquea la IP tras unos pocos logins fallidos."""
    results: list[ProbeResult] = []
    for label, url in targets:
        result = probe_one(label, url)
        results.append(result)
        if on_result:
            on_result(result)
        if result.status == "auth":
            break
        if stop_at_first_ok and result.ok:
            break
    return results


def describe_probe(result: ProbeResult) -> str:
    if result.ok:
        return f"{result.label:<14} OK       {result.codec:<6} {result.width}x{result.height} {result.fps:g} fps"
    labels = {
        "auth": "CLAVE",
        "not_found": "NO-EXISTE",
        "timeout": "TIMEOUT",
        "unreachable": "SIN-RED",
        "error": "ERROR",
    }
    return f"{result.label:<14} {labels.get(result.status, result.status.upper()):<8} {result.detail}"


# =============================================================================
# API de MediaMTX
# =============================================================================
class MediamtxApi:
    """Cliente mínimo de la Control API (loopback, Basic vigilia-admin).

    Las respuestas traen la `source` con la clave del NVR: nunca se imprimen.
    """

    def __init__(self, port: int, secret: str, *, timeout: float = API_TIMEOUT_S) -> None:
        self._base = f"http://127.0.0.1:{port}"
        token = base64.b64encode(f"{ADMIN_USER}:{secret}".encode()).decode("ascii")
        self._authorization = f"Basic {token}"
        self._timeout = timeout
        # Sin proxies: un HTTP_PROXY del entorno se llevaría la Basic auth.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def get_json(self, path: str) -> Any:
        request = urllib.request.Request(
            self._base + path,
            headers={"Authorization": self._authorization, "Accept": "application/json"},
        )
        try:
            with self._opener.open(request, timeout=self._timeout) as response:
                body = response.read(MAX_API_BODY_BYTES + 1)
        except urllib.error.HTTPError as exc:
            code = exc.code
            exc.close()
            if code == 401:
                raise ApiAuthError("la API rechazó a vigilia-admin (401): api.secret no coincide con mediamtx.yml") from None
            raise ApiError(f"la API respondió HTTP {code}") from None
        except (urllib.error.URLError, OSError, http.client.HTTPException):
            # HTTPException: respuesta cortada (IncompleteRead, BadStatusLine)
            # mientras MediaMTX se reinicia o recarga.
            raise ApiUnavailable("la API de MediaMTX no responde") from None
        if len(body) > MAX_API_BODY_BYTES:
            raise ApiError("la respuesta de la API es demasiado grande")
        try:
            return json.loads(body)
        except ValueError:
            raise ApiError("la API no respondió JSON") from None


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def normalize_config_value(key: str, value: Any) -> Any:
    """Normaliza lo que la API de MediaMTX v1.15.2 reescribe al devolver la
    config. Verificado contra el binario: solo `authInternalUsers[].ips`
    (ordenadas como string, /32 agregado, IPv6 canónica); duraciones, listas,
    pathDefaults y `source` vuelven tal cual."""
    if key == "authInternalUsers" and isinstance(value, list):
        return [
            dict(user, ips=canonical_ips(user.get("ips") or [])) if isinstance(user, dict) else user for user in value
        ]
    return value


@dataclass(frozen=True)
class ConfigExpectation:
    """Lo que la API debe reflejar cuando MediaMTX cargó una config dada.

    Se compara CADA clave renderizada (global, pathDefaults y la `source` de
    cada path): si solo se comparara una parte, la config vieja podría
    "coincidir" antes de que MediaMTX recargue y apply daría por buena una
    config que no verificó (p. ej. un cambio solo de READER_ALLOWED_IPS).
    """

    api_port: int
    global_values: tuple[tuple[str, str], ...] = field(repr=False)  # (clave, JSON canónico)
    path_defaults: tuple[tuple[str, str], ...]
    paths: tuple[tuple[str, str], ...] = field(repr=False)  # (nombre, source)

    @classmethod
    def from_config(cls, config: Mapping[str, Any]) -> ConfigExpectation:
        api_address = str(config.get("apiAddress", f"127.0.0.1:{DEFAULT_API_PORT}"))
        port_text = api_address.rpartition(":")[2]
        api_port = int(port_text) if DIGITS_PATTERN.fullmatch(port_text) else DEFAULT_API_PORT
        global_values = tuple(
            sorted(
                (key, canonical_json(normalize_config_value(key, value)))
                for key, value in config.items()
                if key not in ("paths", "pathDefaults")
            )
        )
        path_defaults = tuple(sorted((key, canonical_json(value)) for key, value in (config.get("pathDefaults") or {}).items()))
        paths = tuple(
            sorted((str(name), str(spec.get("source", ""))) for name, spec in (config.get("paths") or {}).items())
        )
        return cls(api_port, global_values, path_defaults, paths)


NOT_LOADED = "la API todavía muestra otra config"


def _matches_values(active: Mapping[str, Any], expected: Sequence[tuple[str, str]]) -> bool:
    return all(key in active and canonical_json(normalize_config_value(key, active[key])) == value for key, value in expected)


def api_state_matches(api: Any, expected: ConfigExpectation) -> tuple[bool, str]:
    """¿La config activa en MediaMTX es `expected`? Devuelve (ok, motivo)."""
    try:
        global_config = api.get_json("/v3/config/global/get")
        path_defaults = api.get_json("/v3/config/pathdefaults/get")
        listing = api.get_json("/v3/config/paths/list?itemsPerPage=1000")
    except ApiError as exc:
        return False, str(exc)
    if not all(isinstance(body, dict) for body in (global_config, path_defaults, listing)):
        return False, "formato inesperado de la API"
    if not _matches_values(global_config, expected.global_values):
        return False, NOT_LOADED
    if not _matches_values(path_defaults, expected.path_defaults):
        return False, NOT_LOADED
    active_paths: dict[str, str] = {}
    for item in listing.get("items") or []:
        if isinstance(item, dict):
            active_paths[str(item.get("name", ""))] = str(item.get("source") or "")
    if active_paths != dict(expected.paths):
        return False, NOT_LOADED
    return True, "config activa"


# =============================================================================
# Archivos
# =============================================================================
Owner = tuple[int, int] | None


def fsync_directory(directory: Path) -> None:
    if os.name != "posix":
        return
    fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_write(path: Path, data: bytes, *, mode: int, owner: Owner = None) -> None:
    """Temporal en el mismo directorio -> fchmod/fchown -> fsync -> rename.

    MediaMTX vigila su config y la recarga en caliente: nunca debe ver un
    archivo a medio escribir.
    """
    fd, temp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    temp_path = Path(temp_name)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(fd, mode)
        if owner is not None and hasattr(os, "fchown"):
            os.fchown(fd, *owner)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise
    fsync_directory(path.parent)


def read_text_if_exists(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return None


@dataclass(frozen=True)
class EtcPaths:
    root: Path

    @property
    def env(self) -> Path:
        return self.root / ENV_FILE

    @property
    def cameras(self) -> Path:
        return self.root / CAMERAS_FILE

    @property
    def api_secret(self) -> Path:
        return self.root / API_SECRET_FILE

    @property
    def reader_hash(self) -> Path:
        return self.root / READER_HASH_FILE

    @property
    def config(self) -> Path:
        return self.root / CONFIG_FILE

    @property
    def config_prev(self) -> Path:
        return self.root / (CONFIG_FILE + PREV_SUFFIX)

    def secret_files(self) -> tuple[Path, ...]:
        return (self.env, self.cameras, self.api_secret, self.reader_hash)


# =============================================================================
# Runtime (I/O inyectable)
# =============================================================================
def _run_system_command(command: Sequence[str], timeout: float) -> subprocess.CompletedProcess[str] | None:
    if shutil.which(command[0]) is None:
        return None
    try:
        return subprocess.run(
            list(command),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdin=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def _is_root() -> bool:
    return os.name == "posix" and os.geteuid() == 0


def _default_owners() -> tuple[Owner, Owner]:
    """(dueño de los secretos, dueño de mediamtx.yml); None si no hay que tocarlo."""
    if not _is_root():
        return None, None
    import grp  # solo POSIX

    try:
        gid = grp.getgrnam(SERVICE_GROUP).gr_gid
    except KeyError:
        raise RelayError(f"no existe el grupo {SERVICE_GROUP}: corre install.sh") from None
    return (0, 0), (0, gid)


PROBE_PATH = "/usr/local/bin:/usr/bin:/bin"


def _probe_privileges() -> ProbePrivileges:
    """Como root (POSIX), ffprobe corre como vigilia-probe, sin grupos extra,
    con umask 077, desde /, con un entorno mínimo y detrás de
    `setpriv --no-new-privs` (ningún setuid/capability lo devuelve a root).
    Si no es root, sin cambios."""
    if not _is_root():
        return NO_PRIVILEGE_DROP
    import pwd  # solo POSIX

    try:
        entry = pwd.getpwnam(PROBE_USER)
    except KeyError:
        raise RelayError(f"no existe el usuario {PROBE_USER} (ffprobe no corre como root): corre install.sh") from None
    setpriv = shutil.which("setpriv", path=PROBE_PATH)
    if setpriv is None:
        raise RelayError("falta setpriv (paquete util-linux): ffprobe no corre sin no_new_privs")
    return ProbePrivileges(
        prefix=(setpriv, "--no-new-privs", "--"),
        kwargs={
            "user": entry.pw_uid,
            "group": entry.pw_gid,
            "extra_groups": [],
            "umask": 0o077,
            "cwd": "/",
            "env": {"PATH": PROBE_PATH, "LC_ALL": "C"},
        },
    )


def _default_state_dir(etc_root: Path) -> Path:
    """StateDirectory= de systemd si está; si no, /var/lib/vigilia-relay en la Pi."""
    from_systemd = os.environ.get("STATE_DIRECTORY")
    if from_systemd:
        return Path(from_systemd.split(":")[0])
    if os.name == "posix" and str(etc_root) == DEFAULT_ETC_DIR:
        return Path(DEFAULT_STATE_DIR)
    return etc_root / ".state"


def _default_unit_dropin_dir(etc_root: Path) -> Path | None:
    """Solo en la Pi (etc por defecto + systemd): con --etc-dir (tests, E2E) no se toca systemd."""
    if os.name != "posix" or str(etc_root) != DEFAULT_ETC_DIR:
        return None
    base = Path(SYSTEMD_UNIT_DIR)
    return base / f"{SERVICE_UNIT}.d" if base.is_dir() else None


@dataclass
class Runtime:
    stdout: TextIO = field(default_factory=lambda: sys.stdout)
    stderr: TextIO = field(default_factory=lambda: sys.stderr)
    stdin_isatty: Callable[[], bool] = field(default_factory=lambda: sys.stdin.isatty)
    stdout_isatty: Callable[[], bool] = field(default_factory=lambda: sys.stdout.isatty)
    read_input: Callable[[str], str] = input
    read_secret: Callable[[str], str] = getpass.getpass
    runner: Runner = subprocess.run
    command: Callable[[Sequence[str], float], subprocess.CompletedProcess[str] | None] = _run_system_command
    sleep: Callable[[float], None] = time.sleep
    monotonic: Callable[[], float] = time.monotonic
    wall_time: Callable[[], float] = time.time
    api_factory: Callable[[int, str], Any] = MediamtxApi
    owners: Callable[[], tuple[Owner, Owner]] = _default_owners
    is_root: Callable[[], bool] = _is_root
    probe_privileges: Callable[[], ProbePrivileges] = _probe_privileges
    unit_dropin_dir: Callable[[Path], Path | None] = _default_unit_dropin_dir
    state_dir: Callable[[Path], Path] = field(default_factory=lambda: _default_state_dir)
    net: Any = None  # None: SystemNet (la red real); los tests inyectan un falso
    ffprobe: str = field(default_factory=lambda: os.environ.get(FFPROBE_ENV) or "ffprobe")


class Console:
    def __init__(self, runtime: Runtime) -> None:
        self._runtime = runtime
        self.redact = Redactor()

    # flush en cada línea: bajo systemd stdout es un pipe con buffer de bloque y
    # el journal mezclaría el orden de stdout y stderr (los AVISO saldrían antes).
    def info(self, message: str = "", *, scrub_urls: bool = True) -> None:
        print(self.redact(message, scrub_urls=scrub_urls), file=self._runtime.stdout, flush=True)

    def warn(self, message: str, *, label: str = "AVISO") -> None:
        print(f"{label}: " + self.redact(message), file=self._runtime.stderr, flush=True)

    def error(self, message: str) -> None:
        print("ERROR: " + self.redact(message), file=self._runtime.stderr, flush=True)

    def reveal(self, message: str) -> None:
        """Sin redactar: solo para mostrar una vez la clave recién generada."""
        print(message, file=self._runtime.stdout, flush=True)


@dataclass(frozen=True)
class ApplyPlan:
    settings: RelaySettings
    cameras: list[Camera]
    paths: list[PathSpec]
    config: dict[str, Any] = field(repr=False)
    dropin_text: str | None  # None: el drop-in no se administra (Windows, tests, --etc-dir)


# =============================================================================
# Contexto de un comando
# =============================================================================
class Context:
    def __init__(self, etc_dir: Path, runtime: Runtime) -> None:
        self.etc = EtcPaths(etc_dir)
        self.runtime = runtime
        self.console = Console(runtime)

    # --- lectura -----------------------------------------------------------------
    def env_text(self) -> str:
        return read_text_if_exists(self.etc.env) or ""

    def settings(self) -> RelaySettings:
        settings = settings_from_env(parse_env_text(self.env_text()))
        self.console.redact.add(*settings.secrets)
        return settings

    def cameras(self, settings: RelaySettings) -> list[Camera]:
        cameras = resolve_cameras(settings, read_text_if_exists(self.etc.cameras))
        # Las URLs de `url:` pueden traer clave: también se redactan literal.
        for camera in cameras:
            if camera.url:
                password = urllib.parse.urlsplit(camera.url).password
                if password:
                    self.console.redact.add(password, urllib.parse.unquote(password))
        return cameras

    def api_secret(self) -> str:
        text = read_text_if_exists(self.etc.api_secret)
        if text is None or not text.strip():
            raise ConfigError(f"falta {self.etc.api_secret}: corre `vigilia-relay init` (lo hace install.sh)")
        secret = text.strip()
        self.console.redact.add(secret)
        return secret

    def reader_hash(self) -> str:
        text = read_text_if_exists(self.etc.reader_hash)
        if text is None:
            raise ConfigError(f"falta {self.etc.reader_hash}: corre `vigilia-relay init` (lo hace install.sh)")
        return validate_hash(text.strip(), READER_HASH_FILE)

    def build_config(self, *, reader_hash: str | None = None) -> tuple[RelaySettings, list[PathSpec], dict[str, Any]]:
        plan = self.build_plan(reader_hash=reader_hash, with_dropin=False)
        return plan.settings, plan.paths, plan.config

    def build_plan(self, *, reader_hash: str | None = None, with_dropin: bool = True) -> ApplyPlan:
        settings = self.settings()
        cameras = self.cameras(settings)
        paths = build_paths(settings, cameras)
        config = build_mediamtx_config(
            settings,
            paths,
            reader_hash=reader_hash or self.reader_hash(),
            admin_hash=hash_password(self.api_secret()),
        )
        dropin_text = None
        if with_dropin and self.dropin_path() is not None:
            dropin_text = render_ip_dropin(build_ip_allowlist(settings, cameras))
        return ApplyPlan(settings, cameras, paths, config, dropin_text)

    def api(self, port: int) -> Any:
        return self.runtime.api_factory(port, self.api_secret())

    def dropin_path(self) -> Path | None:
        directory = self.runtime.unit_dropin_dir(self.etc.root)
        return directory / DROPIN_NAME if directory is not None else None

    @property
    def net(self) -> Any:
        if self.runtime.net is None:
            self.runtime.net = SystemNet(self.runtime)
        return self.runtime.net

    def follow_state_path(self) -> Path:
        return self.runtime.state_dir(self.etc.root) / FOLLOW_STATE_FILE

    def learn_nvr_mac(self, settings: RelaySettings, *, force: bool = False) -> str | None:
        """Lee la MAC del NVR de la tabla de vecinos (`ip -j -4 neigh`) y la guarda
        en relay.env si falta (o siempre, con force: `--relearn-mac`). Devuelve la
        MAC o None.

        Solo se llama justo después de un probe OK CON CREDENCIALES al NVR: es el
        ancla de confianza de follow-nvr (un TCP sin credenciales no prueba que
        al otro lado esté el NVR)."""
        nvr = settings.nvr
        if nvr is None or ":" in nvr.host:
            return None
        if nvr.mac and not force:
            return nvr.mac
        found = mac_at(self.net.neighbors(), nvr.host)
        if found is None:
            return None
        try:
            mac = validate_mac(found)
        except ConfigError:
            return None
        if mac == nvr.mac:
            self.console.info(f"NVR_MAC confirmada: {mac} (sin cambios)")
            return mac
        self.write_secret(self.etc.env, update_env_text(self.env_text(), {"NVR_MAC": mac}))
        if nvr.mac:
            self.console.warn(
                f"NVR_MAC cambió de {nvr.mac} a {mac} (el NVR en {nvr.host} respondió con credenciales): "
                "confírmala en la pantalla del NVR (Configuración → Red → TCP/IP)"
            )
        else:
            self.console.info(f"NVR_MAC aprendida: {mac} (el NVR en {nvr.host}); follow-nvr la usa si cambia su IP")
        return mac

    # --- escritura -----------------------------------------------------------------
    def require_root(self) -> None:
        """En la Pi, los comandos que escriben /etc/vigilia-relay van con sudo."""
        if os.name == "posix" and str(self.etc.root) == DEFAULT_ETC_DIR and not self.runtime.is_root():
            raise RelayError("este comando escribe /etc/vigilia-relay: córrelo con sudo")

    def write_secret(self, path: Path, data: str) -> None:
        secret_owner, _ = self.runtime.owners()
        atomic_write(path, data.encode("utf-8"), mode=SECRET_MODE, owner=secret_owner)

    def write_config(self, path: Path, data: str) -> None:
        _, config_owner = self.runtime.owners()
        atomic_write(path, data.encode("utf-8"), mode=CONFIG_MODE, owner=config_owner)

    def write_dropin(self, path: Path, data: str | None) -> bool:
        """Escribe el drop-in (o lo borra con None) y recarga systemd.
        Devuelve False si `systemctl daemon-reload` falló."""
        if data is None:
            path.unlink(missing_ok=True)
        else:
            path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            secret_owner, _ = self.runtime.owners()
            atomic_write(path, data.encode("utf-8"), mode=DROPIN_MODE, owner=secret_owner)
        completed = self.systemctl("daemon-reload")
        if completed is not None and completed.returncode != 0:
            self.console.warn("systemctl daemon-reload falló")
            return False
        return True

    def wait_reload_window(self) -> None:
        """Espera hasta que la última escritura de la config tenga RELOAD_GUARD_S."""
        try:
            age = self.runtime.wall_time() - self.etc.config.stat().st_mtime
        except FileNotFoundError:
            return
        if 0 <= age < RELOAD_GUARD_S:
            self.runtime.sleep(RELOAD_GUARD_S - age)

    def warn_permissions(self) -> None:
        if os.name != "posix":
            return
        for path in self.etc.secret_files():
            try:
                mode = path.stat().st_mode
            except FileNotFoundError:
                continue
            if mode & 0o077:
                self.console.warn(f"{path} es legible por otros usuarios: chmod 600 {path}")

    def warn_reader_networks(self, settings: RelaySettings) -> None:
        if settings.reader_networks_defaulted:
            # Fail-closed: la config es segura (sale con 0), pero nadie del tailnet ve nada.
            self.console.warn(
                "READER_ALLOWED_IPS no está definido: el relay solo acepta lectores locales (loopback) y nadie "
                "del tailnet puede ver las cámaras. Agrega en "
                f"{self.etc.env} la IP de Tailscale de cada consumidor, p. ej. READER_ALLOWED_IPS='100.x.y.z' "
                "(`tailscale ip -4` en tu PC), y corre `sudo vigilia-relay apply`.",
                label="AVISO (lectores solo por loopback)",
            )
        outside = networks_outside_tailscale(settings.reader_networks)
        if outside:
            self.console.warn(
                f"READER_ALLOWED_IPS tiene IPs fuera de Tailscale ({', '.join(outside)}): los lectores llegan por "
                f"el tailnet ({', '.join(TAILSCALE_NETWORKS)}); desde la LAN, UFW los bloquea."
            )

    # --- servicio ------------------------------------------------------------------
    def systemctl(self, *args: str) -> subprocess.CompletedProcess[str] | None:
        return self.runtime.command(["systemctl", *args], 30.0)

    def service_state(self) -> str | None:
        completed = self.systemctl("is-active", SERVICE_UNIT)
        return completed.stdout.strip() if completed is not None else None

    def restart_service(self) -> None:
        completed = self.systemctl("restart", SERVICE_UNIT)
        if completed is not None and completed.returncode != 0:
            self.console.warn(f"systemctl restart {SERVICE_UNIT} falló")

    def prober(self, timeout_s: float) -> Callable[[str, str], ProbeResult]:
        privileges = self.runtime.probe_privileges()

        def probe_one(label: str, url: str) -> ProbeResult:
            return probe_url(
                label,
                url,
                ffprobe=self.runtime.ffprobe,
                runner=self.runtime.runner,
                redactor=self.console.redact,
                timeout_s=timeout_s,
                privileges=privileges,
            )

        return probe_one

    def wait_until(self, check: Callable[[], tuple[bool, str]], timeout_s: float) -> tuple[bool, str]:
        deadline = self.runtime.monotonic() + timeout_s
        reason = "sin respuesta"
        while True:
            ok, reason = check()
            if ok:
                return True, reason
            if self.runtime.monotonic() >= deadline:
                return False, reason
            self.runtime.sleep(APPLY_POLL_S)


# =============================================================================
# Aplicar (validar -> probe -> .prev -> escritura atómica -> API -> rollback)
# =============================================================================
def apply_config(
    ctx: Context,
    config: Mapping[str, Any],
    *,
    wait_s: float = APPLY_WAIT_S,
    dropin_text: str | None = None,
) -> str:
    """Escribe la config (y el drop-in de red, si cambió) y verifica que
    MediaMTX la cargó; si no, rollback.

    Devuelve "unchanged" o "applied". Lanza ApplyRolledBack (se restauró la
    anterior y responde) o RollbackFailed (el relay quedó sin responder).
    Solo reinicia el servicio si cambió el drop-in (IPAddressAllow se lee al
    arrancar) o al revertir; el resto es recarga en caliente.
    """
    new_text = render_config_text(config)
    expected = ConfigExpectation.from_config(config)
    current_text = read_text_if_exists(ctx.etc.config)
    dropin_path = ctx.dropin_path() if dropin_text is not None else None
    current_dropin = read_text_if_exists(dropin_path) if dropin_path is not None else None
    config_changed = current_text != new_text
    dropin_changed = dropin_path is not None and current_dropin != dropin_text

    def new_check() -> tuple[bool, str]:
        return api_state_matches(ctx.api(expected.api_port), expected)

    if not config_changed and not dropin_changed:
        ok, reason = ctx.wait_until(new_check, wait_s)
        if ok:
            return "unchanged"
        # Mismo archivo pero MediaMTX no lo refleja: no hay nada que revertir.
        raise RollbackFailed(f"la config no cambió, pero MediaMTX no la refleja ({reason}): revisa `vigilia-relay status`")

    if config_changed and current_text is not None:
        ctx.write_config(ctx.etc.config_prev, current_text)
    if dropin_changed:
        assert dropin_path is not None
        if not ctx.write_dropin(dropin_path, dropin_text):
            # systemd no tomó la red nueva: se vuelve a la anterior y no se toca la config.
            ctx.write_dropin(dropin_path, current_dropin)
            raise SystemdReloadFailed(
                "systemctl daemon-reload falló: se restauró la red permitida anterior y NO se aplicó la config "
                "nueva (revisa `systemctl status` y `journalctl -b -p warning`)"
            )
    if config_changed:
        ctx.wait_reload_window()
        ctx.write_config(ctx.etc.config, new_text)
    if dropin_changed:
        ctx.console.info("Cambió la red permitida al servicio (IPAddressAllow): reiniciando vigilia-relay")
        ctx.restart_service()

    ok, reason = ctx.wait_until(new_check, wait_s)
    if ok:
        return "applied"

    if config_changed and current_text is None:
        raise RollbackFailed(f"la config nueva no quedó activa ({reason}) y no hay versión anterior para restaurar")
    ctx.console.warn(f"la config nueva no quedó activa en {wait_s:.0f} s ({reason}): restaurando la anterior")
    if dropin_changed:
        assert dropin_path is not None
        ctx.write_dropin(dropin_path, current_dropin)
    if config_changed:
        assert current_text is not None
        ctx.wait_reload_window()
        ctx.write_config(ctx.etc.config, current_text)
    ctx.restart_service()
    previous_text = current_text if current_text is not None else new_text
    previous = parse_rendered_config(previous_text)
    if previous is not None:
        previous_expected = ConfigExpectation.from_config(previous)

        def previous_check() -> tuple[bool, str]:
            return api_state_matches(ctx.api(previous_expected.api_port), previous_expected)

    else:

        def previous_check() -> tuple[bool, str]:
            try:
                ctx.api(expected.api_port).get_json("/v3/config/global/get")
            except ApiError as exc:
                return False, str(exc)
            return True, "responde"

    restored, restored_reason = ctx.wait_until(previous_check, ROLLBACK_WAIT_S)
    if restored:
        raise ApplyRolledBack(f"la config nueva no quedó activa ({reason}); se restauró la anterior y el relay responde")
    raise RollbackFailed(
        f"la config nueva no quedó activa ({reason}) y tras restaurar la anterior el relay no responde "
        f"({restored_reason}): revisa `journalctl -u {SERVICE_UNIT}`"
    )


def probe_before_apply(ctx: Context, paths: Sequence[PathSpec]) -> bool:
    """Exige un ffprobe OK de al menos una cámara antes de escribir la config.
    Devuelve True si respondió una cámara del NVR (`nvr:`)."""
    targets = [(path.name, path.source) for path in paths if path.stream in ("sub", "url")]
    if not targets:
        ctx.console.info("Sin cámaras configuradas: no hay nada que probar.")
        return False
    ctx.console.info("Probando el origen antes de aplicar (de a uno, se corta en el primer rechazo)...")
    results = probe_sequence(
        targets,
        ctx.prober(PROBE_TIMEOUT_S),
        stop_at_first_ok=True,
        on_result=lambda result: ctx.console.info("  " + describe_probe(result)),
    )
    if results and results[-1].status == "auth":
        raise ProbeFailed(
            "el origen rechazó las credenciales: no se aplicó nada. Revisa con `vigilia-relay set-nvr` "
            "(cada intento fallido acerca el bloqueo de IP del NVR)"
        )
    if not any(result.ok for result in results):
        raise ProbeFailed("ninguna cámara respondió: no se aplicó nada (revisa `vigilia-relay probe`)")
    streams = {path.name: path.stream for path in paths}
    return any(result.ok and streams.get(result.label) == "sub" for result in results)


# =============================================================================
# Lock (un solo apply / rotate-password / set-nvr / follow-nvr a la vez)
# =============================================================================
LOCK_FILE = ".vigilia-relay.lock"
BUSY_MESSAGE = (
    "hay otro apply, rotate-password, set-nvr o follow-nvr (el timer, cada 5 min) en curso: "
    "espera a que termine y vuelve a intentar"
)


def _lock_fd(fd: int) -> None:
    """Lock exclusivo no bloqueante; BlockingIOError si otro lo tiene."""
    try:
        import fcntl
    except ImportError:  # Windows: solo tests y E2E
        import msvcrt

        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)  # type: ignore[attr-defined]
        except OSError:
            raise BlockingIOError(errno.EWOULDBLOCK, BUSY_MESSAGE) from None
        return
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock_fd(fd: int) -> None:
    try:
        import fcntl
    except ImportError:
        import msvcrt

        with contextlib.suppress(OSError):
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)  # type: ignore[attr-defined]
        return
    fcntl.flock(fd, fcntl.LOCK_UN)


@contextlib.contextmanager
def relay_lock(directory: Path) -> Iterator[None]:
    """flock sobre /etc/vigilia-relay/.vigilia-relay.lock (lo libera el kernel si el proceso muere)."""
    fd = os.open(directory / LOCK_FILE, os.O_RDWR | os.O_CREAT, SECRET_MODE)
    try:
        try:
            _lock_fd(fd)
        except BlockingIOError:
            raise RelayBusy(BUSY_MESSAGE) from None
        try:
            yield
        finally:
            _unlock_fd(fd)
    finally:
        os.close(fd)


CommandFn = Callable[..., int]  # (ctx, args) -> exit code


def exclusive(command: CommandFn) -> CommandFn:
    @functools.wraps(command)
    def wrapper(ctx: Context, args: argparse.Namespace) -> int:
        ctx.require_root()
        with relay_lock(ctx.etc.root):
            return command(ctx, args)

    return wrapper


# =============================================================================
# Comandos
# =============================================================================
def cmd_init(ctx: Context, args: argparse.Namespace) -> int:
    """Crea lo que falte (secretos y config inicial). No pisa nada existente."""
    ctx.require_root()
    _, config_owner = ctx.runtime.owners()
    ctx.etc.root.mkdir(mode=DIR_MODE, parents=True, exist_ok=True)
    if config_owner is not None and hasattr(os, "chown"):
        os.chown(ctx.etc.root, *config_owner)
        os.chmod(ctx.etc.root, DIR_MODE)
    created: list[str] = []
    if read_text_if_exists(ctx.etc.api_secret) is None:
        ctx.write_secret(ctx.etc.api_secret, secrets.token_urlsafe(API_SECRET_BYTES) + "\n")
        created.append(API_SECRET_FILE)
    if read_text_if_exists(ctx.etc.reader_hash) is None:
        # Clave que nadie conoce: la del lector se obtiene con rotate-password.
        ctx.write_secret(ctx.etc.reader_hash, hash_password(secrets.token_urlsafe(READER_PASSWORD_BYTES)) + "\n")
        created.append(READER_HASH_FILE)
    if read_text_if_exists(ctx.etc.config) is None:
        _, _, config = ctx.build_config()
        ctx.write_config(ctx.etc.config, render_config_text(config))
        created.append(CONFIG_FILE)
    _fix_permissions(ctx)
    ctx.console.info(f"init: creado {', '.join(created)}" if created else "init: sin cambios")
    return EXIT_OK


def _fix_permissions(ctx: Context) -> None:
    if os.name != "posix" or not ctx.runtime.is_root():
        return
    secret_owner, config_owner = ctx.runtime.owners()
    for path in ctx.etc.secret_files():
        if path.exists() and secret_owner is not None:
            os.chown(path, *secret_owner)
            os.chmod(path, SECRET_MODE)
    for path in (ctx.etc.config, ctx.etc.config_prev):
        if path.exists() and config_owner is not None:
            os.chown(path, *config_owner)
            os.chmod(path, CONFIG_MODE)


def cmd_render(ctx: Context, args: argparse.Namespace) -> int:
    """Escribe la config a un archivo (tests y E2E). Nunca a stdout: lleva claves."""
    _, paths, config = ctx.build_config()
    out = Path(args.out)
    atomic_write(out, render_config_text(config).encode("utf-8"), mode=SECRET_MODE)
    ctx.console.info(f"render: {len(paths)} paths -> {out}")
    return EXIT_OK


def cmd_probe(ctx: Context, args: argparse.Namespace) -> int:
    settings = ctx.settings()
    if settings.nvr is None:
        raise ConfigError("falta configurar el NVR: corre `sudo vigilia-relay set-nvr`")
    if not 1 <= args.timeout <= 60:
        raise ConfigError("--timeout debe estar entre 1 y 60 segundos")
    channels = parse_channel_spec(args.channels) if args.channels else list(range(1, settings.nvr_channels + 1))
    stream_name = "principal" if args.stream == "main" else "substream"
    ctx.console.info(f"Probando {len(channels)} canal(es) del NVR ({stream_name}), de a uno:")
    targets = [(f"canal {channel}", nvr_stream_url(settings.nvr, channel, args.stream)) for channel in channels]
    results = probe_sequence(
        targets,
        ctx.prober(args.timeout),
        on_result=lambda result: ctx.console.info("  " + describe_probe(result)),
    )
    if results and results[-1].status == "auth":
        ctx.console.error(
            "el NVR rechazó las credenciales: se detuvo el probe para no bloquear la IP. "
            "Revisa el usuario y la clave con `sudo vigilia-relay set-nvr`."
        )
        return EXIT_PROBE_FAILED
    ok = sum(1 for result in results if result.ok)
    ctx.console.info(f"{ok} de {len(results)} canal(es) OK")
    return EXIT_OK if ok else EXIT_PROBE_FAILED


@exclusive
def cmd_apply(ctx: Context, args: argparse.Namespace) -> int:
    ctx.require_root()
    plan = ctx.build_plan()
    ctx.warn_reader_networks(plan.settings)
    _fix_permissions(ctx)  # p. ej. un cameras.conf recién creado con nano (644)
    ctx.warn_permissions()
    if ctx.service_state() == "inactive":
        raise RelayError(f"el servicio está detenido: sudo systemctl start {SERVICE_UNIT}")
    nvr_answered = False
    if args.relearn_mac:
        # Solo con un probe OK con credenciales a una cámara DEL NVR (no basta una url:).
        if plan.settings.nvr is None:
            raise RelayError("--relearn-mac: no hay NVR configurado (corre `sudo vigilia-relay set-nvr`)")
        nvr_paths = [path for path in plan.paths if path.stream == "sub"]
        if not nvr_paths:
            raise RelayError("--relearn-mac: cameras.conf no tiene cámaras del NVR (nvr:N) con las que probar")
        nvr_answered = probe_before_apply(ctx, nvr_paths)
    elif args.skip_probe:
        ctx.console.warn("--skip-probe: se aplica sin comprobar el origen")
    else:
        nvr_answered = probe_before_apply(ctx, plan.paths)
    result = apply_config(ctx, plan.config, dropin_text=plan.dropin_text)
    if result == "unchanged":
        ctx.console.info("apply: sin cambios (la config activa ya es esta)")
    else:
        ctx.console.info(f"apply: config activa con {len(plan.paths)} paths (la anterior quedó en {ctx.etc.config_prev.name})")
    # El NVR respondió con credenciales: es el momento de aprender su MAC si falta
    # (o de releerla, con --relearn-mac: NVR reemplazado en la misma IP).
    if nvr_answered and plan.settings.nvr is not None and (args.relearn_mac or plan.settings.nvr.mac is None):
        if ctx.learn_nvr_mac(plan.settings, force=args.relearn_mac) is None:
            if args.relearn_mac:
                ctx.console.error("--relearn-mac: no se pudo leer la MAC del NVR de la tabla de vecinos (ip neigh): NVR_MAC quedó como estaba")
                return EXIT_ERROR
            ctx.console.warn(
                "no se pudo leer la MAC del NVR de la tabla de vecinos (ip neigh): corre `sudo vigilia-relay apply` "
                "de nuevo o fija NVR_MAC a mano (follow-nvr no la aprende solo)"
            )
    return EXIT_OK


def _deliver_password(ctx: Context, password: str, out: str | None) -> None:
    if out:
        atomic_write(Path(out), (password + "\n").encode("utf-8"), mode=SECRET_MODE)
        ctx.console.info(f"Clave nueva del lector guardada en {out} (600). Bórrala cuando la copies.")
        return
    ctx.console.info(f"Clave nueva del lector ({READER_USER}); se muestra UNA sola vez:")
    ctx.console.reveal(f"  {password}")


@exclusive
def cmd_rotate_password(ctx: Context, args: argparse.Namespace) -> int:
    ctx.require_root()
    if not args.out and not ctx.runtime.stdout_isatty():
        raise RelayError("la clave solo se muestra en una terminal: usa --out <archivo> o corre el comando en una sesión interactiva")
    password = secrets.token_urlsafe(READER_PASSWORD_BYTES)
    new_hash = hash_password(password)
    if args.no_apply:
        ctx.write_secret(ctx.etc.reader_hash, new_hash + "\n")
        _deliver_password(ctx, password, args.out)
        ctx.console.info("reader.hash actualizado; corre `sudo vigilia-relay apply` para activarla.")
        return EXIT_OK
    plan = ctx.build_plan(reader_hash=new_hash)
    ctx.warn_reader_networks(plan.settings)
    if not args.skip_probe:
        probe_before_apply(ctx, plan.paths)
    apply_config(ctx, plan.config, dropin_text=plan.dropin_text)
    # Solo después de que MediaMTX la cargó: si el apply falla, la clave vieja sigue valiendo.
    ctx.write_secret(ctx.etc.reader_hash, new_hash + "\n")
    _deliver_password(ctx, password, args.out)
    ctx.console.info("La clave anterior dejó de valer. Actualízala en VLC/ffplay y en los consumidores.")
    return EXIT_OK


@exclusive
def cmd_set_nvr(ctx: Context, args: argparse.Namespace) -> int:
    ctx.require_root()
    if not ctx.runtime.stdin_isatty():
        raise RelayError("set-nvr es interactivo: córrelo en una terminal (sudo vigilia-relay set-nvr)")
    text = ctx.env_text()
    current = parse_env_text(text)
    read_input = ctx.runtime.read_input

    host = read_input(f"IP del NVR (fija o con reserva DHCP) [{current.get('NVR_HOST', '')}]: ").strip() or current.get("NVR_HOST", "")
    host = validate_ip_host(host)
    port_default = current.get("NVR_PORT") or str(DEFAULT_NVR_PORT)
    port = read_input(f"Puerto RTSP del NVR [{port_default}]: ").strip() or port_default
    parse_port("NVR_PORT", port)
    user = read_input(f"Usuario del NVR (solo vista en vivo) [{current.get('NVR_USER', '')}]: ").strip()
    user = validate_nvr_credential("NVR_USER", user or current.get("NVR_USER", ""), MAX_NVR_USER_LENGTH)

    keep_hint = " (Enter para mantener la actual)" if current.get("NVR_PASS") else ""
    password = ctx.runtime.read_secret(f"Clave del usuario del NVR{keep_hint}: ")
    if password:
        if ctx.runtime.read_secret("Repite la clave: ") != password:
            raise RelayError("las claves no coinciden: no se guardó nada")
    elif current.get("NVR_PASS"):
        password = current["NVR_PASS"]
    password = validate_nvr_credential("NVR_PASS", password, MAX_NVR_PASS_LENGTH)
    ctx.console.redact.add(password)

    updates: dict[str, str | None] = {"NVR_HOST": host, "NVR_PORT": port, "NVR_USER": user, "NVR_PASS": password}
    if current.get("NVR_HOST") and current.get("NVR_HOST") != host:
        # Otra IP puede ser otro equipo: la MAC se vuelve a aprender.
        updates["NVR_MAC"] = None
    new_text = update_env_text(text, updates)
    settings = settings_from_env(parse_env_text(new_text))  # valida el archivo completo antes de escribir
    ctx.write_secret(ctx.etc.env, new_text)
    ctx.console.info(f"NVR guardado en {ctx.etc.env} (600).")
    # Un solo intento (canal 1, substream): confirma las credenciales y, si
    # responde, aprende la MAC del NVR para follow-nvr.
    assert settings.nvr is not None
    result = ctx.prober(PROBE_TIMEOUT_S)("canal 1", nvr_stream_url(settings.nvr, 1, "sub"))
    ctx.console.info("  " + describe_probe(result))
    code = EXIT_OK
    if result.ok:
        if args.relearn_mac or settings.nvr.mac is None:
            if ctx.learn_nvr_mac(settings, force=args.relearn_mac) is None:
                if args.relearn_mac:
                    ctx.console.error("--relearn-mac: no se pudo leer la MAC del NVR (ip neigh): NVR_MAC quedó como estaba")
                    code = EXIT_ERROR
                else:
                    ctx.console.warn("no se pudo leer la MAC del NVR (ip neigh): se aprenderá en el próximo apply")
        ctx.console.info("Siguiente paso: sudo vigilia-relay probe --channels 1-16")
    else:
        if result.status == "auth":
            ctx.console.warn("el NVR rechazó las credenciales: revísalas antes de reintentar (el NVR bloquea la IP tras unos pocos intentos)")
        else:
            ctx.console.info("El canal 1 no respondió; prueba los demás con: sudo vigilia-relay probe --channels 1-16")
        if args.relearn_mac:
            # La MAC solo se relee tras un probe OK con credenciales: sin él, nada.
            ctx.console.error(
                "--relearn-mac: el canal 1 no respondió con credenciales: NVR_MAC quedó como estaba "
                "(si el canal 1 no tiene cámara, usa `sudo vigilia-relay apply --relearn-mac`)"
            )
            code = EXIT_PROBE_FAILED
    return code


def _tailscale_ipv4(ctx: Context) -> str | None:
    completed = ctx.runtime.command(["tailscale", "ip", "-4"], 5.0)
    if completed is None or completed.returncode != 0:
        return None
    for line in completed.stdout.splitlines():
        candidate = line.strip()
        try:
            if isinstance(ipaddress.ip_address(candidate), ipaddress.IPv4Address):
                return candidate
        except ValueError:
            continue
    return None


def cmd_urls(ctx: Context, args: argparse.Namespace) -> int:
    settings = ctx.settings()
    paths = build_paths(settings, ctx.cameras(settings))
    if not paths:
        ctx.console.info("No hay cámaras configuradas (cameras.conf o set-nvr).")
        return EXIT_OK
    hosts = ["vigilia-relay"]
    tailscale_ip = _tailscale_ipv4(ctx)
    if tailscale_ip:
        hosts.append(tailscale_ip)
    ctx.console.info(f"Usuario: {READER_USER}. <CLAVE> es la de `rotate-password` (no se guarda en la Pi).")
    ctx.console.info(f"Host: {' o '.join(hosts)} (MagicDNS o IP de Tailscale; en Linux, mejor la IP 100.x).")
    ctx.console.info()
    for path in paths:
        stream = {"sub": "substream", "main": "principal", "url": "url"}[path.stream]
        ctx.console.info(
            f"  {path.name:<20} rtsp://{READER_USER}:<CLAVE>@{hosts[-1]}:{settings.rtsp_port}/{path.name}   ({stream})",
            scrub_urls=False,
        )
    ctx.console.info()
    example = paths[0].name
    ctx.console.info("Ejemplo desde casa:", scrub_urls=False)
    ctx.console.info(
        f'  ffplay -rtsp_transport tcp "rtsp://{READER_USER}:<CLAVE>@{hosts[-1]}:{settings.rtsp_port}/{example}"',
        scrub_urls=False,
    )
    return EXIT_OK


def _read_first_line(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.readline().strip()
    except OSError:
        return None


def _meminfo() -> dict[str, int]:
    values: dict[str, int] = {}
    try:
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                key, _, rest = line.partition(":")
                number = rest.strip().split(" ")[0]
                if number.isascii() and number.isdigit():
                    values[key] = int(number)
    except OSError:
        pass
    return values


THROTTLED_BITS = {
    0: "bajo voltaje AHORA",
    1: "frecuencia limitada AHORA",
    2: "throttling AHORA",
    3: "límite de temperatura AHORA",
    16: "hubo bajo voltaje",
    17: "hubo frecuencia limitada",
    18: "hubo throttling",
    19: "hubo límite de temperatura",
}


def describe_throttled(output: str) -> str:
    """`throttled=0x50005` -> texto. Ver la doc de vcgencmd get_throttled."""
    _, _, value = output.strip().partition("=")
    try:
        flags = int(value, 16)
    except ValueError:
        return "n/d"
    if flags == 0:
        return "0x0 (sin problemas de alimentación ni temperatura)"
    notes = [text for bit, text in THROTTLED_BITS.items() if flags & (1 << bit)]
    return f"{value} ({', '.join(notes)})"


def cmd_status(ctx: Context, args: argparse.Namespace) -> int:
    console = ctx.console
    settings = ctx.settings()
    ctx.warn_reader_networks(settings)
    ctx.warn_permissions()

    console.info("== Servicios")
    for unit in STATUS_UNITS:
        completed = ctx.systemctl("is-active", unit)
        console.info(f"  {unit:<32} {completed.stdout.strip() if completed is not None else 'n/d'}")
    memory = ctx.systemctl("show", "-p", "MemoryCurrent", "--value", SERVICE_UNIT)
    if memory is not None and memory.stdout.strip().isdigit():
        console.info(f"  RAM de MediaMTX: {int(memory.stdout.strip()) // (1024 * 1024)} MiB")
    dropin = ctx.dropin_path()
    dropin_text = read_text_if_exists(dropin) if dropin is not None else None
    if dropin_text:
        allowed = [line.partition("=")[2] for line in dropin_text.splitlines() if line.startswith("IPAddressAllow=")]
        console.info(f"  Red permitida (IPAddressAllow): {allowed[-1] if allowed else '?'}")
    elif dropin is not None:
        console.info("  Red permitida: solo loopback y Tailscale (falta `apply` para agregar el NVR)")
    if settings.nvr is not None:
        mac = settings.nvr.mac or "sin fijar (fíjala a mano o corre apply: follow-nvr no la aprende)"
        console.info(f"  NVR: {settings.nvr.host}:{settings.nvr.port}, NVR_MAC {mac}")
        state, _ = load_follow_state(ctx.follow_state_path())
        if state.day != _today(ctx):
            state.changes_today = state.attempts_today = 0
        last = f", último cambio {state.last_change}" if state.last_change else ""
        console.info(
            f"  follow-nvr: {state.fail_count} fallo(s) seguidos; hoy {state.changes_today} de "
            f"{FOLLOW_MAX_CHANGES_PER_DAY} cambio(s) de IP y {state.attempts_today} de {FOLLOW_MAX_ATTEMPTS_PER_DAY} intento(s){last}"
        )
    last_run = ctx.systemctl("show", "-p", "Result", "-p", "ExecMainStatus", "-p", "ExecMainExitTimestamp", FOLLOW_SERVICE_UNIT)
    if last_run is not None and last_run.returncode == 0:
        console.info(f"  última pasada de follow-nvr: {describe_follow_run(last_run.stdout)}")

    console.info("== Tailscale")
    tailscale = ctx.runtime.command(["tailscale", "status"], 5.0)
    if tailscale is None:
        console.info("  tailscale no está instalado")
    else:
        for line in (tailscale.stdout or tailscale.stderr).splitlines()[:15]:
            console.info("  " + line)

    console.info("== Paths (API local)")
    exit_code = EXIT_OK
    try:
        listing = ctx.api(settings.api_port).get_json("/v3/paths/list?itemsPerPage=1000")
        items = listing.get("items") if isinstance(listing, dict) else None
        if not items:
            console.info("  (sin paths)")
        for item in items or []:
            if not isinstance(item, dict):
                continue
            readers = item.get("readers") or []
            console.info(
                f"  {str(item.get('name', '?')):<20} ready={'sí' if item.get('ready') else 'no':<3} "
                f"lectores={len(readers) if isinstance(readers, list) else '?'}"
            )
    except ApiError as exc:
        console.info(f"  {exc}")
        exit_code = EXIT_ERROR

    console.info("== Sistema")
    meminfo = _meminfo()
    if meminfo:
        console.info(
            f"  RAM: {meminfo.get('MemAvailable', 0) // 1024} MiB libres de {meminfo.get('MemTotal', 0) // 1024} MiB"
        )
    load = _read_first_line("/proc/loadavg")
    if load:
        console.info(f"  Carga: {' '.join(load.split()[:3])}")
    temperature = _read_first_line("/sys/class/thermal/thermal_zone0/temp")
    if temperature and temperature.isdigit():
        console.info(f"  Temperatura: {int(temperature) / 1000:.1f} °C")
    throttled = ctx.runtime.command(["vcgencmd", "get_throttled"], 5.0)
    if throttled is not None and throttled.returncode == 0:
        console.info(f"  get_throttled: {describe_throttled(throttled.stdout)}")
    return exit_code


# =============================================================================
# follow-nvr: seguir la IP del NVR (DHCP) por su MAC
# =============================================================================
def _ip_sort_key(ip: str) -> int:
    return int(ipaddress.IPv4Address(ip))


FOLLOW_EXIT_MEANINGS = {
    EXIT_OK: "OK",
    EXIT_PROBE_FAILED: "el probe a la IP nueva falló",
    EXIT_ROLLED_BACK: "se revirtió",
    EXIT_ROLLBACK_FAILED: "el rollback falló",
    EXIT_STORAGE: "no se pudo guardar el estado",
    EXIT_BUSY: "lock ocupado: no hizo nada",
    EXIT_MAC_DUPLICATE: "ALERTA: MAC del NVR en 2+ IPs",
    EXIT_NVR_NOT_FOUND: "NVR no encontrado o falta NVR_MAC",
    EXIT_DAILY_LIMIT: "tope diario",
}


def describe_follow_run(text: str) -> str:
    """`systemctl show -p Result -p ExecMainStatus -p ExecMainExitTimestamp` de la unidad."""
    values = {key: value.strip() for key, _, value in (line.partition("=") for line in text.splitlines()) if key}
    when = values.get("ExecMainExitTimestamp", "")
    if not when or when == "n/a":
        return "todavía no corrió desde el arranque"
    status = values.get("ExecMainStatus", "")
    meaning = FOLLOW_EXIT_MEANINGS.get(int(status)) if status.isdigit() else None
    code = f"exit {status or '?'}" + (f" ({meaning})" if meaning else "")
    return f"{code}, Result={values.get('Result') or '?'}, {when}"


def _today(ctx: Context) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ctx.runtime.wall_time()))


def follow_nvr(ctx: Context) -> int:
    """Un chequeo del timer (README, "IP del NVR por DHCP: seguimiento automático").

    1. Sin NVR_MAC: no sigue a nadie (exit 10). La MAC es el ancla de confianza: la
       fijan set-nvr/apply tras un probe OK con credenciales, o el usuario a mano.
    2. Chequeo barato: TCP a NVR_HOST:NVR_PORT y MAC de `ip neigh` == NVR_MAC.
    3. Falla: suma 1 al contador; con menos de FOLLOW_FAIL_THRESHOLD seguidos, espera.
    4. Barre la /24 de la interfaz (ping, en paralelo acotado) y busca la MAC.
    5. Una sola IP con la MAC respondiendo en el puerto: actualiza NVR_HOST y corre
       el flujo de apply (probe obligatorio, drop-in con la /32 nueva, rollback).
    6. La MAC en 2+ IPs vivas: alerta (posible suplantación ARP), ningún cambio.
    Topes por día: FOLLOW_MAX_CHANGES_PER_DAY cambios aplicados y
    FOLLOW_MAX_ATTEMPTS_PER_DAY intentos (un intento revertido no gasta un cambio).
    El lock lo pone `exclusive`.
    Nunca imprime la clave del NVR (todo pasa por el Redactor).
    """
    console = ctx.console
    settings = ctx.settings()
    nvr = settings.nvr
    if nvr is None:
        console.info("follow-nvr: no hay NVR configurado (set-nvr): nada que seguir")
        return EXIT_OK
    if ":" in nvr.host:
        console.info("follow-nvr: el NVR tiene IPv6; el seguimiento por MAC es solo IPv4: nada que hacer")
        return EXIT_OK

    state_path = ctx.follow_state_path()
    state, problem = load_follow_state(state_path)
    if problem:
        console.warn(f"follow-nvr: {problem}")
    today = _today(ctx)
    if state.day != today:
        state.day, state.changes_today, state.attempts_today = today, 0, 0

    def finish(code: int) -> int:
        if save_follow_state(state_path, state):
            return code
        console.warn(f"follow-nvr: no se pudo guardar el estado en {state_path} ({SD_SECTION}): el contador de fallos no avanza")
        return code if code != EXIT_OK else EXIT_STORAGE

    if nvr.mac is None:
        # Sin ancla de confianza no se sigue a nadie. NO se aprende aquí: un TCP sin
        # credenciales no prueba que al otro lado esté el NVR.
        console.warn(
            "follow-nvr: falta NVR_MAC: no se sigue al NVR sin ella. Fíjala en relay.env con la MAC que muestra la "
            "pantalla del NVR (Configuración → Red → TCP/IP) o corre `sudo vigilia-relay apply` (la aprende tras un "
            "probe OK con credenciales)"
        )
        return finish(EXIT_NVR_NOT_FOUND)

    net = ctx.net
    target = f"{nvr.host}:{nvr.port}"
    reachable = net.tcp_ok(nvr.host, nvr.port, FOLLOW_TCP_TIMEOUT_S)
    seen_mac = mac_at(net.neighbors(), nvr.host) if reachable else None

    if reachable and seen_mac == nvr.mac:
        if state.fail_count:
            console.info(f"follow-nvr: el NVR volvió a responder en {target}")
        state.fail_count = 0
        console.info(f"follow-nvr: OK, sin cambios (NVR en {target}, MAC {nvr.mac})")
        return finish(EXIT_OK)

    if not reachable:
        reason = f"no responde en {target}"
    elif seen_mac is None:
        reason = f"responde en {target}, pero no se ve su MAC en ip neigh"
    else:
        reason = f"en {nvr.host} responde otro equipo (MAC {seen_mac})"
    state.fail_count += 1
    if state.fail_count < FOLLOW_FAIL_THRESHOLD:
        console.warn(f"follow-nvr: el NVR {reason} (fallo {state.fail_count} de {FOLLOW_FAIL_THRESHOLD}): se espera al próximo chequeo")
        return finish(EXIT_OK)
    if state.changes_today >= FOLLOW_MAX_CHANGES_PER_DAY:
        console.error(
            f"follow-nvr: el NVR {reason}, pero ya se hicieron los {FOLLOW_MAX_CHANGES_PER_DAY} cambios de IP de hoy: "
            "no se cambia nada (revisa la red o fija la IP a mano con set-nvr)"
        )
        return finish(EXIT_DAILY_LIMIT)
    if state.attempts_today >= FOLLOW_MAX_ATTEMPTS_PER_DAY:
        # Intentos fallidos o revertidos: sin este tope, cada pasada volvería a barrer
        # y a mandar la credencial al mismo candidato (y a acercar el bloqueo del NVR).
        console.error(
            f"follow-nvr: el NVR {reason}, pero ya se hicieron los {FOLLOW_MAX_ATTEMPTS_PER_DAY} intentos de cambio de IP "
            "de hoy (fallaron o se revirtieron): no se busca más hasta mañana (revisa `journalctl -u "
            "vigilia-relay-follow-nvr` y fija la IP a mano con set-nvr)"
        )
        return finish(EXIT_DAILY_LIMIT)

    iface, interface = net.local_interface()
    if interface is None:
        console.error(f"follow-nvr: el NVR {reason} y {iface} no tiene IPv4: no se puede buscar")
        return finish(EXIT_NVR_NOT_FOUND)
    targets = sweep_targets(interface)
    network = interface.network if interface.network.prefixlen >= 24 else ipaddress.IPv4Network(f"{interface.ip}/24", strict=False)
    console.info(
        f"follow-nvr: el NVR {reason} ({state.fail_count} fallos seguidos): buscando la MAC {nvr.mac} "
        f"en {network} por {iface} ({len(targets)} IPs)"
    )
    net.sweep(targets)
    neighbors = net.neighbors()
    sightings = sorted({n.ip for n in neighbors if n.usable and n.mac == nvr.mac}, key=_ip_sort_key)
    live = [ip for ip in sightings if net.tcp_ok(ip, nvr.port, FOLLOW_TCP_TIMEOUT_S)]
    confirmed = {n.ip for n in neighbors if n.confirmed and n.mac == nvr.mac}
    alive = sorted(set(live) | confirmed, key=_ip_sort_key)
    if len(alive) >= 2:
        console.error(
            f"follow-nvr: ALERTA: la MAC del NVR ({nvr.mac}) aparece en varias IPs ({', '.join(alive)}): "
            "posible suplantación ARP; no se cambia nada (README, «IP del NVR por DHCP»)"
        )
        return finish(EXIT_MAC_DUPLICATE)
    if not live:
        seen = f"; la MAC se ve sin responder en {', '.join(sightings)}" if sightings else ""
        console.error(f"follow-nvr: no se encontró el NVR (MAC {nvr.mac}) respondiendo en el puerto {nvr.port} en {network}{seen}")
        if confirmed:
            # Contesta ARP ahora mismo (no es una entrada vieja), pero no sirve RTSP.
            console.warn(
                f"follow-nvr: {', '.join(sorted(confirmed, key=_ip_sort_key))} contesta ARP con la MAC del NVR pero no el "
                f"puerto {nvr.port}: si no es el NVR reiniciando y se repite, revisa ese equipo "
                "(posible suplantación ARP, README «IP del NVR por DHCP»)"
            )
        if seen_mac is not None and seen_mac != nvr.mac:
            console.warn(
                f"follow-nvr: en {nvr.host} responde otro equipo (MAC {seen_mac}): si reemplazaron el NVR, confirma esa "
                "MAC en su pantalla (Configuración → Red → TCP/IP) y corre `sudo vigilia-relay apply --relearn-mac`"
            )
        return finish(EXIT_NVR_NOT_FOUND)
    new_host = live[0]
    if new_host == nvr.host:
        console.info(f"follow-nvr: el NVR sigue en {target} y responde de nuevo: sin cambios")
        state.fail_count = 0
        return finish(EXIT_OK)
    if nvr.host in sightings:
        console.info(f"follow-nvr: la MAC también figura en {nvr.host} sin responder (entrada vieja de ARP de la IP anterior)")
    others = [ip for ip in sightings if ip not in (new_host, nvr.host)]
    if others:
        # No es la IP anterior: otra mudanza vieja del NVR o un equipo que usa su MAC
        # sin servir el puerto (no recibe nada: solo se sigue a quien pasa el probe).
        console.warn(
            f"follow-nvr: la MAC del NVR también figura en {', '.join(others)}, sin responder en el puerto: puede ser una IP "
            "anterior del NVR o un equipo que la suplanta; si se repite, revisa ese equipo (README «IP del NVR por DHCP»)"
        )

    # El intento se cuenta ANTES de probar: sin estado guardado no regiría el tope.
    state.attempts_today += 1
    if not save_follow_state(state_path, state):
        console.error(f"follow-nvr: no se pudo guardar el estado en {state_path}: no se cambia la IP (el tope de intentos no regiría)")
        return EXIT_STORAGE
    console.warn(
        f"follow-nvr: el NVR (MAC {nvr.mac}) se movió de {nvr.host} a {new_host}: actualizando NVR_HOST y "
        f"reaplicando (intento {state.attempts_today} de {FOLLOW_MAX_ATTEMPTS_PER_DAY} hoy)"
    )
    old_env = ctx.env_text()
    ctx.write_secret(ctx.etc.env, update_env_text(old_env, {"NVR_HOST": new_host}))
    try:
        plan = ctx.build_plan()
        if ctx.service_state() == "inactive":
            raise RelayError(f"el servicio está detenido: sudo systemctl start {SERVICE_UNIT}")
        probe_before_apply(ctx, plan.paths)
        apply_config(ctx, plan.config, dropin_text=plan.dropin_text)
    except BaseException:
        ctx.write_secret(ctx.etc.env, old_env)
        console.error(f"follow-nvr: no se pudo aplicar con el NVR en {new_host}: se restauró NVR_HOST={nvr.host}")
        raise
    # Solo un cambio aplicado gasta del tope de cambios (un intento revertido no).
    state.fail_count = 0
    state.changes_today += 1
    state.last_change = f"{today}: {nvr.host} -> {new_host}"
    console.info(
        f"follow-nvr: listo: NVR_HOST={new_host}; la red permitida y la config quedaron aplicadas "
        f"(cambio {state.changes_today} de {FOLLOW_MAX_CHANGES_PER_DAY} hoy)"
    )
    return finish(EXIT_OK)


@exclusive
def cmd_follow_nvr(ctx: Context, args: argparse.Namespace) -> int:
    ctx.require_root()
    return follow_nvr(ctx)


# =============================================================================
# CLI
# =============================================================================
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vigilia-relay",
        description="Relay de cámaras de Vigilia (MediaMTX on-demand + Tailscale).",
    )
    parser.add_argument("--version", action="version", version=f"vigilia-relay {KIT_VERSION} (MediaMTX {MEDIAMTX_VERSION})")
    parser.add_argument(
        "--etc-dir",
        default=os.environ.get(ETC_DIR_ENV) or DEFAULT_ETC_DIR,
        help=f"carpeta de configuración (default: ${ETC_DIR_ENV} o {DEFAULT_ETC_DIR})",
    )
    commands = parser.add_subparsers(dest="command", required=True, metavar="comando")

    probe = commands.add_parser("probe", help="prueba los canales del NVR con ffprobe, de a uno")
    probe.add_argument("--channels", help="canales: 1-16, 3 o 1,3,5-7 (default: 1..NVR_CHANNELS)")
    probe.add_argument("--stream", choices=("sub", "main"), default="sub", help="substream (default) o principal")
    probe.add_argument("--timeout", type=float, default=PROBE_TIMEOUT_S, help="segundos por canal (default: 8)")
    probe.set_defaults(func=cmd_probe)

    apply = commands.add_parser("apply", help="aplica cameras.conf/relay.env a MediaMTX (con rollback)")
    apply_probe = apply.add_mutually_exclusive_group()
    apply_probe.add_argument("--skip-probe", action="store_true", help="no exige un probe OK antes de aplicar")
    apply_probe.add_argument(
        "--relearn-mac",
        action="store_true",
        help="relee NVR_MAC de ip neigh tras un probe OK al NVR (p. ej. NVR reemplazado en la misma IP)",
    )
    apply.set_defaults(func=cmd_apply)

    status = commands.add_parser("status", help="servicios, Tailscale, paths, RAM, temperatura")
    status.set_defaults(func=cmd_status)

    urls = commands.add_parser("urls", help="URLs para ver las cámaras desde casa")
    urls.set_defaults(func=cmd_urls)

    rotate = commands.add_parser("rotate-password", help="genera una clave nueva para el lector")
    rotate.add_argument("--out", help="escribe la clave a este archivo (600) en vez de mostrarla")
    rotate.add_argument("--no-apply", action="store_true", help="solo actualiza reader.hash (aplica después)")
    rotate.add_argument("--skip-probe", action="store_true", help="no exige un probe OK antes de aplicar")
    rotate.set_defaults(func=cmd_rotate_password)

    set_nvr = commands.add_parser("set-nvr", help="pide host, usuario y clave del NVR (interactivo)")
    set_nvr.add_argument(
        "--relearn-mac",
        action="store_true",
        help="relee NVR_MAC de ip neigh si el canal 1 responde con credenciales",
    )
    set_nvr.set_defaults(func=cmd_set_nvr)

    follow = commands.add_parser("follow-nvr", help="sigue la IP del NVR por su MAC (lo corre un timer cada 5 min)")
    follow.set_defaults(func=cmd_follow_nvr)

    init = commands.add_parser("init", help="crea secretos y config inicial si faltan (lo usa install.sh)")
    init.set_defaults(func=cmd_init)

    render = commands.add_parser("render", help="escribe la config generada a un archivo (tests/E2E)")
    render.add_argument("--out", required=True, help="archivo de salida (600)")
    render.set_defaults(func=cmd_render)
    return parser


def main(argv: Sequence[str] | None = None, runtime: Runtime | None = None) -> int:
    runtime = runtime or Runtime()
    args = build_parser().parse_args(argv)
    ctx = Context(Path(args.etc_dir), runtime)
    try:
        return int(args.func(ctx, args) or EXIT_OK)
    except RelayBusy as exc:
        # No es un error: no se hizo nada (para la unidad de follow-nvr, exit 8 es éxito).
        ctx.console.warn(str(exc))
        return exc.exit_code
    except RelayError as exc:
        ctx.console.error(str(exc))
        return exc.exit_code
    except PermissionError:
        ctx.console.error("permiso denegado: corre el comando con sudo")
        return EXIT_ERROR
    except OSError as exc:
        message, code = describe_os_error(exc)
        ctx.console.error(message)
        return code
    except KeyboardInterrupt:
        ctx.console.error("interrumpido")
        return 130
    except Exception as exc:  # noqa: BLE001 - último recurso: nunca un traceback con datos
        ctx.console.error(f"error inesperado ({type(exc).__name__}): {exc}")
        if os.environ.get(DEBUG_ENV) == "1":
            import traceback

            ctx.console.error(traceback.format_exc())
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
