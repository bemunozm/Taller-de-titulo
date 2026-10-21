"""apply (escritura atómica + rollback) y los comandos que escriben /etc/vigilia-relay."""

from __future__ import annotations

import os
import stat
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from conftest import FAKE_NVR_PASS, FAKE_NVR_PASS_ENCODED, NVR_MAC, FakeNet, Harness, nvr_env, reachable, write_env
from test_probe import FakeFfprobe, not_found, ok, unauthorized
import vigilia_relay as vr

POSIX = os.name == "posix"


class FakeMediamtx:
    """Simula MediaMTX: la API refleja el archivo de config, salvo que lo
    "rechace" (en ese caso se comporta como un proceso caído, igual que el
    binario real, que termina ante una config inválida)."""

    def __init__(self, etc: Path, rejects: Callable[[dict[str, Any]], bool] = lambda config: False) -> None:
        self.etc = etc
        self.rejects = rejects
        self.down = False
        self.frozen: dict[str, Any] | None = None
        self.ports: list[int] = []

    def factory(self, port: int, secret: str) -> FakeApi:
        self.ports.append(port)
        return FakeApi(self, port, secret)

    def freeze(self) -> None:
        """Deja de ver cambios del archivo (como un cambio que el watcher perdió)."""
        self.frozen = self.active()

    def active(self) -> dict[str, Any] | None:
        if self.down:
            return None
        if self.frozen is not None:
            return self.frozen
        text = vr.read_text_if_exists(self.etc / vr.CONFIG_FILE)
        config = vr.parse_rendered_config(text) if text else None
        if config is None or self.rejects(config):
            return None
        return config


class FakeApi:
    def __init__(self, server: FakeMediamtx, port: int, secret: str) -> None:
        self.server, self.port, self.secret = server, port, secret

    def get_json(self, path: str) -> Any:
        config = self.server.active()
        if config is None or config["apiAddress"] != f"127.0.0.1:{self.port}":
            raise vr.ApiUnavailable("la API de MediaMTX no responde")
        admin = next(user for user in config["authInternalUsers"] if user["user"] == vr.ADMIN_USER)
        if admin["pass"] != vr.hash_password(self.secret):
            raise vr.ApiAuthError("la API rechazó a vigilia-admin (401)")
        if path.startswith("/v3/config/global/get"):
            view = {key: value for key, value in config.items() if key not in ("paths", "pathDefaults")}
            # Como MediaMTX v1.15.2 (verificado): ips canónicas y ordenadas como string.
            view["authInternalUsers"] = [
                dict(user, ips=sorted(str(vr.ipaddress.ip_network(ip, strict=False)) for ip in user["ips"]))
                for user in config["authInternalUsers"]
            ]
            return view
        if path.startswith("/v3/config/pathdefaults/get"):
            return dict(config["pathDefaults"])
        if path.startswith("/v3/config/paths/list"):
            items = [{"name": name, "source": spec["source"]} for name, spec in config["paths"].items()]
            return {"itemCount": len(items), "pageCount": 1, "items": items}
        if path.startswith("/v3/paths/list"):
            return {"items": [{"name": name, "ready": name == "porton", "readers": [{"type": "rtspSession"}] if name == "porton" else []} for name in config["paths"]]}
        raise vr.ApiError("HTTP 404")


def prepare(harness: Harness, cameras: str = "porton nvr:1\n", **env: str) -> FakeMediamtx:
    write_env(harness.etc, **nvr_env(**env))
    (harness.etc / vr.CAMERAS_FILE).write_text(cameras, encoding="utf-8")
    assert harness.run("init") == 0
    server = FakeMediamtx(harness.etc)
    harness.runtime.api_factory = server.factory
    harness.runtime.runner = FakeFfprobe({}, default=ok)
    for stream in (harness.stdout, harness.stderr):
        stream.seek(0)
        stream.truncate(0)
    return server


def config_text(harness: Harness) -> str:
    return (harness.etc / vr.CONFIG_FILE).read_text(encoding="utf-8")


def assert_no_secret(text: str) -> None:
    assert FAKE_NVR_PASS not in text
    assert FAKE_NVR_PASS_ENCODED not in text


# --- escritura atómica -------------------------------------------------------------
def test_atomic_write_content_mode_and_no_temp_left(tmp_path: Path) -> None:
    target = tmp_path / "mediamtx.yml"
    target.write_text("vieja", encoding="utf-8")
    vr.atomic_write(target, b"nueva", mode=0o640)
    assert target.read_bytes() == b"nueva"
    assert [p.name for p in tmp_path.iterdir()] == ["mediamtx.yml"]
    if POSIX:
        assert stat.S_IMODE(target.stat().st_mode) == 0o640
        vr.atomic_write(target, b"x", mode=0o600)
        assert stat.S_IMODE(target.stat().st_mode) == 0o600


