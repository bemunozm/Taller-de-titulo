"""follow-nvr: seguir la IP del NVR (DHCP) por su MAC. Red falsa (FakeNet) y
apply contra el MediaMTX falso de test_apply. Todas las claves son FALSAS."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from conftest import FAKE_NVR_PASS, FAKE_NVR_PASS_ENCODED, NVR_MAC, FakeNet, Harness, nvr_env, reachable, write_env
from test_apply import FakeMediamtx, config_text, prepare, with_dropin
from test_probe import FakeFfprobe, ok, unauthorized
import vigilia_relay as vr

OLD_IP = "192.0.2.10"  # NVR_HOST de nvr_env()
NEW_IP = "192.0.2.77"
PORT = 554


def assert_no_secret(text: str) -> None:
    assert FAKE_NVR_PASS not in text
    assert FAKE_NVR_PASS_ENCODED not in text


# --- ip neigh, MAC, red ---------------------------------------------------------------
NEIGH_JSON = json.dumps(
    [
        {"dst": "192.168.1.2", "dev": "eth0", "lladdr": "02:1A:2B:3C:4D:5E", "state": ["REACHABLE"]},
        {"dst": "192.168.1.9", "dev": "eth0", "state": ["FAILED"]},
        {"dst": "192.168.1.10", "dev": "eth0", "state": ["INCOMPLETE"]},
        {"dst": "192.168.1.3", "dev": "eth0", "lladdr": "aa:bb:cc:dd:ee:01", "state": ["STALE"]},
        {"dst": "192.168.1.4", "dev": "eth0", "lladdr": "aa:bb:cc:dd:ee:02", "state": ["DELAY"]},
        {"dst": "192.168.1.1", "dev": "eth0", "lladdr": "aa:bb:cc:dd:ee:03", "state": ["PERMANENT"]},
        {"dst": "192.168.1.6", "dev": "eth0", "lladdr": "aa:bb:cc:dd:ee:06", "state": "STALE"},
        {"dst": "fe80::1", "dev": "eth0", "lladdr": "aa:bb:cc:dd:ee:04", "state": ["STALE"]},
        {"dst": "192.168.1.5", "dev": "eth0", "lladdr": "no-es-una-mac", "state": ["REACHABLE"]},
        "basura",
        {"dst": None},
    ]
)


def test_parse_neighbors_states() -> None:
    by_ip = {n.ip: n for n in vr.parse_neighbors(NEIGH_JSON)}
    assert set(by_ip) == {"192.168.1.2", "192.168.1.9", "192.168.1.10", "192.168.1.3", "192.168.1.4", "192.168.1.1", "192.168.1.6", "192.168.1.5"}
    assert by_ip["192.168.1.2"].mac == NVR_MAC and by_ip["192.168.1.2"].confirmed
    assert not by_ip["192.168.1.9"].usable and by_ip["192.168.1.9"].mac is None  # FAILED
    assert not by_ip["192.168.1.10"].usable  # INCOMPLETE
    assert by_ip["192.168.1.3"].usable and not by_ip["192.168.1.3"].confirmed  # STALE: MAC útil, no confirmada
    assert by_ip["192.168.1.4"].usable and not by_ip["192.168.1.4"].confirmed  # DELAY
    assert by_ip["192.168.1.1"].confirmed  # PERMANENT
    assert by_ip["192.168.1.6"].states == ("STALE",)  # state como string
    assert by_ip["192.168.1.5"].mac is None and not by_ip["192.168.1.5"].usable
    assert vr.mac_at(by_ip.values(), "192.168.1.2") == NVR_MAC
    assert vr.mac_at(by_ip.values(), "192.168.1.9") is None


@pytest.mark.parametrize("text", ["", "{no json", "{}", "[1, 2]", "null"])
def test_parse_neighbors_tolerates_garbage(text: str) -> None:
    assert vr.parse_neighbors(text) == []


def test_mac_failed_entry_with_stale_lladdr_is_not_usable() -> None:
    neighbor = vr.Neighbor("192.168.1.2", NVR_MAC, ("FAILED",))
    assert not neighbor.usable
    assert vr.mac_at([neighbor], "192.168.1.2") is None


@pytest.mark.parametrize(("value", "expected"), [("02:1A:2B:3C:4D:5E", NVR_MAC), (" 02:1a:2b:3c:4d:5e ", NVR_MAC), ("02:00:00:00:00:01", "02:00:00:00:00:01")])
def test_validate_mac(value: str, expected: str) -> None:
    assert vr.validate_mac(value) == expected


@pytest.mark.parametrize(
    "value",
    ["02-1a-2b-3c-4d-5e", "021a2b3c4d5e", "02:1a:2b:3c:4d", "02:1a:2b:3c:4d:5e:00", "gg:1a:2b:3c:4d:5e",
     "00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "01:00:5e:00:00:01", ""],
)
def test_invalid_macs(value: str) -> None:
    with pytest.raises(vr.ConfigError, match="NVR_MAC"):
        vr.validate_mac(value)


def test_settings_read_nvr_mac() -> None:
    assert vr.settings_from_env(nvr_env(NVR_MAC="02:1A:2B:3C:4D:5E")).nvr.mac == NVR_MAC  # type: ignore[union-attr]
    assert vr.settings_from_env(nvr_env()).nvr.mac is None  # type: ignore[union-attr]
    with pytest.raises(vr.ConfigError, match="NVR_MAC"):
        vr.settings_from_env(nvr_env(NVR_MAC="no-es-mac"))


def test_default_interface_and_address() -> None:
    routes = json.dumps([{"dst": "default", "gateway": "192.168.1.1", "dev": "wlan0"}, {"dst": "default", "gateway": "192.168.1.1", "dev": "eth0"}])
    assert vr.parse_default_interface(routes) == "eth0"
    assert vr.parse_default_interface(json.dumps([{"dst": "default", "dev": "end0"}])) == "end0"
    assert vr.parse_default_interface("[]") is None and vr.parse_default_interface("{x") is None
    addresses = json.dumps(
        [{"ifname": "eth0", "addr_info": [{"family": "inet6", "local": "fe80::1", "prefixlen": 64}, {"family": "inet", "local": "192.168.1.134", "prefixlen": 24}]}]
    )
    assert vr.parse_interface_address(addresses) == vr.ipaddress.IPv4Interface("192.168.1.134/24")
    assert vr.parse_interface_address("[]") is None


@pytest.mark.parametrize(
    ("interface", "count", "first", "last"),
    [
        ("192.168.1.134/24", 253, "192.168.1.1", "192.168.1.254"),
        ("10.1.2.3/16", 253, "10.1.2.1", "10.1.2.254"),  # nunca más que la /24 propia
        ("10.0.0.5/8", 253, "10.0.0.1", "10.0.0.254"),
        ("192.168.1.130/25", 125, "192.168.1.129", "192.168.1.254"),
        ("192.168.1.1/30", 1, "192.168.1.2", "192.168.1.2"),
    ],
)
def test_sweep_targets_never_exceed_a_slash_24(interface: str, count: int, first: str, last: str) -> None:
    targets = vr.sweep_targets(vr.ipaddress.IPv4Interface(interface))
    assert len(targets) == count and targets[0] == first and targets[-1] == last
    assert interface.split("/")[0] not in targets


class StubCommand:
    """`ip -j ...` falso para SystemNet."""

    def __init__(self, outputs: dict[str, str]) -> None:
        self.outputs = outputs
        self.calls: list[list[str]] = []

    def __call__(self, command: Any, timeout: float) -> Any:
        self.calls.append(list(command))
        key = " ".join(command[2:])
        if key not in self.outputs:
            return subprocess.CompletedProcess(command, 1, "", "error")
        return subprocess.CompletedProcess(command, 0, self.outputs[key], "")


def test_system_net_reads_route_addr_and_neighbors(harness: Harness) -> None:
    harness.runtime.command = StubCommand(
        {
            "-4 route show default": json.dumps([{"dst": "default", "dev": "eth0", "gateway": "192.168.1.1"}]),
            "-4 addr show dev eth0": json.dumps([{"ifname": "eth0", "addr_info": [{"family": "inet", "local": "192.168.1.134", "prefixlen": 24}]}]),
            "-4 neigh show": NEIGH_JSON,
        }
    )
    net = vr.SystemNet(harness.runtime)
    assert net.local_interface() == ("eth0", vr.ipaddress.IPv4Interface("192.168.1.134/24"))
    assert vr.mac_at(net.neighbors(), "192.168.1.2") == NVR_MAC


def test_system_net_defaults_to_eth0_without_default_route(harness: Harness) -> None:
    stub = StubCommand({"-4 addr show dev eth0": json.dumps([{"ifname": "eth0", "addr_info": [{"family": "inet", "local": "192.168.1.134", "prefixlen": 24}]}])})
    harness.runtime.command = stub
    assert vr.SystemNet(harness.runtime).local_interface()[0] == "eth0"


def test_sweep_pings_every_target_with_bounded_concurrency(harness: Harness) -> None:
    lock = threading.Lock()
    active = {"now": 0, "max": 0}
    calls: list[list[str]] = []

    def stub_ping(command: list[str], **kwargs: Any) -> Any:
        with lock:
            calls.append(command)
            active["now"] += 1
            active["max"] = max(active["max"], active["now"])
        time.sleep(0.005)
        with lock:
            active["now"] -= 1
        assert kwargs["timeout"] <= vr.SWEEP_PING_TIMEOUT_S + 3
        return subprocess.CompletedProcess(command, 1)

    targets = vr.sweep_targets(vr.ipaddress.IPv4Interface("192.168.1.134/24"))
    vr.SystemNet(harness.runtime, runner=stub_ping, workers=4).sweep(targets)
    assert sorted(c[-1] for c in calls) == sorted(targets)
    assert all(c[:6] == ["ping", "-n", "-q", "-c", "1", "-W"] for c in calls)
    assert 1 < active["max"] <= 4


def test_sweep_survives_ping_errors(harness: Harness) -> None:
    def broken(command: list[str], **kwargs: Any) -> Any:
        raise OSError("ping no está")

    vr.SystemNet(harness.runtime, runner=broken).sweep(["192.0.2.1", "192.0.2.2"])


# --- estado ------------------------------------------------------------------------
def test_state_roundtrip_and_corruption(tmp_path: Path) -> None:
    path = tmp_path / "state" / vr.FOLLOW_STATE_FILE
    assert vr.load_follow_state(path) == (vr.FollowState(), None)
    state = vr.FollowState(fail_count=2, day="2026-10-18", changes_today=1, last_change="x")
    assert vr.save_follow_state(path, state)
    assert vr.load_follow_state(path) == (state, None)
    if os.name == "posix":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    for garbage in ("{no json", "[]", "null", '{"fail_count": "dos", "day": "ayer", "changes_today": -1, "last_change": 5}'):
        path.write_text(garbage, encoding="utf-8")
        loaded, problem = vr.load_follow_state(path)
        assert loaded.fail_count == 0 and loaded.changes_today == 0 and loaded.day == ""
        if garbage != '{"fail_count": "dos", "day": "ayer", "changes_today": -1, "last_change": 5}':
            assert problem and "corrupto" in problem


def test_state_unreadable_and_unwritable(tmp_path: Path) -> None:
    # Un directorio donde va el archivo: ilegible y no reemplazable (Linux y Windows).
    path = tmp_path / vr.FOLLOW_STATE_FILE
    path.mkdir()
    (path / "algo").write_text("", encoding="utf-8")
    loaded, problem = vr.load_follow_state(path)
    assert loaded == vr.FollowState() and problem and "no se pudo leer" in problem
    assert vr.save_follow_state(path, vr.FollowState()) is False
    # Su directorio no se puede crear (el "padre" es un archivo).
    blocker = tmp_path / "es-un-archivo"
    blocker.write_text("", encoding="utf-8")
    assert vr.save_follow_state(blocker / vr.FOLLOW_STATE_FILE, vr.FollowState()) is False


# --- decisión -------------------------------------------------------------------------
def relay(harness: Harness, tmp_path: Path, *, mac: str | None = NVR_MAC) -> tuple[FakeMediamtx, Path]:
    server = prepare(harness)
    extra = {"NVR_MAC": mac} if mac else {}
    write_env(harness.etc, **nvr_env(**extra))
    dropin = with_dropin(harness, tmp_path)
    assert harness.run("apply") == 0  # deja el drop-in con la IP vieja
    reset_output(harness)
    return server, dropin


def reset_output(harness: Harness) -> None:
    for stream in (harness.stdout, harness.stderr):
        stream.seek(0)
        stream.truncate(0)


def env_value(harness: Harness, key: str) -> str | None:
    return vr.parse_env_text((harness.etc / vr.ENV_FILE).read_text(encoding="utf-8")).get(key)


def state_of(harness: Harness) -> vr.FollowState:
    return vr.load_follow_state(harness.context().follow_state_path())[0]


def moved_net(*after: vr.Neighbor, open_ips: tuple[str, ...] = (NEW_IP,)) -> FakeNet:
    """El NVR ya no está en OLD_IP; tras el barrido, la tabla de vecinos es `after`."""
    return FakeNet(open={(ip, PORT) for ip in open_ips}, neigh=[], after_sweep=list(after))


def test_ok_resets_the_counter(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    vr.save_follow_state(harness.context().follow_state_path(), vr.FollowState(fail_count=1))
    harness.runtime.net = FakeNet(open={(OLD_IP, PORT)}, neigh=[reachable(OLD_IP)])
    assert harness.run("follow-nvr") == 0
    assert "OK, sin cambios" in harness.output and "volvió a responder" in harness.output
    assert state_of(harness).fail_count == 0
    assert harness.runtime.net.swept == []


def test_one_failure_waits_without_sweeping(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    harness.runtime.net = moved_net(reachable(NEW_IP))
    assert harness.run("follow-nvr") == 0
    assert "fallo 1 de 2" in harness.output
    assert state_of(harness).fail_count == 1
    assert harness.runtime.net.swept == []
    assert env_value(harness, "NVR_HOST") == OLD_IP


def test_two_failures_with_a_single_candidate_follow_the_nvr(harness: Harness, tmp_path: Path) -> None:
    server, dropin = relay(harness, tmp_path)
    env_before = (harness.etc / vr.ENV_FILE).read_text(encoding="utf-8")
    runner = FakeFfprobe({}, default=ok)
    harness.runtime.runner = runner
    harness.runtime.net = moved_net(vr.Neighbor(OLD_IP, NVR_MAC, ("STALE",)), reachable(NEW_IP), reachable("192.0.2.30", "02:00:00:00:00:30"))
    assert harness.run("follow-nvr") == 0  # fallo 1
    assert harness.run("follow-nvr") == 0  # fallo 2: barre y sigue
    output = harness.output
    assert harness.runtime.net.swept and len(harness.runtime.net.swept[0]) == 253
    # relay.env: solo cambió NVR_HOST (escritura atómica con update_env_text).
    after = (harness.etc / vr.ENV_FILE).read_text(encoding="utf-8")
    assert after == env_before.replace(f"NVR_HOST='{OLD_IP}'", f"NVR_HOST='{NEW_IP}'")
    if os.name == "posix":
        assert stat.S_IMODE((harness.etc / vr.ENV_FILE).stat().st_mode) == 0o600
    # El flujo de apply: probe con credenciales contra la IP NUEVA, config y drop-in.
    assert f"@{NEW_IP}:{PORT}/" in runner.calls[-1][0][-1]
    config = vr.parse_rendered_config(config_text(harness))
    assert config is not None and all(f"@{NEW_IP}:" in spec["source"] for spec in config["paths"].values())
    assert f"{NEW_IP}/32" in dropin.read_text(encoding="utf-8") and f"{OLD_IP}/32" not in dropin.read_text(encoding="utf-8")
    assert f"se movió de {OLD_IP} a {NEW_IP}" in output and "entrada vieja de ARP" in output
    state = state_of(harness)
    assert state.fail_count == 0 and state.changes_today == 1 and state.last_change.endswith(f"{OLD_IP} -> {NEW_IP}")
    assert_no_secret(output)


def test_no_candidate(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    harness.runtime.net = moved_net(open_ips=())
    harness.run("follow-nvr")
    assert harness.run("follow-nvr") == vr.EXIT_NVR_NOT_FOUND
    assert "no se encontró el NVR" in harness.output
    assert env_value(harness, "NVR_HOST") == OLD_IP


def test_mac_seen_but_not_answering_is_not_a_candidate(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    harness.runtime.net = moved_net(vr.Neighbor(NEW_IP, NVR_MAC, ("STALE",)), open_ips=())
    harness.run("follow-nvr")
    assert harness.run("follow-nvr") == vr.EXIT_NVR_NOT_FOUND
    assert f"se ve sin responder en {NEW_IP}" in harness.output
    assert "posible suplantación" not in harness.output  # STALE: entrada vieja, sin aviso


def test_mac_at_a_third_ip_is_flagged_but_the_real_nvr_is_followed(harness: Harness, tmp_path: Path) -> None:
    # La MAC en una IP que no es la anterior ni la nueva y que no sirve el puerto:
    # se sigue al que pasa el probe y se avisa (otra mudanza vieja o un impostor).
    relay(harness, tmp_path)
    harness.runtime.runner = FakeFfprobe({}, default=ok)
    harness.runtime.net = moved_net(vr.Neighbor(OLD_IP, NVR_MAC, ("STALE",)), vr.Neighbor("192.0.2.99", NVR_MAC, ("STALE",)), reachable(NEW_IP))
    harness.run("follow-nvr")
    assert harness.run("follow-nvr") == 0
    output = harness.output
    assert env_value(harness, "NVR_HOST") == NEW_IP
    assert f"figura en {OLD_IP} sin responder (entrada vieja de ARP de la IP anterior)" in output
    [warning] = [line for line in output.splitlines() if "suplanta" in line]
    assert "también figura en 192.0.2.99, sin responder en el puerto" in warning and OLD_IP not in warning


def test_mac_answering_arp_but_not_the_port_warns_and_changes_nothing(harness: Harness, tmp_path: Path) -> None:
    # Visto con un impostor real con la MAC del NVR en un bridge de Linux: la tabla
    # MAC del switch oscila y el NVR verdadero queda invisible durante el barrido.
    relay(harness, tmp_path)
    harness.runtime.runner = FakeFfprobe({})  # no debe probar
    harness.runtime.net = moved_net(reachable(NEW_IP), open_ips=())
    harness.run("follow-nvr")
    assert harness.run("follow-nvr") == vr.EXIT_NVR_NOT_FOUND
    assert f"{NEW_IP} contesta ARP con la MAC del NVR pero no el puerto {PORT}" in harness.output
    assert "posible suplantación ARP" in harness.output
    assert env_value(harness, "NVR_HOST") == OLD_IP and state_of(harness).changes_today == 0


@pytest.mark.parametrize("open_ips", [(), (NEW_IP,)])
def test_failed_neighbor_entries_are_never_sightings(harness: Harness, tmp_path: Path, open_ips: tuple[str, ...]) -> None:
    # El kernel puede conservar la lladdr vieja en una entrada FAILED: no es una
    # MAC vista (ni candidato, aunque alguien responda TCP en esa IP).
    relay(harness, tmp_path)
    harness.runtime.net = moved_net(vr.Neighbor(NEW_IP, NVR_MAC, ("FAILED",)), open_ips=open_ips)
    harness.run("follow-nvr")
    assert harness.run("follow-nvr") == vr.EXIT_NVR_NOT_FOUND
    assert "se ve sin responder" not in harness.output
    assert env_value(harness, "NVR_HOST") == OLD_IP


def test_nvr_back_at_the_same_ip_after_the_sweep_resets_the_counter(harness: Harness, tmp_path: Path) -> None:
    # Responde en el puerto, pero su MAC no estaba en ip neigh; tras el barrido sí.
    relay(harness, tmp_path)
    vr.save_follow_state(harness.context().follow_state_path(), vr.FollowState(fail_count=1))
    harness.runtime.net = FakeNet(open={(OLD_IP, PORT)}, neigh=[], after_sweep=[reachable(OLD_IP)])
    assert harness.run("follow-nvr") == 0
    assert "no se ve su MAC en ip neigh" in harness.output and f"sigue en {OLD_IP}:{PORT}" in harness.output
    assert harness.runtime.net.swept
    state = state_of(harness)
    assert state.fail_count == 0 and state.changes_today == 0
    assert env_value(harness, "NVR_HOST") == OLD_IP


@pytest.mark.parametrize(
    ("after", "open_ips"),
    [
        ((reachable(NEW_IP), reachable("192.0.2.78")), (NEW_IP, "192.0.2.78")),  # dos responden
        ((reachable(NEW_IP), reachable("192.0.2.78")), (NEW_IP,)),  # la otra confirmada por ARP aunque no sirva RTSP
    ],
)
def test_mac_in_two_ips_alerts_and_changes_nothing(harness: Harness, tmp_path: Path, after: tuple[vr.Neighbor, ...], open_ips: tuple[str, ...]) -> None:
    server, dropin = relay(harness, tmp_path)
    before = (harness.etc / vr.ENV_FILE).read_bytes(), config_text(harness), dropin.read_text(encoding="utf-8")
    harness.runtime.runner = FakeFfprobe({})  # no debe probar nada
    harness.runtime.net = moved_net(*after, open_ips=open_ips)
    harness.run("follow-nvr")
    assert harness.run("follow-nvr") == vr.EXIT_MAC_DUPLICATE
    assert "ALERTA" in harness.output and "posible suplantación ARP" in harness.output
    assert ((harness.etc / vr.ENV_FILE).read_bytes(), config_text(harness), dropin.read_text(encoding="utf-8")) == before
    assert state_of(harness).changes_today == 0  # no cuenta como cambio


def test_daily_limit(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    today = vr.time.strftime("%Y-%m-%d", vr.time.localtime(harness.runtime.wall_time()))
    vr.save_follow_state(harness.context().follow_state_path(), vr.FollowState(fail_count=1, day=today, changes_today=3))
    harness.runtime.net = moved_net(reachable(NEW_IP))
    assert harness.run("follow-nvr") == vr.EXIT_DAILY_LIMIT
    assert "ya se hicieron los 3 cambios" in harness.output
    assert harness.runtime.net.swept == []
    assert env_value(harness, "NVR_HOST") == OLD_IP


def test_daily_counter_resets_on_a_new_day(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    vr.save_follow_state(harness.context().follow_state_path(), vr.FollowState(fail_count=1, day="2000-01-01", changes_today=3))
    harness.runtime.runner = FakeFfprobe({}, default=ok)
    harness.runtime.net = moved_net(reachable(NEW_IP))
    assert harness.run("follow-nvr") == 0
    assert env_value(harness, "NVR_HOST") == NEW_IP
    assert state_of(harness).changes_today == 1


def today_of(harness: Harness) -> str:
    return vr.time.strftime("%Y-%m-%d", vr.time.localtime(harness.runtime.wall_time()))


def test_failed_attempts_do_not_spend_changes_but_are_capped(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    limit = vr.FOLLOW_MAX_ATTEMPTS_PER_DAY
    vr.save_follow_state(harness.context().follow_state_path(), vr.FollowState(fail_count=1, day=today_of(harness), attempts_today=limit - 1))
    harness.runtime.runner = FakeFfprobe({}, default=unauthorized)
    harness.runtime.net = moved_net(reachable(NEW_IP))
    assert harness.run("follow-nvr") == vr.EXIT_PROBE_FAILED  # el último intento falla y se revierte
    state = state_of(harness)
    assert (state.attempts_today, state.changes_today) == (limit, 0)
    assert f"intento {limit} de {limit} hoy" in harness.output
    swept = len(harness.runtime.net.swept)
    assert harness.run("follow-nvr") == vr.EXIT_DAILY_LIMIT  # tope de intentos: ni barre ni prueba
    assert f"ya se hicieron los {limit} intentos de cambio de IP de hoy" in harness.output
    assert len(harness.runtime.net.swept) == swept
    assert env_value(harness, "NVR_HOST") == OLD_IP


def test_a_reverted_attempt_then_a_successful_change(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    vr.save_follow_state(harness.context().follow_state_path(), vr.FollowState(fail_count=1, day=today_of(harness), changes_today=2))
    harness.runtime.net = moved_net(reachable(NEW_IP))
    harness.runtime.runner = FakeFfprobe({}, default=unauthorized)
    assert harness.run("follow-nvr") == vr.EXIT_PROBE_FAILED
    harness.runtime.runner = FakeFfprobe({}, default=ok)
    assert harness.run("follow-nvr") == 0  # 2 cambios + 1 revertido: el 3.er cambio sigue disponible
    state = state_of(harness)
    assert (state.changes_today, state.attempts_today, state.fail_count) == (3, 2, 0)
    assert env_value(harness, "NVR_HOST") == NEW_IP
    assert "(cambio 3 de 3 hoy)" in harness.output


def test_attempts_reset_on_a_new_day(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    limit = vr.FOLLOW_MAX_ATTEMPTS_PER_DAY
    vr.save_follow_state(
        harness.context().follow_state_path(),
        vr.FollowState(fail_count=1, day="2000-01-01", changes_today=vr.FOLLOW_MAX_CHANGES_PER_DAY, attempts_today=limit),
    )
    harness.runtime.runner = FakeFfprobe({}, default=ok)
    harness.runtime.net = moved_net(reachable(NEW_IP))
    assert harness.run("follow-nvr") == 0
    state = state_of(harness)
    assert (state.changes_today, state.attempts_today) == (1, 1)


def test_replaced_nvr_on_the_same_ip_points_to_relearn_mac(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    replaced = "02:00:00:00:00:42"
    harness.runtime.runner = FakeFfprobe({})  # no debe probar
    harness.runtime.net = FakeNet(open={(OLD_IP, PORT)}, neigh=[reachable(OLD_IP, replaced)], after_sweep=[reachable(OLD_IP, replaced)])
    assert harness.run("follow-nvr") == 0
    assert harness.run("follow-nvr") == vr.EXIT_NVR_NOT_FOUND
    assert f"en {OLD_IP} responde otro equipo (MAC {replaced})" in harness.output
    assert "apply --relearn-mac" in harness.output
    assert env_value(harness, "NVR_MAC") == NVR_MAC and env_value(harness, "NVR_HOST") == OLD_IP


def test_lock_busy_does_nothing(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    harness.runtime.net = moved_net(reachable(NEW_IP))
    with vr.relay_lock(harness.etc):
        assert harness.run("follow-nvr") == vr.EXIT_BUSY
    assert "en curso" in harness.output and "follow-nvr (el timer" in harness.output
    assert "AVISO: hay otro" in harness.output and "ERROR" not in harness.output  # no es un error
    assert harness.runtime.net.tcp_calls == []
    assert state_of(harness).fail_count == 0


def test_probe_failure_on_the_new_ip_restores_nvr_host(harness: Harness, tmp_path: Path) -> None:
    server, dropin = relay(harness, tmp_path)
    before = config_text(harness), dropin.read_text(encoding="utf-8")
    harness.runtime.runner = FakeFfprobe({}, default=unauthorized)
    harness.runtime.net = moved_net(reachable(NEW_IP))
    harness.run("follow-nvr")
    assert harness.run("follow-nvr") == vr.EXIT_PROBE_FAILED
    assert env_value(harness, "NVR_HOST") == OLD_IP
    assert (config_text(harness), dropin.read_text(encoding="utf-8")) == before
    assert f"se restauró NVR_HOST={OLD_IP}" in harness.output
    state = state_of(harness)
    assert state.changes_today == 0 and state.attempts_today == 1  # el intento revertido no gasta un cambio
    assert_no_secret(harness.output)


def test_apply_rollback_on_the_new_ip_restores_nvr_host(harness: Harness, tmp_path: Path) -> None:
    server, dropin = relay(harness, tmp_path)
    before = config_text(harness), dropin.read_text(encoding="utf-8")
    server.rejects = lambda config: NEW_IP in json.dumps(config)
    harness.runtime.runner = FakeFfprobe({}, default=ok)
    harness.runtime.net = moved_net(reachable(NEW_IP))
    harness.run("follow-nvr")
    assert harness.run("follow-nvr") == vr.EXIT_ROLLED_BACK
    assert env_value(harness, "NVR_HOST") == OLD_IP
    assert (config_text(harness), dropin.read_text(encoding="utf-8")) == before


def test_other_device_on_the_old_ip_counts_as_failure(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    harness.runtime.net = FakeNet(open={(OLD_IP, PORT)}, neigh=[reachable(OLD_IP, "02:00:00:00:00:99")])
    assert harness.run("follow-nvr") == 0
    assert "responde otro equipo (MAC 02:00:00:00:00:99)" in harness.output
    assert state_of(harness).fail_count == 1


def test_without_mac_never_learns_it_from_a_bare_tcp(harness: Harness, tmp_path: Path) -> None:
    # Ancla de confianza: un TCP sin credenciales no prueba que sea el NVR.
    relay(harness, tmp_path, mac=None)
    harness.runtime.net = FakeNet(open={(OLD_IP, PORT)}, neigh=[reachable(OLD_IP)])
    assert harness.run("follow-nvr") == vr.EXIT_NVR_NOT_FOUND
    assert env_value(harness, "NVR_MAC") is None
    assert "AVISO: follow-nvr: falta NVR_MAC" in harness.output
    assert "Configuración → Red → TCP/IP" in harness.output and "sudo vigilia-relay apply" in harness.output
    assert harness.runtime.net.tcp_calls == [] and harness.runtime.net.swept == []


def test_without_mac_and_without_nvr(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path, mac=None)
    harness.runtime.net = FakeNet()
    assert harness.run("follow-nvr") == vr.EXIT_NVR_NOT_FOUND
    assert "falta NVR_MAC" in harness.output and env_value(harness, "NVR_MAC") is None


def test_without_nvr_configured(harness: Harness) -> None:
    write_env(harness.etc, READER_ALLOWED_IPS="100.101.102.103")
    assert harness.run("follow-nvr") == 0
    assert "nada que seguir" in harness.output


def test_corrupt_state_is_tolerated(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    path = harness.context().follow_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{esto no es json", encoding="utf-8")
    harness.runtime.net = FakeNet(open={(OLD_IP, PORT)}, neigh=[reachable(OLD_IP)])
    assert harness.run("follow-nvr") == 0
    assert "corrupto" in harness.output
    assert state_of(harness) == vr.FollowState(day=state_of(harness).day)


def test_unwritable_state_is_reported(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    blocker = tmp_path / "sd-rota"
    blocker.write_text("", encoding="utf-8")
    harness.runtime.state_dir = lambda etc: blocker / "state"
    harness.runtime.net = FakeNet(open={(OLD_IP, PORT)}, neigh=[reachable(OLD_IP)])
    assert harness.run("follow-nvr") == vr.EXIT_STORAGE
    assert "no se pudo guardar el estado" in harness.output


def test_no_change_when_the_state_cannot_be_saved_before_changing(harness: Harness, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    relay(harness, tmp_path)
    vr.save_follow_state(harness.context().follow_state_path(), vr.FollowState(fail_count=1))
    monkeypatch.setattr(vr, "save_follow_state", lambda path, state: False)
    harness.runtime.runner = FakeFfprobe({})  # no debe probar
    harness.runtime.net = moved_net(reachable(NEW_IP))
    assert harness.run("follow-nvr") == vr.EXIT_STORAGE
    assert "no se cambia la IP" in harness.output
    assert env_value(harness, "NVR_HOST") == OLD_IP


@pytest.mark.parametrize(
    ("show", "expected"),
    [
        ("Result=exit-code\nExecMainStatus=10\nExecMainExitTimestamp=Sun 2026-10-18 21:52:00 -03\n",
         "exit 10 (NVR no encontrado o falta NVR_MAC), Result=exit-code, Sun 2026-10-18 21:52:00 -03"),
        ("ExecMainStatus=8\nResult=success\nExecMainExitTimestamp=Sun 2026-10-18 21:57:00 -03\n",
         "exit 8 (lock ocupado: no hizo nada), Result=success, Sun 2026-10-18 21:57:00 -03"),
        ("Result=success\nExecMainStatus=0\nExecMainExitTimestamp=\n", "todavía no corrió desde el arranque"),
        ("Result=success\nExecMainStatus=0\nExecMainExitTimestamp=n/a\n", "todavía no corrió desde el arranque"),
        ("Result=success\nExecMainStatus=77\nExecMainExitTimestamp=Sun 2026-10-18 22:00:00 -03\n", "exit 77, Result=success, Sun 2026-10-18 22:00:00 -03"),
    ],
)
def test_describe_follow_run(show: str, expected: str) -> None:
    assert vr.describe_follow_run(show) == expected


def test_status_shows_the_last_follow_run(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    calls: list[list[str]] = []

    def command(argv: list[str], timeout: float) -> subprocess.CompletedProcess[str] | None:
        calls.append(list(argv))
        if argv[:2] == ["systemctl", "show"] and argv[-1] == vr.FOLLOW_SERVICE_UNIT:
            out = "Result=exit-code\nExecMainStatus=9\nExecMainExitTimestamp=Sun 2026-10-18 21:52:00 -03\n"
            return subprocess.CompletedProcess(argv, 0, out, "")
        return None

    harness.runtime.command = command
    vr.save_follow_state(
        harness.context().follow_state_path(), vr.FollowState(fail_count=2, day=today_of(harness), changes_today=1, attempts_today=4)
    )
    harness.run("status")
    assert "última pasada de follow-nvr: exit 9 (ALERTA: MAC del NVR en 2+ IPs), Result=exit-code" in harness.output
    assert "hoy 1 de 3 cambio(s) de IP y 4 de 12 intento(s)" in harness.output
    assert any(argv[-1] == vr.FOLLOW_SERVICE_UNIT for argv in calls)


def test_status_shows_mac_and_follow_state(harness: Harness, tmp_path: Path) -> None:
    relay(harness, tmp_path)
    vr.save_follow_state(harness.context().follow_state_path(), vr.FollowState(fail_count=1, changes_today=1, last_change="hoy: a -> b"))
    assert harness.run("status") == 0
    assert f"NVR_MAC {NVR_MAC}" in harness.output and "1 fallo(s) seguidos" in harness.output and "hoy: a -> b" in harness.output


class _CountingStream:
    def __init__(self) -> None:
        self.lines: list[str] = []
        self.flushes = 0

    def write(self, text: str) -> int:
        self.lines.append(text)
        return len(text)

    def flush(self) -> None:
        self.flushes += 1


def test_console_flushes_every_line_so_the_journal_keeps_the_order() -> None:
    out, err = _CountingStream(), _CountingStream()
    console = vr.Console(vr.Runtime(stdout=out, stderr=err))  # type: ignore[arg-type]
    console.info("uno")
    console.warn("dos")
    console.info("tres")
    console.error("cuatro")
    console.reveal("cinco")
    assert out.flushes == 3 and err.flushes == 2


@pytest.mark.skipif(os.name != "posix", reason="require_root solo aplica en POSIX")
def test_follow_nvr_requires_root_on_the_pi(harness: Harness, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    relay(harness, tmp_path)
    monkeypatch.setattr(vr, "DEFAULT_ETC_DIR", str(harness.etc))
    harness.runtime.is_root = lambda: False
    harness.runtime.net = FakeNet(open={(OLD_IP, PORT)}, neigh=[reachable(OLD_IP)])
    assert harness.run("follow-nvr") == vr.EXIT_ERROR
    assert "córrelo con sudo" in harness.output
    assert harness.runtime.net.tcp_calls == []
