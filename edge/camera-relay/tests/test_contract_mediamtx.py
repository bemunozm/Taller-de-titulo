"""Contrato con el binario real de MediaMTX v1.15.2 (se salta sin MEDIAMTX_BIN).

    MEDIAMTX_BIN=/ruta/a/mediamtx python -m pytest edge/camera-relay/tests

Arranca el binario con la config renderizada en puertos altos y verifica:
- la config carga (JSON como YAML, `rtspEncryption: "no"`, claves estrictas);
- la API exige auth: solo vigilia-admin desde loopback;
- un DESCRIBE sin credenciales da 401 (y solo ofrece Basic);
- `apply_config` funciona contra la recarga en caliente real;
- una config inválida hace terminar el core (por eso la unidad usa
  Restart=always) y el rollback la recupera con un supervisor que emula a
  systemd;
- el log no contiene ninguna clave.
Todas las claves son falsas.
"""

from __future__ import annotations

import base64
import os
import random
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from conftest import FAKE_NVR_PASS, FAKE_NVR_PASS_ENCODED, write_env
import vigilia_relay as vr

MEDIAMTX_BIN = os.environ.get("MEDIAMTX_BIN", "")
AVAILABLE = bool(MEDIAMTX_BIN) and Path(MEDIAMTX_BIN).is_file()
# Se exige (falla, no se salta) en CI y siempre que MEDIAMTX_BIN esté definido:
# una ruta mal escrita no debe pasar como "skipped".
REQUIRED = os.environ.get("VIGILIA_REQUIRE_CONTRACT") == "1" or bool(MEDIAMTX_BIN)

pytestmark = pytest.mark.skipif(
    not AVAILABLE and not REQUIRED,
    reason="define MEDIAMTX_BIN con la ruta al binario de MediaMTX v1.15.2",
)


def test_binary_is_available() -> None:
    assert AVAILABLE, f"MEDIAMTX_BIN no apunta a un archivo: '{MEDIAMTX_BIN}'"

READER_PASSWORD = "fake-reader-password-contract-0001"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class Supervisor:
    """Corre MediaMTX y lo reinicia si termina (como Restart=always)."""

    def __init__(self, config: Path, log: Path) -> None:
        self.config = config
        self.log = log
        self.starts = 0
        self.exit_codes: list[int] = []
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._process: subprocess.Popen[bytes] | None = None
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def _spawn(self) -> None:
        with open(self.log, "ab") as handle:
            self._process = subprocess.Popen(
                [MEDIAMTX_BIN, str(self.config)],
                cwd=self.config.parent,
                stdout=handle,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
            )
        self.starts += 1

    def start(self, *, supervise: bool = True) -> None:
        with self._lock:
            self._spawn()
        if supervise:
            self._thread.start()

    def _loop(self) -> None:
        while not self._stop.wait(0.2):
            with self._lock:
                if self._process is not None and self._process.poll() is not None:
                    self.exit_codes.append(int(self._process.returncode))
                    time.sleep(0.5)  # RestartSec reducido
                    if not self._stop.is_set():
                        self._spawn()

    def alive(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def wait_exit(self, timeout: float) -> int | None:
        assert self._process is not None
        try:
            return self._process.wait(timeout)
        except subprocess.TimeoutExpired:
            return None

    def stop(self) -> None:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(5)
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                self._process.terminate()
                try:
                    self._process.wait(5)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                    self._process.wait(5)


@dataclass
class Relay:
    etc: Path
    ctx: vr.Context
    supervisor: Supervisor
    rtsp_port: int
    api_port: int
    secret: str = field(repr=False)  # aunque sea de prueba, no va al reporte de pytest

    def http_status(self, path: str, user: str | None = None, password: str | None = None) -> int:
        headers = {}
        if user is not None:
            token = base64.b64encode(f"{user}:{password}".encode()).decode()
            headers["Authorization"] = f"Basic {token}"
        request = urllib.request.Request(f"http://127.0.0.1:{self.api_port}{path}", headers=headers)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=3) as response:
                return int(response.status)
        except urllib.error.HTTPError as exc:
            exc.close()
            return int(exc.code)

    def describe(self, path: str, authorization: str | None = None) -> str:
        lines = [f"DESCRIBE rtsp://127.0.0.1:{self.rtsp_port}/{path} RTSP/1.0", "CSeq: 1"]
        if authorization:
            lines.append(f"Authorization: {authorization}")
        with socket.create_connection(("127.0.0.1", self.rtsp_port), timeout=5) as sock:
            sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
            return sock.recv(4096).decode("utf-8", errors="replace")

    def expectation(self) -> vr.ConfigExpectation:
        config = vr.parse_rendered_config((self.etc / vr.CONFIG_FILE).read_text(encoding="utf-8"))
        assert config is not None
        return vr.ConfigExpectation.from_config(config)

    def wait_ready(self, timeout: float = 15.0) -> None:
        api = vr.MediamtxApi(self.api_port, self.secret)
        deadline = time.monotonic() + timeout
        reason = ""
        while time.monotonic() < deadline:
            ok, reason = vr.api_state_matches(api, self.expectation())
            if ok:
                return
            time.sleep(0.2)
        pytest.fail(f"MediaMTX no quedó listo: {reason}")

    def log_text(self) -> str:
        return self.supervisor.log.read_text(encoding="utf-8", errors="replace")