def test_atomic_write_failure_keeps_old_file_and_cleans_temp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = tmp_path / "mediamtx.yml"
    target.write_text("vieja", encoding="utf-8")

    def broken_replace(src: Any, dst: Any) -> None:
        raise OSError("disco lleno (simulado)")

    monkeypatch.setattr(vr.os, "replace", broken_replace)
    with pytest.raises(OSError):
        vr.atomic_write(target, b"nueva", mode=0o640)
    assert target.read_text(encoding="utf-8") == "vieja"
    assert [p.name for p in tmp_path.iterdir()] == ["mediamtx.yml"]


@pytest.mark.skipif(not hasattr(os, "fchown"), reason="fchown solo existe en POSIX")
def test_atomic_write_sets_owner_before_rename(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[int, int, int]] = []
    monkeypatch.setattr(vr.os, "fchown", lambda fd, uid, gid: calls.append((fd, uid, gid)))
    vr.atomic_write(tmp_path / "x", b"data", mode=0o640, owner=(0, 4242))
    assert len(calls) == 1 and calls[0][1:] == (0, 4242)


# --- init ------------------------------------------------------------------------
def test_init_creates_secrets_and_config_and_is_idempotent(harness: Harness) -> None:
    write_env(harness.etc, **nvr_env())
    assert harness.run("init") == 0
    secret = (harness.etc / vr.API_SECRET_FILE).read_text(encoding="utf-8").strip()
    assert len(secret) >= 40
    assert vr.HASH_PATTERN.fullmatch((harness.etc / vr.READER_HASH_FILE).read_text(encoding="utf-8").strip())
    config = vr.parse_rendered_config(config_text(harness))
    assert config is not None and list(config["paths"])[:2] == ["cam01", "cam01-hd"]
    admin = next(u for u in config["authInternalUsers"] if u["user"] == vr.ADMIN_USER)
    assert admin["pass"] == vr.hash_password(secret)
    if POSIX:
        assert stat.S_IMODE((harness.etc / vr.API_SECRET_FILE).stat().st_mode) == 0o600
        assert stat.S_IMODE((harness.etc / vr.READER_HASH_FILE).stat().st_mode) == 0o600
        assert stat.S_IMODE((harness.etc / vr.CONFIG_FILE).stat().st_mode) == 0o640

    before = {p.name: p.read_bytes() for p in harness.etc.iterdir()}
    assert harness.run("init") == 0
    assert {p.name: p.read_bytes() for p in harness.etc.iterdir()} == before
    assert "sin cambios" in harness.output
    assert secret not in harness.output
    assert_no_secret(harness.output)


# --- apply -----------------------------------------------------------------------
def test_apply_success_keeps_prev_and_verifies_api(harness: Harness) -> None:
    server = prepare(harness)
    old = config_text(harness)
    (harness.etc / vr.CAMERAS_FILE).write_text("porton nvr:1\npuerta nvr:2\n", encoding="utf-8")
    assert harness.run("apply") == 0
    new = vr.parse_rendered_config(config_text(harness))
    assert new is not None and "puerta" in new["paths"]
    assert (harness.etc / (vr.CONFIG_FILE + vr.PREV_SUFFIX)).read_text(encoding="utf-8") == old
    assert server.ports and set(server.ports) == {9997}
    assert "config activa con 4 paths" in harness.output
    assert harness.runtime.runner.channels == ["102"]  # probe hasta el primer OK
    assert_no_secret(harness.output)


def test_apply_unchanged_does_not_touch_prev(harness: Harness) -> None:
    prepare(harness)
    assert harness.run("apply") == 0
    assert "sin cambios" in harness.output
    assert not (harness.etc / (vr.CONFIG_FILE + vr.PREV_SUFFIX)).exists()


def test_apply_rolls_back_when_mediamtx_rejects_the_new_config(harness: Harness) -> None:
    server = prepare(harness)
    server.rejects = lambda config: "puerta" in config["paths"]
    old = config_text(harness)
    (harness.etc / vr.CAMERAS_FILE).write_text("porton nvr:1\npuerta nvr:2\n", encoding="utf-8")
    assert harness.run("apply") == vr.EXIT_ROLLED_BACK
    assert config_text(harness) == old  # restaurada byte a byte
    assert ["systemctl", "restart", vr.SERVICE_UNIT] in harness.commands
    assert "se restauró la anterior" in harness.output
    # Esperó el plazo completo antes de revertir (reloj falso, sin dormir de verdad).
    assert sum(harness.clock.sleeps) >= vr.APPLY_WAIT_S
    assert_no_secret(harness.output)


def test_apply_rollback_failed_when_relay_never_answers(harness: Harness) -> None:
    server = prepare(harness)
    server.down = True
    (harness.etc / vr.CAMERAS_FILE).write_text("porton nvr:1\npuerta nvr:2\n", encoding="utf-8")
    assert harness.run("apply") == vr.EXIT_ROLLBACK_FAILED
    assert "journalctl" in harness.output


def test_apply_reports_api_401_when_api_secret_is_out_of_sync(harness: Harness) -> None:
    # MediaMTX sigue con la config vieja (admin con el hash del secreto viejo)
    # y api.secret cambió: la API responde 401 a todo.
    server = prepare(harness)
    server.freeze()
    (harness.etc / vr.API_SECRET_FILE).write_text("otro-secreto-falso-0123456789\n", encoding="utf-8")
    assert harness.run("apply") == vr.EXIT_ROLLBACK_FAILED
    assert "401" in harness.output
    assert "otro-secreto-falso" not in harness.output


