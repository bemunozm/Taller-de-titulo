"""netwatch.sh con stubs de ping/ip/tailscale/systemctl en el PATH (sin red real)."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

KIT_DIR = Path(__file__).resolve().parents[1]
NETWATCH = KIT_DIR / "netwatch.sh"
DAY_1 = 1_790_000_000  # 2026-09-21 (UTC)
DAY_2 = DAY_1 + 24 * 3600
GATEWAY = "192.0.2.1"
FALLBACK = "1.1.1.1"


def find_bash() -> str | None:
    bash = shutil.which("bash")
    if bash is None:
        return None
    # En Windows, System32\bash.exe es WSL (puede no tener distro): solo Git Bash.
    if os.name == "nt" and "system32" in bash.lower():
        return None
    return bash


BASH = find_bash()
pytestmark = pytest.mark.skipif(BASH is None, reason="requiere bash (Linux o Git Bash)")

STUBS = {
    # Responde solo a los destinos listados en FAKE_PING_OK (el último argumento).
    "ping": (
        "#!/usr/bin/env bash\n"
        'target="${!#}"\n'
        "for ok in ${FAKE_PING_OK:-}; do\n"
        '    if [ "$ok" = "$target" ]; then exit 0; fi\n'
        "done\n"
        "exit 1\n"
    ),
    "ip": (
        "#!/usr/bin/env bash\n"
        'if [ "${FAKE_NO_ROUTE:-0}" = 1 ]; then exit 0; fi\n'
        f'echo "default via {GATEWAY} dev eth0 proto dhcp src 192.0.2.50 metric 100"\n'
    ),
    # ExitNodeStatus.Online va SIEMPRE en true: un grep de '"Online": true' lo
    # confundiría con Self.Online (lo que se lee de verdad).
    "tailscale": (
        "#!/usr/bin/env bash\n"
        'if [ "${FAKE_TS_STATE:-Running}" = missing ]; then exit 1; fi\n'
        'if [ "${FAKE_TS_STATE:-Running}" = garbage ]; then echo "{no es json"; exit 0; fi\n'
        "printf '{\\n  \"Version\": \"1.90.0\",\\n  \"BackendState\": \"%s\",\\n"
        "  \"ExitNodeStatus\": {\\n    \"Online\": true\\n  },\\n"
        "  \"Self\": {\\n    \"HostName\": \"vigilia-relay\",\\n    \"Online\": %s\\n  }\\n}\\n' "
        '"${FAKE_TS_STATE:-Running}" "${FAKE_TS_ONLINE:-true}"\n'
    ),
    "systemctl": '#!/usr/bin/env bash\necho "$*" >> "$FAKE_SYSTEMCTL_LOG"\n',
    # SD en solo lectura o llena: mktemp falla. Si no, el mktemp real (el
    # siguiente del PATH: el directorio de stubs va primero).
    "mktemp": (
        "#!/usr/bin/env bash\n"
        'if [ "${FAKE_MKTEMP_FAIL:-0}" = 1 ]; then echo "mktemp: Read-only file system" >&2; exit 1; fi\n'
        'PATH="${PATH#*:}" exec mktemp "$@"\n'
    ),
}


class Netwatch:
    def __init__(self, tmp_path: Path) -> None:
        self.stubs = tmp_path / "stubs"
        self.stubs.mkdir()
        for name, body in STUBS.items():
            path = self.stubs / name
            path.write_text(body, encoding="utf-8", newline="\n")
            path.chmod(0o755)
        self.state_dir = tmp_path / "state"
        self.systemctl_log = tmp_path / "systemctl.log"
        self.systemctl_log.write_text("", encoding="utf-8")

    def run(
        self,
        *,
        now: int,
        gateway: bool = True,
        fallback: bool = True,
        ts_state: str = "Running",
        ts_online: bool = True,
        no_route: bool = False,
        state_dir: Path | None = None,
        mktemp_fails: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        ok_targets = " ".join(t for t, up in ((GATEWAY, gateway), (FALLBACK, fallback)) if up)
        env = dict(os.environ)
        env.update(
            {
                "PATH": str(self.stubs) + os.pathsep + env.get("PATH", ""),
                "STATE_DIRECTORY": (state_dir or self.state_dir).as_posix(),
                "NETWATCH_NOW": str(now),
                "FAKE_PING_OK": ok_targets,
                "FAKE_NO_ROUTE": "1" if no_route else "0",
                "FAKE_TS_STATE": ts_state,
                "FAKE_TS_ONLINE": "true" if ts_online else "false",
                "FAKE_SYSTEMCTL_LOG": self.systemctl_log.as_posix(),
                "FAKE_MKTEMP_FAIL": "1" if mktemp_fails else "0",
                "NETWATCH_PYTHON": Path(sys.executable).as_posix(),
                "TZ": "UTC",
            }
        )
        assert BASH is not None
        return subprocess.run(
            [BASH, NETWATCH.as_posix()],
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )

    def offline(self, now: int, **kwargs: object) -> subprocess.CompletedProcess[str]:
        """Sin red de verdad: Tailscale offline y sin respuesta de nadie."""
        return self.run(now=now, gateway=False, fallback=False, ts_online=False, **kwargs)  # type: ignore[arg-type]

    @property
    def calls(self) -> list[str]:
        return [line for line in self.systemctl_log.read_text(encoding="utf-8").splitlines() if line]

    def state(self) -> dict[str, str]:
        text = (self.state_dir / "netwatch.state").read_text(encoding="utf-8")
        return dict(line.split("=", 1) for line in text.splitlines() if "=" in line)


@pytest.fixture
def netwatch(tmp_path: Path) -> Netwatch:
    return Netwatch(tmp_path)


def test_healthy_does_nothing(netwatch: Netwatch) -> None:
    result = netwatch.run(now=DAY_1)
    assert result.returncode == 0, result.stdout + result.stderr
    assert netwatch.calls == []
    assert netwatch.state()["fail_count"] == "0"


@pytest.mark.parametrize("state", ["Stopped", "NoState", "Starting", "missing"])
def test_tailscale_not_running_restarts_tailscaled(netwatch: Netwatch, state: str) -> None:
    result = netwatch.run(now=DAY_1, ts_state=state, ts_online=False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert netwatch.calls == ["restart tailscaled.service"]


@pytest.mark.parametrize("state", ["NeedsLogin", "NeedsMachineAuth"])
def test_waiting_for_login_does_not_restart(netwatch: Netwatch, state: str) -> None:
    result = netwatch.run(now=DAY_1, ts_state=state, ts_online=False)
    assert result.returncode == 0
    assert netwatch.calls == []
    assert "tailscale up" in result.stdout


def test_exit_node_online_is_not_self_online(netwatch: Netwatch) -> None:
    # Self.Online=false (y ExitNodeStatus.Online=true en el stub) + sin ping: sin red.
    for minute in (0, 3, 6):
        netwatch.run(now=DAY_1 + minute * 60, gateway=False, fallback=False, ts_online=False)
    assert netwatch.state()["fail_count"] == "3"
    assert netwatch.calls == ["restart tailscaled.service"]


def test_unparseable_tailscale_json_counts_as_unknown(netwatch: Netwatch) -> None:
    result = netwatch.run(now=DAY_1, ts_state="garbage")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Tailscale en estado unknown" in result.stdout
    assert netwatch.calls == ["restart tailscaled.service"]


def test_tailscale_online_with_icmp_filtered_is_healthy(netwatch: Netwatch) -> None:
    # Router que descarta ping y sin Internet por ICMP, pero Tailscale online.
    for minute in range(0, 60, 3):
        result = netwatch.run(now=DAY_1 + minute * 60, gateway=False, fallback=False, ts_online=True)
        assert result.returncode == 0, result.stdout + result.stderr
    assert netwatch.calls == []
    assert netwatch.state()["fail_count"] == "0"


def test_mute_gateway_with_fallback_ok_is_healthy(netwatch: Netwatch) -> None:
    for minute in (0, 3, 6, 9):
        netwatch.run(now=DAY_1 + minute * 60, gateway=False, fallback=True, ts_online=False)
    assert netwatch.calls == []
    assert netwatch.state()["offline_since"] == "0"


def test_no_default_route_counts_as_offline(netwatch: Netwatch) -> None:
    # Cable desconectado: sin ruta por defecto (el ping al respaldo ni se intenta).
    for minute in (0, 3, 6):
        netwatch.run(now=DAY_1 + minute * 60, fallback=True, ts_online=False, no_route=True)
    assert netwatch.calls == ["restart tailscaled.service"]
    assert netwatch.state()["fail_count"] == "3"


def test_three_consecutive_network_failures_restart_tailscaled(netwatch: Netwatch) -> None:
    for minute in (0, 3):
        assert netwatch.offline(DAY_1 + minute * 60).returncode == 0
    assert netwatch.calls == []
    assert netwatch.offline(DAY_1 + 6 * 60).returncode == 0
    assert netwatch.calls == ["restart tailscaled.service"]
    # Vuelve la red: el contador se reinicia.
    assert netwatch.run(now=DAY_1 + 9 * 60).returncode == 0
    assert netwatch.state()["fail_count"] == "0"
    assert netwatch.state()["offline_since"] == "0"


def test_reboots_after_30_minutes_offline_with_daily_limit(netwatch: Netwatch) -> None:
    reboots = 0
    for step in range(0, 17):  # cada 3 min, hasta 48 min
        netwatch.offline(DAY_1 + step * 3 * 60)
        reboots = netwatch.calls.count("reboot")
        if reboots and step * 3 <= 30:
            pytest.fail(f"reinició a los {step * 3} min (debe ser con MÁS de 30)")
    # El boot_id no cambia en el test: tras el primer reinicio "fallido" sigue
    # sin red, así que llega al tope diario y no reinicia más.
    assert reboots == 3
    assert netwatch.state()["reboot_count"] == "3"
    assert netwatch.calls.index("reboot") > 0  # antes hubo reinicios de tailscaled
    # Al día siguiente el contador vuelve a cero.
    netwatch.offline(DAY_2 + 12 * 3600)
    assert netwatch.calls.count("reboot") == 4
    assert netwatch.state()["reboot_count"] == "1"


def test_daily_limit_survives_reboots(netwatch: Netwatch) -> None:
    # Ya se usaron los 3 reinicios de hoy en arranques anteriores (otro boot_id).
    netwatch.state_dir.mkdir()
    (netwatch.state_dir / "netwatch.state").write_text(
        "fail_count=0\noffline_since=0\nreboot_day=2026-09-21\nreboot_count=3\nboot_id=arranque-anterior-0000\n",
        encoding="utf-8",
        newline="\n",
    )
    for minute in range(0, 46, 3):
        netwatch.offline(DAY_1 + minute * 60)
    assert "reboot" not in netwatch.calls
    assert netwatch.state()["reboot_count"] == "3"
    assert int(netwatch.state()["offline_since"]) == DAY_1


def test_state_file_with_crlf_is_understood(netwatch: Netwatch) -> None:
    netwatch.state_dir.mkdir()
    (netwatch.state_dir / "netwatch.state").write_bytes(
        b"fail_count=0\r\noffline_since=0\r\nreboot_day=2026-09-21\r\nreboot_count=3\r\nboot_id=x\r\n"
    )
    netwatch.run(now=DAY_1)
    assert netwatch.state()["reboot_count"] == "3"


def test_new_boot_resets_offline_timer(netwatch: Netwatch) -> None:
    netwatch.state_dir.mkdir()
    (netwatch.state_dir / "netwatch.state").write_text(
        f"fail_count=9\noffline_since={DAY_1}\nreboot_day=2026-09-21\nreboot_count=1\nboot_id=otro-arranque-0000\n",
        encoding="utf-8",
        newline="\n",
    )
    result = netwatch.offline(DAY_1 + 3 * 3600)
    assert result.returncode == 0
    assert "reboot" not in netwatch.calls
    assert netwatch.state()["fail_count"] == "1"
    assert netwatch.state()["offline_since"] == str(DAY_1 + 3 * 3600)


def test_sd_readonly_still_reboots_without_daily_limit(netwatch: Netwatch) -> None:
    # La primera corrida guarda offline_since (con el boot_id que ve el script).
    netwatch.offline(DAY_1)
    assert netwatch.state()["offline_since"] == str(DAY_1)
    # La SD queda en solo lectura: mktemp falla (stub), igual que con EROFS/ENOSPC.
    result = netwatch.offline(DAY_1 + 3600, mktemp_fails=True)
    assert "reboot" in netwatch.calls, result.stdout
    assert "se reinicia igual, sin tope diario" in result.stdout
    # Sin estado guardado no se informa un "N de M hoy" que no rige.
    assert "de 3 hoy" not in result.stdout
    assert "reiniciando la Pi (sin tope diario: el contador no se pudo guardar)" in result.stdout


def test_sd_readonly_without_reboot_fails_loudly(netwatch: Netwatch) -> None:
    result = netwatch.run(now=DAY_1, mktemp_fails=True)
    assert result.returncode == 1  # el servicio queda en failed: se ve en systemctl
    assert "no se pudo guardar el estado" in result.stdout
    assert netwatch.calls == []


def test_unwritable_state_directory(netwatch: Netwatch, tmp_path: Path) -> None:
    # STATE_DIRECTORY no se puede crear ni escribir (su "padre" es un archivo;
    # vale también para root): no aborta antes de chequear la red.
    blocker = tmp_path / "sd-rota"
    blocker.write_text("", encoding="utf-8")
    result = netwatch.run(now=DAY_1, ts_state="Stopped", ts_online=False, state_dir=blocker / "state")
    assert result.returncode == 1
    assert "no se pudo guardar el estado" in result.stdout
    assert netwatch.calls == ["restart tailscaled.service"]


def test_state_file_is_parsed_not_executed(netwatch: Netwatch, tmp_path: Path) -> None:
    marker = tmp_path / "pwned"
    netwatch.state_dir.mkdir()
    (netwatch.state_dir / "netwatch.state").write_text(
        f"fail_count=$(touch {marker.as_posix()})\noffline_since=`touch {marker.as_posix()}`\n"
        "reboot_count=; reboot\nreboot_day=../../etc\nbasura sin igual\n",
        encoding="utf-8",
        newline="\n",
    )
    result = netwatch.run(now=DAY_1)
    assert result.returncode == 0, result.stdout + result.stderr
    assert not marker.exists()
    assert netwatch.calls == []
    state = netwatch.state()
    assert state["fail_count"] == "0" and state["reboot_count"] == "0" and state["reboot_day"] == "2026-09-21"


def test_invalid_settings_abort(netwatch: Netwatch) -> None:
    result = subprocess.run(
        [str(BASH), NETWATCH.as_posix()],
        env={**os.environ, "NETWATCH_NOW": "no-es-un-numero", "STATE_DIRECTORY": netwatch.state_dir.as_posix()},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
        check=False,
    )
    assert result.returncode == 2
    assert "configuración inválida" in result.stdout
