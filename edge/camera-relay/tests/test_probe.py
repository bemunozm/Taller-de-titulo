"""probe: ffprobe secuencial (subprocess mockeado), corte en 401, timeout y redacción."""

from __future__ import annotations

import json
import subprocess
from collections.abc import Callable
from typing import Any

import pytest

from conftest import FAKE_NVR_PASS, FAKE_NVR_PASS_ENCODED, Harness, nvr_env, write_env
import vigilia_relay as vr

OK_JSON = json.dumps(
    {"streams": [{"codec_name": "h264", "width": 640, "height": 360, "avg_frame_rate": "15/1"}]}
)


def unauthorized_stderr(url: str) -> str:
    # Forma real de ffmpeg 5.1-8.x: cita la URL completa con credenciales.
    return (
        "[rtsp @ 0x55d1c0] method DESCRIBE failed: 401 Unauthorized\n"
        f"{url}: Server returned 401 Unauthorized (authorization failed)\n"
    )


class FakeFfprobe:
    """Reemplazo de subprocess.run: responde según el canal de la URL."""

    def __init__(self, outcomes: dict[str, Callable[[str], Any]], default: Callable[[str], Any] | None = None) -> None:
        self.outcomes = outcomes
        self.default = default
        self.calls: list[tuple[list[str], dict[str, Any]]] = []

    def __call__(self, command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        self.calls.append((command, kwargs))
        url = command[-1]
        for key, outcome in self.outcomes.items():
            if url.endswith(key):
                return outcome(url)
        if self.default is None:
            raise AssertionError(f"canal inesperado: {url.rsplit('/', 1)[-1]}")
        return self.default(url)

    @property
    def channels(self) -> list[str]:
        return [command[-1].rsplit("/", 1)[-1] for command, _ in self.calls]


def ok(url: str) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess([], 0, OK_JSON, "")


def unauthorized(url: str) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess([], 1, "", unauthorized_stderr(url))


def not_found(url: str) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess([], 1, "", f"[rtsp @ 0x1] method DESCRIBE failed: 404 Not Found\n{url}: Server returned 404 Not Found\n")


def timeout(url: str) -> subprocess.CompletedProcess[str]:
    raise subprocess.TimeoutExpired(cmd="ffprobe", timeout=18)


def refused(url: str) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess([], 1, "", f"[tcp @ 0x2] Connection to tcp://192.0.2.10:554 failed: Connection refused\n{url}: Connection refused\n")


def socket_timeout(url: str) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess([], 1, "", f"{url}: Connection timed out\n")


def assert_no_secret(text: str) -> None:
    assert FAKE_NVR_PASS not in text
    assert FAKE_NVR_PASS_ENCODED not in text
    assert "Fake%40" not in text and "Fake@" not in text


# --- comando ffprobe -----------------------------------------------------------
def test_ffprobe_command_uses_tcp_and_socket_timeout() -> None:
    command = vr.ffprobe_command("ffprobe", "rtsp://x/y", 8)
    assert command[:1] == ["ffprobe"]
    assert command[command.index("-rtsp_transport") + 1] == "tcp"
    assert command[command.index("-timeout") + 1] == "8000000"  # microsegundos
    assert "-stimeout" not in command
    assert command[-1] == "rtsp://x/y"


def test_ffprobe_command_whitelists_only_rtsp_protocols() -> None:
    command = vr.ffprobe_command("ffprobe", "rtsp://x/y", 8)
    whitelist = command[command.index("-protocol_whitelist") + 1]
    assert whitelist.split(",") == ["rtsp", "rtsps", "tcp", "tls", "rtp", "udp"]
    assert command.index("-protocol_whitelist") < command.index("rtsp://x/y")


PRIVILEGES = vr.ProbePrivileges(
    prefix=("/usr/bin/setpriv", "--no-new-privs", "--"),
    kwargs={"user": 999, "group": 999, "extra_groups": [], "umask": 0o077, "cwd": "/", "env": {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}},
)


def test_probe_url_runs_with_dropped_privileges_behind_setpriv() -> None:
    runner = FakeFfprobe({"102": ok})
    vr.probe_url("c", "rtsp://h/Streaming/Channels/102", ffprobe="ffprobe", runner=runner, redactor=vr.Redactor(), privileges=PRIVILEGES)
    command, kwargs = runner.calls[0]
    assert command[:4] == ["/usr/bin/setpriv", "--no-new-privs", "--", "ffprobe"]
    for key, value in PRIVILEGES.kwargs.items():
        assert kwargs[key] == value
    assert kwargs["timeout"] == vr.PROBE_TIMEOUT_S + vr.PROBE_SUBPROCESS_MARGIN_S


def test_probe_url_without_privilege_drop_runs_ffprobe_directly() -> None:
    runner = FakeFfprobe({"102": ok})
    vr.probe_url("c", "rtsp://h/Streaming/Channels/102", ffprobe="ffprobe", runner=runner, redactor=vr.Redactor())
    command, kwargs = runner.calls[0]
    assert command[0] == "ffprobe" and "user" not in kwargs


def test_cmd_probe_uses_runtime_privileges(harness: Harness) -> None:
    write_env(harness.etc, **nvr_env(NVR_CHANNELS="1"))
    runner = FakeFfprobe({"102": ok})
    harness.runtime.runner = runner
    harness.runtime.probe_privileges = lambda: PRIVILEGES
    assert harness.run("probe") == 0
    command, kwargs = runner.calls[0]
    assert command[:3] == ["/usr/bin/setpriv", "--no-new-privs", "--"]
    assert kwargs["user"] == 999 and kwargs["extra_groups"] == []


def test_default_probe_privileges(monkeypatch: pytest.MonkeyPatch) -> None:
    import sys
    import types

    monkeypatch.setattr(vr, "_is_root", lambda: False)
    assert vr._probe_privileges() == vr.NO_PRIVILEGE_DROP

    monkeypatch.setattr(vr, "_is_root", lambda: True)
    fake_pwd = types.SimpleNamespace(
        getpwnam=lambda name: types.SimpleNamespace(pw_uid=990, pw_gid=991) if name == vr.PROBE_USER else (_ for _ in ()).throw(KeyError(name))
    )
    monkeypatch.setitem(sys.modules, "pwd", fake_pwd)
    monkeypatch.setattr(vr.shutil, "which", lambda name, path=None: "/usr/bin/setpriv" if name == "setpriv" else None)
    privileges = vr._probe_privileges()
    assert privileges.prefix == ("/usr/bin/setpriv", "--no-new-privs", "--")
    assert privileges.kwargs["user"] == 990 and privileges.kwargs["group"] == 991
    assert privileges.kwargs["extra_groups"] == [] and privileges.kwargs["umask"] == 0o077
    assert privileges.kwargs["env"]["LC_ALL"] == "C" and "HOME" not in privileges.kwargs["env"]

    monkeypatch.setattr(vr.shutil, "which", lambda name, path=None: None)
    with pytest.raises(vr.RelayError, match="setpriv"):
        vr._probe_privileges()

    missing_pwd = types.SimpleNamespace(getpwnam=lambda name: (_ for _ in ()).throw(KeyError(name)))
    monkeypatch.setitem(sys.modules, "pwd", missing_pwd)
    with pytest.raises(vr.RelayError, match="vigilia-probe"):
        vr._probe_privileges()


def test_encoded_password_with_401_is_not_an_auth_failure() -> None:
    # "@1-x" se codifica "%401-x": sin redactar, \b401\b calzaría y el probe
    # se cortaría como si el NVR hubiera rechazado la clave.
    nvr = vr.NvrSettings("192.0.2.10", 554, "viewer", "Fake@1-x")
    url = vr.nvr_stream_url(nvr, 1, "sub")
    assert "%401-x" in url
    result = vr.probe_url("c", url, ffprobe="f", runner=FakeFfprobe({}, default=not_found), redactor=vr.Redactor())
    assert result.status == "not_found"
    result = vr.probe_url("c", url, ffprobe="f", runner=FakeFfprobe({}, default=refused), redactor=vr.Redactor())
    assert result.status == "unreachable"


def test_probe_url_passes_subprocess_timeout_and_no_stdin() -> None:
    runner = FakeFfprobe({"102": ok})
    result = vr.probe_url("canal 1", "rtsp://h/Streaming/Channels/102", ffprobe="ffprobe", runner=runner, redactor=vr.Redactor(), timeout_s=5)
    assert result == vr.ProbeResult("canal 1", "ok", codec="h264", width=640, height=360, fps=15.0)
    _, kwargs = runner.calls[0]
    assert kwargs["timeout"] == 5 + vr.PROBE_SUBPROCESS_MARGIN_S
    assert kwargs["stdin"] is subprocess.DEVNULL
    assert kwargs["check"] is False


@pytest.mark.parametrize(
    ("outcome", "status"),
    [(unauthorized, "auth"), (not_found, "not_found"), (timeout, "timeout"), (refused, "unreachable"), (socket_timeout, "timeout")],
)
def test_probe_url_classifies_and_redacts(outcome: Callable[[str], Any], status: str) -> None:
    nvr = vr.NvrSettings("192.0.2.10", 554, "viewer", FAKE_NVR_PASS)
    url = vr.nvr_stream_url(nvr, 1, "sub")
    result = vr.probe_url("canal 1", url, ffprobe="ffprobe", runner=FakeFfprobe({}, default=outcome), redactor=vr.Redactor([FAKE_NVR_PASS]))
    assert result.status == status
    assert_no_secret(result.detail)
    assert_no_secret(repr(result))


def test_probe_detail_redacted_even_without_known_secret() -> None:
    # Sin el secreto en el Redactor, la regex igual tapa la URL con userinfo.
    url = "rtsp://otro:OtraClaveFalsa@192.0.2.10:554/Streaming/Channels/102"
    result = vr.probe_url("c", url, ffprobe="ffprobe", runner=FakeFfprobe({}, default=unauthorized), redactor=vr.Redactor())
    assert "OtraClaveFalsa" not in result.detail
    assert "rtsp://[redacted]" in result.detail


def test_probe_url_ok_without_video_stream_is_error() -> None:
    runner = FakeFfprobe({}, default=lambda url: subprocess.CompletedProcess([], 0, '{"streams": []}', ""))
    assert vr.probe_url("c", "rtsp://h/x", ffprobe="f", runner=runner, redactor=vr.Redactor()).status == "error"


def test_probe_url_missing_ffprobe_is_a_clear_error() -> None:
    def missing(*args: Any, **kwargs: Any) -> Any:
        raise FileNotFoundError("ffprobe")

    with pytest.raises(vr.RelayError, match="no se encontró ffprobe"):
        vr.probe_url("c", "rtsp://h/x", ffprobe="ffprobe", runner=missing, redactor=vr.Redactor())


# --- secuencia -------------------------------------------------------------------
def test_probe_sequence_stops_at_first_auth_failure() -> None:
    results: list[vr.ProbeResult] = []

    def probe_one(label: str, url: str) -> vr.ProbeResult:
        status = {"a": "ok", "b": "timeout", "c": "auth"}.get(label, "ok")
        return vr.ProbeResult(label, status)

    out = vr.probe_sequence([(x, x) for x in "abcde"], probe_one, on_result=results.append)
    assert [r.label for r in out] == ["a", "b", "c"]
    assert results == out


def test_probe_sequence_can_stop_at_first_ok() -> None:
    out = vr.probe_sequence([(x, x) for x in "abc"], lambda label, url: vr.ProbeResult(label, "timeout" if label == "a" else "ok"), stop_at_first_ok=True)
    assert [r.label for r in out] == ["a", "b"]


# --- comando probe -----------------------------------------------------------
def test_cmd_probe_runs_sequentially_and_stops_at_401(harness: Harness) -> None:
    write_env(harness.etc, **nvr_env(NVR_CHANNELS="6"))
    runner = FakeFfprobe({"102": ok, "202": not_found, "302": unauthorized, "402": ok})
    harness.runtime.runner = runner
    code = harness.run("probe")
    assert code == vr.EXIT_PROBE_FAILED
    assert runner.channels == ["102", "202", "302"]  # el 4 no se intentó
    assert "canal 1" in harness.output and "OK" in harness.output and "h264" in harness.output
    assert "NO-EXISTE" in harness.output and "CLAVE" in harness.output
    assert "bloquear la IP" in harness.output
    assert_no_secret(harness.output)


def test_cmd_probe_channels_and_main_stream(harness: Harness) -> None:
    write_env(harness.etc, **nvr_env())
    runner = FakeFfprobe({}, default=ok)
    harness.runtime.runner = runner
    assert harness.run("probe", "--channels", "2,5-6", "--stream", "main", "--timeout", "4") == 0
    assert runner.channels == ["201", "501", "601"]
    command, kwargs = runner.calls[0]
    assert command[0] == "ffprobe-fake"
    assert command[command.index("-timeout") + 1] == "4000000"
    assert "3 de 3 canal(es) OK" in harness.output


def test_cmd_probe_timeouts_continue_and_exit_3_if_none_ok(harness: Harness) -> None:
    write_env(harness.etc, **nvr_env(NVR_CHANNELS="2"))
    harness.runtime.runner = FakeFfprobe({}, default=timeout)
    assert harness.run("probe") == vr.EXIT_PROBE_FAILED
    assert harness.output.count("TIMEOUT") == 2
    assert "0 de 2" in harness.output


def test_cmd_probe_without_nvr(harness: Harness) -> None:
    write_env(harness.etc, READER_ALLOWED_IPS="100.101.102.103")
    assert harness.run("probe") == 1
    assert "set-nvr" in harness.output


@pytest.mark.parametrize("value", ["0", "61"])
def test_cmd_probe_rejects_bad_timeout(harness: Harness, value: str) -> None:
    write_env(harness.etc, **nvr_env())
    assert harness.run("probe", "--timeout", value) == 1