def test_apply_rolls_back_when_mediamtx_misses_the_change(harness: Harness) -> None:
    server = prepare(harness)
    old = config_text(harness)
    server.freeze()
    (harness.etc / vr.CAMERAS_FILE).write_text("puerta nvr:2\n", encoding="utf-8")
    assert harness.run("apply") == vr.EXIT_ROLLED_BACK
    assert config_text(harness) == old


def test_apply_requires_a_probe_ok(harness: Harness) -> None:
    prepare(harness)
    old = config_text(harness)
    harness.runtime.runner = FakeFfprobe({}, default=unauthorized)
    (harness.etc / vr.CAMERAS_FILE).write_text("porton nvr:1\npuerta nvr:2\n", encoding="utf-8")
    assert harness.run("apply") == vr.EXIT_PROBE_FAILED
    assert config_text(harness) == old
    assert not (harness.etc / (vr.CONFIG_FILE + vr.PREV_SUFFIX)).exists()
    assert harness.runtime.runner.channels == ["102"]  # cortó en el primer 401
    assert_no_secret(harness.output)


def test_apply_skip_probe(harness: Harness) -> None:
    prepare(harness)
    harness.runtime.runner = FakeFfprobe({})  # cualquier llamada falla el test
    (harness.etc / vr.CAMERAS_FILE).write_text("puerta nvr:2\n", encoding="utf-8")
    assert harness.run("apply", "--skip-probe") == 0
    assert "--skip-probe" in harness.output


def test_apply_invalid_cameras_conf_writes_nothing(harness: Harness) -> None:
    prepare(harness)
    old = config_text(harness)
    (harness.etc / vr.CAMERAS_FILE).write_text("Porton nvr:1\n", encoding="utf-8")
    assert harness.run("apply") == 1
    assert config_text(harness) == old


def test_apply_aborts_when_service_is_stopped(harness: Harness) -> None:
    prepare(harness)
    harness.runtime.command = lambda command, timeout: subprocess.CompletedProcess(command, 3, "inactive\n", "")
    (harness.etc / vr.CAMERAS_FILE).write_text("puerta nvr:2\n", encoding="utf-8")
    assert harness.run("apply") == 1
    assert "detenido" in harness.output


def test_apply_waits_for_the_mediamtx_reload_window(harness: Harness) -> None:
    prepare(harness)
    mtime = (harness.etc / vr.CONFIG_FILE).stat().st_mtime
    harness.runtime.wall_time = lambda: mtime + 0.4
    (harness.etc / vr.CAMERAS_FILE).write_text("puerta nvr:2\n", encoding="utf-8")
    assert harness.run("apply") == 0
    assert any(abs(seconds - (vr.RELOAD_GUARD_S - 0.4)) < 1e-6 for seconds in harness.clock.sleeps)


def test_apply_warns_when_reader_ips_are_defaulted(harness: Harness) -> None:
    prepare(harness, READER_ALLOWED_IPS="")
    assert harness.run("apply") == 0  # la config es segura: sale con 0
    assert "AVISO (lectores solo por loopback): READER_ALLOWED_IPS no está definido" in harness.output
    assert "ERROR:" not in harness.output


# --- rotate-password -------------------------------------------------------------------
def _revealed_password(output: str) -> str:
    lines = output.splitlines()
    index = next(i for i, line in enumerate(lines) if "UNA sola vez" in line)
    return lines[index + 1].strip()


def test_rotate_password_applies_then_persists_and_shows_once(harness: Harness) -> None:
    server = prepare(harness)
    assert harness.run("rotate-password") == 0
    password = _revealed_password(harness.stdout.getvalue())
    assert len(password) >= 24 and harness.stdout.getvalue().count(password) == 1
    assert (harness.etc / vr.READER_HASH_FILE).read_text(encoding="utf-8").strip() == vr.hash_password(password)
    active = server.active()
    assert active is not None
    reader = next(u for u in active["authInternalUsers"] if u["user"] == vr.READER_USER)
    assert reader["pass"] == vr.hash_password(password)


def test_rotate_password_to_file(harness: Harness, tmp_path: Path) -> None:
    prepare(harness)
    out = tmp_path / "reader.txt"
    assert harness.run("rotate-password", "--out", str(out)) == 0
    password = out.read_text(encoding="utf-8").strip()
    assert password not in harness.output
    assert (harness.etc / vr.READER_HASH_FILE).read_text(encoding="utf-8").strip() == vr.hash_password(password)
    if POSIX:
        assert stat.S_IMODE(out.stat().st_mode) == 0o600


def test_rotate_password_keeps_old_hash_when_apply_fails(harness: Harness, tmp_path: Path) -> None:
    server = prepare(harness)
    old_hash = (harness.etc / vr.READER_HASH_FILE).read_text(encoding="utf-8")
    server.rejects = lambda config: next(u for u in config["authInternalUsers"] if u["user"] == vr.READER_USER)["pass"] != old_hash.strip()
    out = tmp_path / "reader.txt"
    assert harness.run("rotate-password", "--out", str(out)) == vr.EXIT_ROLLED_BACK
    assert (harness.etc / vr.READER_HASH_FILE).read_text(encoding="utf-8") == old_hash
    assert not out.exists()


