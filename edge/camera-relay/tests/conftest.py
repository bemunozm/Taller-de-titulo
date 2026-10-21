"""Fixtures compartidas de los tests del kit del relay.

Todas las credenciales de estos tests son FALSAS. Las del NVR llevan a
propósito los caracteres problemáticos (`@:/#%$`) para cubrir el encoding.
"""

from __future__ import annotations

import io
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

KIT_DIR = Path(__file__).resolve().parents[1]
if str(KIT_DIR) not in sys.path:
    sys.path.insert(0, str(KIT_DIR))

import vigilia_relay as vr  # noqa: E402

FAKE_NVR_USER = "viewer"
FAKE_NVR_PASS = "Fake@:/#%$G1-pass"
FAKE_NVR_PASS_ENCODED = "Fake%40%3A%2F%23%25%24G1-pass"


@dataclass
class FakeClock:
    now: float = 0.0
    sleeps: list[float] = field(default_factory=list)

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds

    def wall_time(self) -> float:
        # Muy en el pasado: wait_reload_window ve una edad negativa y no espera.
        return 1_000.0 + self.now


@dataclass
class Harness:
    etc: Path
    runtime: vr.Runtime
    clock: FakeClock
    stdout: io.StringIO
    stderr: io.StringIO
    commands: list[list[str]]

    def run(self, *args: str) -> int:
        return vr.main(["--etc-dir", str(self.etc), *args], self.runtime)

    @property
    def output(self) -> str:
        return self.stdout.getvalue() + self.stderr.getvalue()

    def context(self) -> vr.Context:
        return vr.Context(self.etc, self.runtime)


def write_env(etc: Path, **values: str) -> None:
    lines = [f"{key}={vr.format_env_value(value)}" for key, value in values.items()]
    (etc / vr.ENV_FILE).write_text("\n".join(lines) + "\n", encoding="utf-8")


def nvr_env(**extra: str) -> dict[str, str]:
    values = {
        "NVR_HOST": "192.0.2.10",
        "NVR_USER": FAKE_NVR_USER,
        "NVR_PASS": FAKE_NVR_PASS,
        "READER_ALLOWED_IPS": "100.101.102.103",
    }
    values.update(extra)
    return values


NVR_MAC = "02:1a:2b:3c:4d:5e"  # MAC de ejemplo (administrada localmente), no la del NVR real


@dataclass
class FakeNet:
    """Red falsa para follow-nvr y el aprendizaje de la MAC: TCP abierto en
    `open` (ip, puerto), tabla de vecinos antes y después del barrido."""

    open: set[tuple[str, int]] = field(default_factory=set)
    neigh: list[vr.Neighbor] = field(default_factory=list)
    after_sweep: list[vr.Neighbor] | None = None
    interface: str | None = "192.0.2.50/24"
    iface: str = "eth0"
    swept: list[list[str]] = field(default_factory=list)
    tcp_calls: list[tuple[str, int]] = field(default_factory=list)

    def tcp_ok(self, host: str, port: int, timeout: float) -> bool:
        self.tcp_calls.append((host, port))
        return (host, port) in self.open

    def neighbors(self) -> list[vr.Neighbor]:
        if self.swept and self.after_sweep is not None:
            return list(self.after_sweep)
        return list(self.neigh)

    def local_interface(self) -> tuple[str, Any]:
        return self.iface, vr.ipaddress.IPv4Interface(self.interface) if self.interface else None

    def sweep(self, targets: list[str]) -> None:
        self.swept.append(list(targets))


def reachable(ip: str, mac: str = NVR_MAC) -> vr.Neighbor:
    return vr.Neighbor(ip, mac, ("REACHABLE",))


@pytest.fixture
def etc(tmp_path: Path) -> Path:
    directory = tmp_path / "etc"
    directory.mkdir()
    return directory


@pytest.fixture
def harness(etc: Path) -> Harness:
    clock = FakeClock()
    stdout, stderr = io.StringIO(), io.StringIO()
    commands: list[list[str]] = []

    def no_command(command: Any, timeout: float) -> None:
        # Sin systemctl/tailscale/vcgencmd en los tests (aunque el runner de
        # CI tenga systemctl).
        commands.append(list(command))
        return None

    def no_ffprobe(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("este test no debía correr ffprobe")

    runtime = vr.Runtime(
        stdout=stdout,
        stderr=stderr,
        stdin_isatty=lambda: True,
        stdout_isatty=lambda: True,
        read_input=lambda prompt: (_ for _ in ()).throw(AssertionError("input inesperado")),
        read_secret=lambda prompt: (_ for _ in ()).throw(AssertionError("getpass inesperado")),
        runner=no_ffprobe,
        command=no_command,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
        wall_time=clock.wall_time,
        owners=lambda: (None, None),
        is_root=lambda: True,
        probe_privileges=lambda: vr.NO_PRIVILEGE_DROP,
        unit_dropin_dir=lambda etc: None,
        state_dir=lambda etc: etc.parent / "state",
        net=FakeNet(),
        ffprobe="ffprobe-fake",
    )
    return Harness(etc, runtime, clock, stdout, stderr, commands)