@pytest.fixture
def relay(tmp_path: Path) -> Iterator[Relay]:
    etc = tmp_path / "etc"
    etc.mkdir()
    rtsp_port, api_port, dead_port = free_port(), free_port(), free_port()
    write_env(
        etc,
        NVR_HOST="127.0.0.1",
        NVR_PORT=str(dead_port),
        NVR_USER="viewer",
        NVR_PASS=FAKE_NVR_PASS,
        READER_ALLOWED_IPS="127.0.0.1",
        RTSP_PORT=str(rtsp_port),
        API_PORT=str(api_port),
    )
    (etc / vr.CAMERAS_FILE).write_text(f"porton nvr:1\nextra url:rtsp://127.0.0.1:{dead_port}/x\n", encoding="utf-8")
    runtime = vr.Runtime(command=lambda command, timeout: None, owners=lambda: (None, None))
    assert vr.main(["--etc-dir", str(etc), "init"], runtime) == 0
    (etc / vr.READER_HASH_FILE).write_text(vr.hash_password(READER_PASSWORD) + "\n", encoding="utf-8")
    ctx = vr.Context(etc, runtime)
    _, _, config = ctx.build_config()
    vr.atomic_write(etc / vr.CONFIG_FILE, vr.render_config_text(config).encode(), mode=vr.CONFIG_MODE)
    secret = (etc / vr.API_SECRET_FILE).read_text(encoding="utf-8").strip()
    supervisor = Supervisor(etc / vr.CONFIG_FILE, tmp_path / "mediamtx.log")
    relay = Relay(etc, ctx, supervisor, rtsp_port, api_port, secret)
    supervisor.start()
    try:
        relay.wait_ready()
        yield relay
    finally:
        supervisor.stop()
        log = relay.log_text()
        # Ningún secreto en el log, pase lo que pase en el test.
        for secret_value in (FAKE_NVR_PASS, FAKE_NVR_PASS_ENCODED, READER_PASSWORD, secret):
            assert secret_value not in log