def test_rotate_password_refuses_without_tty_or_out(harness: Harness) -> None:
    prepare(harness)
    old_hash = (harness.etc / vr.READER_HASH_FILE).read_text(encoding="utf-8")
    harness.runtime.stdout_isatty = lambda: False
    assert harness.run("rotate-password") == 1
    assert "--out" in harness.output
    assert (harness.etc / vr.READER_HASH_FILE).read_text(encoding="utf-8") == old_hash


def test_rotate_password_no_apply_only_updates_hash(harness: Harness, tmp_path: Path) -> None:
    prepare(harness)
    old_config = config_text(harness)
    out = tmp_path / "reader.txt"
    assert harness.run("rotate-password", "--no-apply", "--out", str(out)) == 0
    assert config_text(harness) == old_config
    password = out.read_text(encoding="utf-8").strip()
    assert (harness.etc / vr.READER_HASH_FILE).read_text(encoding="utf-8").strip() == vr.hash_password(password)


# --- set-nvr -----------------------------------------------------------------------
def scripted(answers: list[str]) -> Callable[[str], str]:
    queue = list(answers)

    def answer(prompt: str) -> str:
        return queue.pop(0)

    return answer


def test_set_nvr_writes_relay_env_preserving_other_lines(harness: Harness) -> None:
    (harness.etc / vr.ENV_FILE).write_text("# mi comentario\nREADER_ALLOWED_IPS=100.101.102.103\n", encoding="utf-8")
    harness.runtime.read_input = scripted(["192.0.2.20", "", "viewer"])
    harness.runtime.read_secret = scripted([FAKE_NVR_PASS, FAKE_NVR_PASS])
    runner = FakeFfprobe({}, default=ok)
    harness.runtime.runner = runner
    harness.runtime.net = FakeNet(neigh=[reachable("192.0.2.20")])
    assert harness.run("set-nvr") == 0
    text = (harness.etc / vr.ENV_FILE).read_text(encoding="utf-8")
    assert text.startswith("# mi comentario\nREADER_ALLOWED_IPS=100.101.102.103\n")
    values = vr.parse_env_text(text)
    assert values["NVR_HOST"] == "192.0.2.20"
    assert values["NVR_PORT"] == "554"
    assert values["NVR_PASS"] == FAKE_NVR_PASS
    # Probe OK del canal 1 (un solo intento) -> aprende la MAC.
    assert runner.channels == ["102"]
    assert values["NVR_MAC"] == NVR_MAC
    assert "NVR_MAC aprendida" in harness.output
    assert_no_secret(harness.output)
    if POSIX:
        assert stat.S_IMODE((harness.etc / vr.ENV_FILE).stat().st_mode) == 0o600


def test_set_nvr_keeps_current_password_on_enter(harness: Harness) -> None:
    write_env(harness.etc, **nvr_env())
    harness.runtime.read_input = scripted(["", "", ""])
    harness.runtime.read_secret = scripted([""])
    harness.runtime.runner = FakeFfprobe({}, default=ok)
    assert harness.run("set-nvr") == 0
    assert vr.parse_env_text((harness.etc / vr.ENV_FILE).read_text(encoding="utf-8"))["NVR_PASS"] == FAKE_NVR_PASS
    # Sin la MAC en la tabla de vecinos: avisa y la deja para el próximo apply.
    assert "se aprenderá en el próximo apply" in harness.output


def test_set_nvr_new_host_forgets_old_mac_and_relearns(harness: Harness) -> None:
    write_env(harness.etc, **nvr_env(NVR_MAC="02:00:00:00:00:01"))
    harness.runtime.read_input = scripted(["192.0.2.21", "", ""])
    harness.runtime.read_secret = scripted([""])
    harness.runtime.runner = FakeFfprobe({}, default=ok)
    harness.runtime.net = FakeNet(neigh=[reachable("192.0.2.21")])
    assert harness.run("set-nvr") == 0
    assert vr.parse_env_text((harness.etc / vr.ENV_FILE).read_text(encoding="utf-8"))["NVR_MAC"] == NVR_MAC


def test_set_nvr_with_rejected_credentials_saves_and_warns(harness: Harness) -> None:
    write_env(harness.etc, **nvr_env())
    harness.runtime.read_input = scripted(["", "", ""])
    harness.runtime.read_secret = scripted([""])
    runner = FakeFfprobe({}, default=unauthorized)
    harness.runtime.runner = runner
    harness.runtime.net = FakeNet(neigh=[reachable("192.0.2.10")])
    assert harness.run("set-nvr") == 0
    assert runner.channels == ["102"]  # un solo intento
    assert "rechazó las credenciales" in harness.output
    assert "NVR_MAC" not in vr.parse_env_text((harness.etc / vr.ENV_FILE).read_text(encoding="utf-8"))
    assert_no_secret(harness.output)


def test_apply_learns_nvr_mac_when_the_probe_answers(harness: Harness) -> None:
    prepare(harness)
    harness.runtime.net = FakeNet(neigh=[reachable("192.0.2.10"), vr.Neighbor("192.0.2.99", None, ("FAILED",))])
    assert harness.run("apply") == 0
    assert vr.parse_env_text((harness.etc / vr.ENV_FILE).read_text(encoding="utf-8"))["NVR_MAC"] == NVR_MAC
    # Ya aprendida: un segundo apply no la reescribe.
    harness.runtime.net = FakeNet(neigh=[reachable("192.0.2.10", "02:00:00:00:00:09")])
    assert harness.run("apply") == 0
    assert vr.parse_env_text((harness.etc / vr.ENV_FILE).read_text(encoding="utf-8"))["NVR_MAC"] == NVR_MAC


def test_apply_skip_probe_does_not_learn_mac(harness: Harness) -> None:
    prepare(harness)
    harness.runtime.net = FakeNet(neigh=[reachable("192.0.2.10")])
    assert harness.run("apply", "--skip-probe") == 0
    assert "NVR_MAC" not in vr.parse_env_text((harness.etc / vr.ENV_FILE).read_text(encoding="utf-8"))


OLD_MAC = "02:00:00:00:00:01"  # la del NVR anterior (reemplazado en la misma IP)


def env_mac(harness: Harness) -> str | None:
    return vr.parse_env_text((harness.etc / vr.ENV_FILE).read_text(encoding="utf-8")).get("NVR_MAC")


def test_apply_relearn_mac_updates_a_replaced_nvr(harness: Harness) -> None:
    prepare(harness, NVR_MAC=OLD_MAC)
    harness.runtime.net = FakeNet(neigh=[reachable("192.0.2.10")])
    assert harness.run("apply") == 0
    assert env_mac(harness) == OLD_MAC  # sin --relearn-mac no se toca una MAC ya fijada
    runner = FakeFfprobe({}, default=ok)
    harness.runtime.runner = runner
    assert harness.run("apply", "--relearn-mac") == 0
    assert env_mac(harness) == NVR_MAC
    assert f"NVR_MAC cambió de {OLD_MAC} a {NVR_MAC}" in harness.output
    assert runner.channels  # hubo probe con credenciales
    assert_no_secret(harness.output)
    assert harness.run("apply", "--relearn-mac") == 0
    assert "NVR_MAC confirmada" in harness.output


def test_apply_relearn_mac_needs_a_successful_nvr_probe(harness: Harness) -> None:
    prepare(harness, NVR_MAC=OLD_MAC)
    config_before = config_text(harness)
    harness.runtime.net = FakeNet(neigh=[reachable("192.0.2.10")])
    harness.runtime.runner = FakeFfprobe({}, default=unauthorized)
    assert harness.run("apply", "--relearn-mac") == vr.EXIT_PROBE_FAILED
    assert env_mac(harness) == OLD_MAC and config_text(harness) == config_before
    assert_no_secret(harness.output)


def test_apply_relearn_mac_probes_only_nvr_cameras(harness: Harness) -> None:
    # Una url: que responde no basta: la MAC es la del NVR.
    prepare(harness, cameras="extra url:rtsp://192.0.2.20:554/x\n", NVR_MAC=OLD_MAC)
    harness.runtime.net = FakeNet(neigh=[reachable("192.0.2.10")])
    assert harness.run("apply", "--relearn-mac") == vr.EXIT_ERROR
    assert "no tiene cámaras del NVR" in harness.output and env_mac(harness) == OLD_MAC
    prepare(harness, cameras="extra url:rtsp://192.0.2.20:554/x\nporton nvr:1\n", NVR_MAC=OLD_MAC)
    runner = FakeFfprobe({}, default=ok)
    harness.runtime.runner = runner
    harness.runtime.net = FakeNet(neigh=[reachable("192.0.2.10")])
    assert harness.run("apply", "--relearn-mac") == 0
    assert all("192.0.2.20" not in call[0][-1] for call in runner.calls)  # solo se probó el NVR
    assert env_mac(harness) == NVR_MAC


def test_apply_relearn_mac_without_a_neighbor_entry_keeps_the_mac(harness: Harness) -> None:
    prepare(harness, NVR_MAC=OLD_MAC)
    harness.runtime.net = FakeNet(neigh=[vr.Neighbor("192.0.2.10", NVR_MAC, ("FAILED",))])
    assert harness.run("apply", "--relearn-mac") == vr.EXIT_ERROR
    assert "NVR_MAC quedó como estaba" in harness.output and env_mac(harness) == OLD_MAC


def test_apply_relearn_mac_and_skip_probe_are_exclusive(harness: Harness) -> None:
    prepare(harness, NVR_MAC=OLD_MAC)
    with pytest.raises(SystemExit) as raised:
        harness.run("apply", "--relearn-mac", "--skip-probe")
    assert raised.value.code == 2