def basic(user: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


def test_version_is_v1_15_2() -> None:
    completed = subprocess.run([MEDIAMTX_BIN, "--version"], capture_output=True, text=True, timeout=10, check=False)
    assert completed.stdout.strip() == vr.MEDIAMTX_VERSION


def test_rendered_config_loads_and_api_requires_admin(relay: Relay) -> None:
    assert relay.supervisor.alive()
    assert "configuration loaded" in relay.log_text()
    assert relay.http_status("/v3/config/global/get", vr.ADMIN_USER, relay.secret) == 200
    assert relay.http_status("/v3/config/global/get") == 401
    assert relay.http_status("/v3/config/global/get", vr.ADMIN_USER, "otra-clave-falsa") == 401
    # El lector no tiene permiso de API.
    assert relay.http_status("/v3/config/paths/list", vr.READER_USER, READER_PASSWORD) == 401


def test_api_state_reflects_rendered_config(relay: Relay) -> None:
    ok, reason = vr.api_state_matches(vr.MediamtxApi(relay.api_port, relay.secret), relay.expectation())
    assert ok, reason
    listing = vr.MediamtxApi(relay.api_port, relay.secret).get_json("/v3/paths/list?itemsPerPage=1000")
    names = sorted(item["name"] for item in listing["items"])
    assert names == ["extra", "porton", "porton-hd"]
    # On-demand: nada se está tirando del origen sin lectores.
    assert all(item["ready"] is False and item["readers"] == [] for item in listing["items"])


def test_describe_without_credentials_is_401_basic_only(relay: Relay) -> None:
    response = relay.describe("porton")
    assert response.startswith("RTSP/1.0 401")
    challenges = [line for line in response.splitlines() if line.lower().startswith("www-authenticate")]
    assert challenges and all("Basic" in line for line in challenges)
    assert not any("Digest" in line for line in challenges)


def test_describe_with_wrong_reader_password_is_401(relay: Relay) -> None:
    assert relay.describe("porton", basic(vr.READER_USER, "clave-equivocada-falsa")).startswith("RTSP/1.0 401")
    assert relay.describe("porton", basic(vr.ADMIN_USER, relay.secret)).startswith("RTSP/1.0 401")


def test_apply_config_against_real_hot_reload(relay: Relay) -> None:
    (relay.etc / vr.CAMERAS_FILE).write_text("porton nvr:1\npuerta nvr:2\n", encoding="utf-8")
    _, _, config = relay.ctx.build_config()
    starts = relay.supervisor.starts
    assert vr.apply_config(relay.ctx, config, wait_s=15) == "applied"
    assert relay.supervisor.starts == starts  # recarga en caliente, sin reinicio
    # Segundo apply inmediato: la guarda espera la ventana de 1 s del confwatcher.
    (relay.etc / vr.CAMERAS_FILE).write_text("puerta nvr:2\n", encoding="utf-8")
    _, _, config = relay.ctx.build_config()
    assert vr.apply_config(relay.ctx, config, wait_s=15) == "applied"
    assert vr.apply_config(relay.ctx, config, wait_s=5) == "unchanged"


def test_invalid_config_terminates_the_core(tmp_path: Path, relay: Relay) -> None:
    relay.supervisor.stop()  # sin supervisor para observar la salida
    single = Supervisor(relay.etc / vr.CONFIG_FILE, tmp_path / "single.log")
    single.start(supervise=False)
    try:
        relay.wait_ready()
        time.sleep(vr.RELOAD_GUARD_S)
        vr.atomic_write(relay.etc / vr.CONFIG_FILE, b'{"logLevel": "info", "unknownKey": 1}\n', mode=vr.CONFIG_MODE)
        # v1.15.2 termina con código 0: Restart=on-failure no lo levantaría
        # (por eso la unidad usa Restart=always).
        assert single.wait_exit(10) == 0
    finally:
        single.stop()


def test_rollback_recovers_from_a_config_mediamtx_rejects(relay: Relay) -> None:
    good = (relay.etc / vr.CONFIG_FILE).read_text(encoding="utf-8")
    config: dict[str, Any] = dict(vr.parse_rendered_config(good) or {})
    config["unknownKeyFromABug"] = True  # algo que el validador dejó pasar
    with pytest.raises(vr.ApplyRolledBack):
        vr.apply_config(relay.ctx, config, wait_s=6)
    assert (relay.etc / vr.CONFIG_FILE).read_text(encoding="utf-8") == good
    assert relay.supervisor.exit_codes, "MediaMTX debía terminar con la config inválida"
    relay.wait_ready()
    assert relay.supervisor.alive()


# --- READER_ALLOWED_IPS: MediaMTX devuelve las ips ordenadas como string -------------
def rewrite_env(relay: Relay, **changes: str | None) -> None:
    values = vr.parse_env_text((relay.etc / vr.ENV_FILE).read_text(encoding="utf-8"))
    for key, value in changes.items():
        if value is None:
            values.pop(key, None)
        else:
            values[key] = value
    write_env(relay.etc, **values)


@pytest.mark.parametrize(
    "readers",
    [
        None,  # default fail-closed: solo loopback
        "100.90.1.2, 100.101.102.103, fd7a:115c:a1e0::5",  # orden no alfabético + IPv6
        "fd7a:115c:a1e0::9 100.64.0.1",
    ],
)
def test_apply_with_reader_ips_is_applied_not_rolled_back(relay: Relay, readers: str | None) -> None:
    # Primero otro set, para que el caso siempre sea un cambio real.
    rewrite_env(relay, READER_ALLOWED_IPS="100.100.100.100")
    _, _, config = relay.ctx.build_config()
    assert vr.apply_config(relay.ctx, config, wait_s=15) == "applied"
    rewrite_env(relay, READER_ALLOWED_IPS=readers)
    _, _, config = relay.ctx.build_config()
    assert vr.apply_config(relay.ctx, config, wait_s=15) == "applied"
    # Y un segundo apply igual no ve diferencias contra lo que devuelve la API.
    assert vr.apply_config(relay.ctx, config, wait_s=5) == "unchanged"


# --- url: estricta: lo que MediaMTX rechaza nunca le llega ---------------------------
URL_MARKER = "FakeUrlKey99"
MALFORMED_SOURCES = [
    f"rtsp://u:{URL_MARKER}%zz@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}%4@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}^x@10.0.0.5/x",
    f'rtsp://u:{URL_MARKER}"x@10.0.0.5/x',
    f"rtsp://u:{URL_MARKER}{{x}}@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}|x@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}\\x@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}`x@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}@10.0.0.5:55a4/x",
    f"rtsp://u:{URL_MARKER}@host_name/x",
    f"rtsp://u:{URL_MARKER}@10.0.0.5:99999/x",
    f"rtsp://u:{URL_MARKER}#x@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}@[fd00::1%25eth0]/x",
    # Las tres clases que encontró ciberseguridad (MediaMTX las rechaza con la clave en el log):
    f"RTSP://u:{URL_MARKER}@10.0.0.5/x",
    f"Rtsp://u:{URL_MARKER}@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}@[::ffff:10.0.0.5]/x",
    f"rtsp://u:{URL_MARKER}@[::ffff:a00:5]/x",
    f"rtsp://u:{URL_MARKER}@[v1.x]/x",
]
CYBER_CLASSES = MALFORMED_SOURCES[-5:]


@dataclass
class Verdict:
    accepted: bool
    output: str = field(repr=False)  # trae la clave: el test nunca la imprime
    sources: dict[str, str] = field(default_factory=dict, repr=False)  # las que devolvió la API


def mediamtx_load(work: Path, sources: list[str]) -> Verdict:
    """Arranca MediaMTX con una config que tiene estas `source` (sin validar)."""
    work.mkdir(parents=True)
    api_port, rtsp_port = free_port(), free_port()
    settings = vr.settings_from_env({"READER_ALLOWED_IPS": "127.0.0.1", "RTSP_PORT": str(rtsp_port), "API_PORT": str(api_port)})
    secret = "fake-admin-secret-verdict-0001"
    config = vr.build_mediamtx_config(
        settings,
        [vr.PathSpec(f"p{i}", f"p{i}", "url", source) for i, source in enumerate(sources)],
        reader_hash=vr.hash_password("fake-reader-verdict-0001"),
        admin_hash=vr.hash_password(secret),
    )
    (work / "m.yml").write_text(vr.render_config_text(config), encoding="utf-8")
    process = subprocess.Popen([MEDIAMTX_BIN, str(work / "m.yml")], cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    accepted = False
    loaded: dict[str, str] = {}
    try:
        api = vr.MediamtxApi(api_port, secret)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and process.poll() is None:
            try:
                listing = api.get_json("/v3/config/paths/list?itemsPerPage=1000")
                loaded = {item["name"]: item["source"] for item in listing["items"]}
                accepted = True
                break
            except vr.ApiError:
                time.sleep(0.1)
    finally:
        if process.poll() is None:
            process.terminate()
        output, _ = process.communicate(timeout=10)
    return Verdict(accepted, output.decode("utf-8", errors="replace"), loaded)


def mediamtx_verdict(tmp_path: Path, source: str) -> tuple[bool, str]:
    verdict = mediamtx_load(tmp_path / f"case-{abs(hash(source))}", [source])
    return verdict.accepted, verdict.output


def test_mediamtx_leaks_what_it_rejects_and_we_reject_it_first(tmp_path: Path) -> None:
    rejected_by_mediamtx: list[str] = []
    leaked = False
    for source in MALFORMED_SOURCES:
        with pytest.raises(vr.ConfigError):
            vr.validate_source_url(source)
        accepted, output = mediamtx_verdict(tmp_path, source)
        if not accepted:
            rejected_by_mediamtx.append(source)
            leaked = leaked or URL_MARKER in output
    # El url.Parse de Go rechaza los escapes inválidos y los caracteres fuera
    # del userinfo, e imprime la `source` CON la clave: por eso se validan antes.
    assert f"rtsp://u:{URL_MARKER}%zz@10.0.0.5/x" in rejected_by_mediamtx
    # Y las tres clases de ciberseguridad (esquema no minúsculo, IPv4 incrustada, IPvFuture).
    assert set(CYBER_CLASSES) <= set(rejected_by_mediamtx)
    assert leaked, "se esperaba que MediaMTX citara la source (con la clave) al rechazarla"


# --- fuzz inverso: TODO lo que el validador acepta, MediaMTX lo carga -----------------
FUZZ_SEED = 20261016
FUZZ_COUNT = 400
USER_CHARS = "abcXYZ019._~!&'()*+,;=-"
PATH_CHARS = "abcXYZ019._~:/?[]@!&'()*+,;=-"
FUZZ_HOSTS = [
    "10.0.0.5", "192.168.1.64", "[::1]", "[fd00::5]", "[FD00:0:0:0:0:0:0:5]", "[2001:db8::1]", "[fe80::1]",
    # Las siguientes las debe rechazar el validador (nombres, IPv4 incrustada, IPvFuture, ceros...).
    "[::ffff:10.0.0.5]", "[::ffff:a00:5]", "[64:ff9b::10.0.0.5]", "[v1.a]", "nvr.local", "10.0.0.5.",
    "192.168.001.010", "1.2.3", "0", "4294967295", "x", "[10.0.0.5]",
]
FUZZ_PORTS = ["", ":", ":554", ":0", ":1", ":65535", ":00554", ":0000000554", ":99999"]
HAND_ACCEPTED = [
    f"rtsp://u:{URL_MARKER}@10.0.0.5:/x",
    f"rtsp://u:{URL_MARKER}@10.0.0.5/a[b]",
    f"rtsp://u:{URL_MARKER}@10.0.0.5/a]",
    f"rtsp://u:{URL_MARKER}@10.0.0.5?q=[x]",
    f"rtsp://u:{URL_MARKER}@10.0.0.5:0554/x",
    f"rtsp://:{URL_MARKER}@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}@@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}:x@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}%2F@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}@[fe80::1]/x",
    f"rtsps://u:{URL_MARKER}@10.0.0.5/x",
    f"rtsp://u:{URL_MARKER}@10.0.0.5//x",
    f"rtsp://u:{URL_MARKER}@10.0.0.5/x?",
    f"rtsp://u:{URL_MARKER}@10.0.0.5",
    f"rtsp://u:{URL_MARKER}@10.0.0.5/x'y",
    f"rtsp://u:{URL_MARKER}@10.0.0.5/x;y=(1)*",
    f"rtsp://u:{URL_MARKER}=@10.0.0.5/x",
]


def random_part(rng: random.Random, chars: str, size: int) -> str:
    out = []
    for _ in range(rng.randint(0, size)):
        if rng.random() < 0.15:
            out.append("%" + rng.choice("0123456789abcdefABCDEF") + rng.choice("0123456789abcdefABCDEF"))
        else:
            out.append(rng.choice(chars))
    return "".join(out)


def random_url(rng: random.Random) -> str:
    """Generador de las sondas de ciberseguridad (url_diff.py / url_diff2.py)."""
    scheme = rng.choice(["rtsp", "rtsps", "rtsp", "rtsps", "RTSP", "rTsp"])
    user = random_part(rng, USER_CHARS + ":@", 6)
    password = URL_MARKER + random_part(rng, USER_CHARS + ":@", 4)
    auth = rng.choice([f"{user}:{password}@", f"{password}@", f":{password}@", f"{user}:{password}@@", f"{user}:{password}:x@"])
    path = rng.choice(["", "/", "//", "/a/../b", "/;x"]) + random_part(rng, PATH_CHARS + "%", 12)
    return f"{scheme}://{auth}{rng.choice(FUZZ_HOSTS)}{rng.choice(FUZZ_PORTS)}{path}"


def credentials(url: str) -> tuple[str, str]:
    userinfo = urllib.parse.urlsplit(url).netloc.rpartition("@")[0]
    user, _, password = userinfo.partition(":")
    return urllib.parse.unquote(user), urllib.parse.unquote(password)


def test_fuzz_inverse_everything_the_validator_accepts_loads_in_mediamtx(tmp_path: Path) -> None:
    rng = random.Random(FUZZ_SEED)
    pairs: list[tuple[str, str]] = []
    rejected = 0
    for candidate in HAND_ACCEPTED:
        pairs.append((candidate, vr.validate_source_url(candidate)))
    tries = 0
    while len(pairs) < FUZZ_COUNT + len(HAND_ACCEPTED) and tries < FUZZ_COUNT * 100:
        tries += 1
        candidate = random_url(rng)
        try:
            canonical = vr.validate_source_url(candidate)
        except vr.ConfigError:
            rejected += 1
            continue
        pairs.append((candidate, canonical))
    assert len(pairs) == FUZZ_COUNT + len(HAND_ACCEPTED)
    assert rejected > 0  # el generador también produce URLs inválidas
    for candidate, canonical in pairs:
        # La forma canónica es estable y lleva la misma credencial que vería Go.
        assert vr.validate_source_url(canonical) == canonical
        assert credentials(canonical) == credentials(candidate)
        assert canonical.startswith(("rtsp://", "rtsps://"))
    sources = [canonical for _, canonical in pairs]
    for start in range(0, len(sources), 100):
        batch = sources[start : start + 100]
        verdict = mediamtx_load(tmp_path / f"batch-{start}", batch)
        assert verdict.accepted, f"MediaMTX rechazó un lote que el validador aceptó (lote {start})"
        assert verdict.sources == {f"p{i}": source for i, source in enumerate(batch)}
        assert URL_MARKER not in verdict.output, f"MediaMTX citó una clave al cargar el lote {start}"


def test_malformed_url_never_reaches_mediamtx(relay: Relay) -> None:
    import io

    good = (relay.etc / vr.CONFIG_FILE).read_text(encoding="utf-8")
    stdout, stderr = io.StringIO(), io.StringIO()
    runtime = vr.Runtime(
        stdout=stdout,
        stderr=stderr,
        command=lambda command, timeout: None,
        owners=lambda: (None, None),
        probe_privileges=lambda: vr.NO_PRIVILEGE_DROP,
        unit_dropin_dir=lambda etc: None,
    )
    for source in MALFORMED_SOURCES:
        (relay.etc / vr.CAMERAS_FILE).write_text(f"porton nvr:1\nrota url:{source}\n", encoding="utf-8")
        assert vr.main(["--etc-dir", str(relay.etc), "apply", "--skip-probe"], runtime) == vr.EXIT_ERROR
        assert (relay.etc / vr.CONFIG_FILE).read_text(encoding="utf-8") == good
    assert URL_MARKER not in stdout.getvalue() + stderr.getvalue()
    time.sleep(0.5)
    assert URL_MARKER not in relay.log_text()