def test_set_nvr_relearn_mac(harness: Harness) -> None:
    write_env(harness.etc, **nvr_env(NVR_MAC=OLD_MAC))
    harness.runtime.net = FakeNet(neigh=[reachable("192.0.2.10")])
    harness.runtime.runner = FakeFfprobe({}, default=ok)
    harness.runtime.read_input = scripted(["", "", ""])
    harness.runtime.read_secret = scripted([""])
    assert harness.run("set-nvr") == 0
    assert env_mac(harness) == OLD_MAC  # misma IP, sin --relearn-mac: no la toca
    harness.runtime.read_input = scripted(["", "", ""])
    harness.runtime.read_secret = scripted([""])
    assert harness.run("set-nvr", "--relearn-mac") == 0
    assert env_mac(harness) == NVR_MAC
    assert f"NVR_MAC cambió de {OLD_MAC} a {NVR_MAC}" in harness.output


@pytest.mark.parametrize("probe", [unauthorized, not_found])
def test_set_nvr_relearn_mac_needs_the_probe_ok(harness: Harness, probe: Any) -> None:
    write_env(harness.etc, **nvr_env(NVR_MAC=OLD_MAC))
    harness.runtime.net = FakeNet(neigh=[reachable("192.0.2.10")])
    runner = FakeFfprobe({}, default=probe)
    harness.runtime.runner = runner
    harness.runtime.read_input = scripted(["", "", ""])
    harness.runtime.read_secret = scripted([""])
    assert harness.run("set-nvr", "--relearn-mac") == vr.EXIT_PROBE_FAILED
    assert env_mac(harness) == OLD_MAC
    assert "NVR_MAC quedó como estaba" in harness.output
    assert_no_secret(harness.output)


def test_dropin_header_has_no_kit_version() -> None:
    # Si la llevara, cada actualización del kit reiniciaría MediaMTX en el primer apply.
    assert vr.KIT_VERSION not in vr.render_ip_dropin(["127.0.0.1/32", "192.0.2.10/32"])


def test_set_nvr_mismatch_writes_nothing(harness: Harness) -> None:
    write_env(harness.etc, **nvr_env())
    before = (harness.etc / vr.ENV_FILE).read_bytes()
    harness.runtime.read_input = scripted(["192.0.2.30", "554", "viewer"])
    harness.runtime.read_secret = scripted(["Fake-uno-1234", "Fake-dos-1234"])
    assert harness.run("set-nvr") == 1
    assert (harness.etc / vr.ENV_FILE).read_bytes() == before
    assert "Fake-uno" not in harness.output


def test_set_nvr_rejects_invalid_host_and_non_tty(harness: Harness) -> None:
    harness.runtime.read_input = scripted(["user@host"])
    assert harness.run("set-nvr") == 1
    assert not (harness.etc / vr.ENV_FILE).exists()
    harness.runtime.stdin_isatty = lambda: False
    assert harness.run("set-nvr") == 1
    assert "interactivo" in harness.output


# --- urls, status, render --------------------------------------------------------------
def test_urls_lists_paths_without_secrets(harness: Harness) -> None:
    prepare(harness, cameras="porton nvr:1\ntest url:rtsp://cam:Fake-url-pass@10.0.0.5/x\n")
    harness.runtime.command = lambda command, timeout: (
        subprocess.CompletedProcess(command, 0, "100.90.80.70\n", "") if command[0] == "tailscale" else None
    )
    assert harness.run("urls") == 0
    output = harness.output
    # Con la IP de Tailscale disponible, las URLs la usan (glibc puede preferir IPv6 con MagicDNS).
    assert "rtsp://relay-reader:<CLAVE>@100.90.80.70:8554/porton" in output
    assert "/porton-hd" in output and "/test" in output
    assert "100.90.80.70" in output
    assert "Fake-url-pass" not in output
    assert_no_secret(output)


def test_status_reports_paths_and_reader_warning(harness: Harness) -> None:
    prepare(harness, READER_ALLOWED_IPS="")
    assert harness.run("status") == 0
    output = harness.output
    assert "porton" in output and "ready=sí" in output and "lectores=1" in output
    assert "READER_ALLOWED_IPS no está definido" in output
    assert_no_secret(output)


def test_status_without_api(harness: Harness) -> None:
    server = prepare(harness)
    server.down = True
    assert harness.run("status") == 1
    assert "no responde" in harness.output


def test_describe_throttled() -> None:
    assert vr.describe_throttled("throttled=0x0\n").startswith("0x0")
    text = vr.describe_throttled("throttled=0x50005")
    assert "bajo voltaje AHORA" in text and "hubo bajo voltaje" in text and "hubo throttling" in text
    assert vr.describe_throttled("basura") == "n/d"


def test_render_out_writes_private_file(harness: Harness, tmp_path: Path) -> None:
    prepare(harness)
    out = tmp_path / "relay.yml"
    assert harness.run("render", "--out", str(out)) == 0
    assert vr.parse_rendered_config(out.read_text(encoding="utf-8")) == vr.parse_rendered_config(config_text(harness))
    assert_no_secret(harness.output)
    if POSIX:
        assert stat.S_IMODE(out.stat().st_mode) == 0o600


def test_unexpected_errors_are_redacted(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    prepare(harness)

    def explode(*args: Any, **kwargs: Any) -> Any:
        raise ValueError(f"fallo con rtsp://viewer:{FAKE_NVR_PASS_ENCODED}@192.0.2.10/x y {FAKE_NVR_PASS}")

    monkeypatch.setattr(vr, "build_paths", explode)
    assert harness.run("urls") == 1
    assert "error inesperado (ValueError)" in harness.output
    assert_no_secret(harness.output)


def test_apply_and_status_warn_about_reader_ips_outside_tailscale(harness: Harness) -> None:
    prepare(harness, READER_ALLOWED_IPS="100.101.102.103, 192.168.1.50")
    assert harness.run("apply") == 0
    assert "fuera de Tailscale (192.168.1.50/32)" in harness.output
    assert "no está definido" not in harness.output
    assert harness.run("status") == 0
    assert harness.output.count("fuera de Tailscale") == 2


def test_rollback_message_is_not_duplicated(harness: Harness) -> None:
    server = prepare(harness)
    server.rejects = lambda config: "puerta" in config["paths"]
    (harness.etc / vr.CAMERAS_FILE).write_text("puerta nvr:2\n", encoding="utf-8")
    assert harness.run("apply") == vr.EXIT_ROLLED_BACK
    assert "no cargó la config nueva (MediaMTX" not in harness.output
    assert harness.output.count("no quedó activa") == 2  # el aviso y el error final


# --- drop-in de red (IPAddressAllow) ---------------------------------------------
def with_dropin(harness: Harness, tmp_path: Path) -> Path:
    directory = tmp_path / "systemd" / "vigilia-relay.service.d"
    harness.runtime.unit_dropin_dir = lambda etc: directory
    return directory / vr.DROPIN_NAME


def restarts(harness: Harness) -> int:
    return harness.commands.count(["systemctl", "restart", vr.SERVICE_UNIT])


def test_apply_writes_ip_dropin_and_restarts_only_when_it_changes(harness: Harness, tmp_path: Path) -> None:
    cameras = "porton nvr:1\nextra url:rtsp://192.0.2.20:554/x\nv6 url:rtsp://[2001:db8::20]/y\n"
    prepare(harness, cameras=cameras)
    dropin = with_dropin(harness, tmp_path)
    assert harness.run("apply") == 0
    text = dropin.read_text(encoding="utf-8")
    assert "IPAddressAllow=\n" in text
    assert "IPAddressAllow=localhost 192.0.2.10/32 192.0.2.20/32 2001:db8::20/128 100.64.0.0/10 fd7a:115c:a1e0::/48" in text
    assert ["systemctl", "daemon-reload"] in harness.commands
    assert restarts(harness) == 1
    if POSIX:
        assert stat.S_IMODE(dropin.stat().st_mode) == 0o644
    # Sin cambios: ni escribe ni reinicia.
    assert harness.run("apply") == 0
    assert restarts(harness) == 1
    # Cambio que no toca la red (otro canal del mismo NVR): recarga en caliente, sin reinicio.
    (harness.etc / vr.CAMERAS_FILE).write_text(cameras + "puerta nvr:2\n", encoding="utf-8")
    assert harness.run("apply") == 0
    assert restarts(harness) == 1
    # Cambia el NVR: cambia el drop-in y reinicia.
    write_env(harness.etc, **nvr_env(NVR_HOST="192.0.2.11"))
    assert harness.run("apply") == 0
    assert "192.0.2.11/32" in dropin.read_text(encoding="utf-8")
    assert restarts(harness) == 2


def test_apply_rejects_hostnames_and_writes_nothing(harness: Harness, tmp_path: Path) -> None:
    # Con IPAddressDeny=any MediaMTX no puede hacer DNS: un nombre nunca andaría.
    prepare(harness)
    dropin = with_dropin(harness, tmp_path)
    old = config_text(harness)
    (harness.etc / vr.CAMERAS_FILE).write_text("porton nvr:1\nx url:rtsp://camara.lan/x\n", encoding="utf-8")
    assert harness.run("apply") == 1
    assert "usa la IP del equipo" in harness.output
    assert config_text(harness) == old
    assert not dropin.exists()
    assert restarts(harness) == 0


def failing_daemon_reload(harness: Harness) -> None:
    def command(command: Any, timeout: float) -> Any:
        harness.commands.append(list(command))
        if list(command) == ["systemctl", "daemon-reload"]:
            return subprocess.CompletedProcess(command, 1, "", "Failed to reload daemon")
        return None

    harness.runtime.command = command


def test_apply_daemon_reload_failure_is_not_applied(harness: Harness, tmp_path: Path) -> None:
    prepare(harness)
    dropin = with_dropin(harness, tmp_path)
    old = config_text(harness)
    failing_daemon_reload(harness)
    (harness.etc / vr.CAMERAS_FILE).write_text("porton nvr:1\npuerta nvr:2\n", encoding="utf-8")
    assert harness.run("apply") == vr.EXIT_SYSTEMD
    assert "daemon-reload falló" in harness.output
    assert "applied" not in harness.output and "config activa" not in harness.output
    assert config_text(harness) == old  # la config nueva no se escribió
    assert not dropin.exists()  # se volvió a "sin drop-in"
    assert restarts(harness) == 0


def test_apply_daemon_reload_failure_restores_previous_dropin(harness: Harness, tmp_path: Path) -> None:
    prepare(harness)
    dropin = with_dropin(harness, tmp_path)
    assert harness.run("apply") == 0
    before = dropin.read_text(encoding="utf-8")
    old = config_text(harness)
    failing_daemon_reload(harness)
    write_env(harness.etc, **nvr_env(NVR_HOST="192.0.2.11"))
    assert harness.run("apply") == vr.EXIT_SYSTEMD
    assert dropin.read_text(encoding="utf-8") == before
    assert config_text(harness) == old


# --- lock ---------------------------------------------------------------------------
@pytest.mark.parametrize("command", [["apply"], ["rotate-password", "--no-apply"], ["set-nvr"]])
def test_commands_refuse_to_run_concurrently(harness: Harness, command: list[str]) -> None:
    prepare(harness)
    old = config_text(harness)
    with vr.relay_lock(harness.etc):
        assert harness.run(*command) == vr.EXIT_BUSY
    assert "en curso" in harness.output
    assert config_text(harness) == old
    # Liberado el lock, vuelve a andar.
    if command == ["apply"]:
        assert harness.run("apply") == 0


def test_lock_is_released_after_an_error(harness: Harness) -> None:
    prepare(harness)
    (harness.etc / vr.CAMERAS_FILE).write_text("Mal nvr:1\n", encoding="utf-8")
    assert harness.run("apply") == 1
    (harness.etc / vr.CAMERAS_FILE).write_text("porton nvr:1\n", encoding="utf-8")
    assert harness.run("apply") == 0


def test_rollback_restores_previous_dropin(harness: Harness, tmp_path: Path) -> None:
    server = prepare(harness)
    dropin = with_dropin(harness, tmp_path)
    assert harness.run("apply") == 0
    before = dropin.read_text(encoding="utf-8")
    server.rejects = lambda config: "192.0.2.11" in json_sources(config)
    write_env(harness.etc, **nvr_env(NVR_HOST="192.0.2.11"))
    assert harness.run("apply") == vr.EXIT_ROLLED_BACK
    assert dropin.read_text(encoding="utf-8") == before


def json_sources(config: dict[str, Any]) -> str:
    return " ".join(spec["source"] for spec in config["paths"].values())


def test_default_unit_dropin_dir_only_for_the_real_etc(tmp_path: Path) -> None:
    assert vr._default_unit_dropin_dir(tmp_path) is None
    expected = None
    if os.name == "posix" and Path(vr.SYSTEMD_UNIT_DIR).is_dir():
        expected = Path(vr.SYSTEMD_UNIT_DIR) / "vigilia-relay.service.d"
    assert vr._default_unit_dropin_dir(Path(vr.DEFAULT_ETC_DIR)) == expected


# --- errores del sistema ----------------------------------------------------------
@pytest.mark.parametrize(
    ("code", "exit_code", "text"),
    [
        (vr.errno.EROFS, vr.EXIT_STORAGE, "solo lectura"),
        (vr.errno.ENOSPC, vr.EXIT_STORAGE, "no queda espacio"),
        (vr.errno.EIO, vr.EXIT_STORAGE, "posible SD dañada"),
        (vr.errno.ENOENT, vr.EXIT_ERROR, "error del sistema (ENOENT)"),
    ],
)
def test_os_errors_are_explained_in_spanish(
    harness: Harness, monkeypatch: pytest.MonkeyPatch, code: int, exit_code: int, text: str
) -> None:
    prepare(harness)
    (harness.etc / vr.CAMERAS_FILE).write_text("puerta nvr:2\n", encoding="utf-8")

    def broken(path: Path, data: bytes, *, mode: int, owner: Any = None) -> None:
        raise OSError(code, "mensaje crudo en inglés", str(path))

    monkeypatch.setattr(vr, "atomic_write", broken)
    assert harness.run("apply") == exit_code
    assert text in harness.output
    assert "mensaje crudo en inglés" not in harness.output
    if exit_code == vr.EXIT_STORAGE:
        # Cita una sección que existe en el README.
        assert "README, sección «SD en solo lectura o llena»" in harness.output
        readme = (vr.Path(vr.__file__).parent / "README.md").read_text(encoding="utf-8")
        assert "### SD en solo lectura o llena" in readme


# --- API: respuesta cortada -------------------------------------------------------------
def test_api_truncated_chunked_response_is_unavailable() -> None:
    import socket
    import threading

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    port = server.getsockname()[1]

    def serve() -> None:
        connection, _ = server.accept()
        with connection:
            connection.recv(4096)
            connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n10\r\n{\"items\": [")
        server.close()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    api = vr.MediamtxApi(port, "secreto-falso-de-prueba-0001", timeout=3)
    with pytest.raises(vr.ApiUnavailable):
        api.get_json("/v3/config/global/get")
    thread.join(5)
