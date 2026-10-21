"""Coherencia del kit: install.sh conoce todas las unidades y las propiedades
que el código asume están en las unidades (sin systemd: solo el texto)."""

from __future__ import annotations

import re
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]


def unit(name: str) -> dict[str, list[str]]:
    values: dict[str, list[str]] = {}
    for line in (KIT / "systemd" / name).read_text(encoding="utf-8").splitlines():
        if line and not line.startswith(("#", "[")) and "=" in line:
            key, _, value = line.partition("=")
            values.setdefault(key, []).append(value)
    return values


def test_install_sh_installs_every_unit() -> None:
    install = (KIT / "install.sh").read_text(encoding="utf-8")
    for path in sorted((KIT / "systemd").iterdir()):
        # La copia del kit, el chequeo de archivos y la instalación de unidades.
        assert install.count(f"systemd/{path.name}") >= 2, path.name
        assert re.search(rf"\b{re.escape(path.name)}\b", install.split("install_units()", 1)[1]), path.name
    assert "vigilia-relay-follow-nvr.timer" in install and 'systemctl enable "$timer"' in install


def test_follow_nvr_unit_contract() -> None:
    service = unit("vigilia-relay-follow-nvr.service")
    assert service["ExecStart"] == ["/usr/local/bin/vigilia-relay follow-nvr"]
    assert service["Type"] == ["oneshot"]
    assert service["SuccessExitStatus"] == ["8"]  # lock ocupado no es un fallo
    assert service["ReadWritePaths"] == ["/etc/vigilia-relay -/etc/systemd/system/vigilia-relay.service.d"]
    assert service["StateDirectory"] == ["vigilia-relay"]
    assert set(service["CapabilityBoundingSet"][0].split()) == {"CAP_NET_RAW", "CAP_SETUID", "CAP_SETGID", "CAP_CHOWN"}
    assert service["IPAddressAllow"] == ["localhost 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16"]
    assert service["IPAddressDeny"] == ["any"]
    assert service["NoNewPrivileges"] == ["yes"] and service["ProtectSystem"] == ["strict"]
    timer = unit("vigilia-relay-follow-nvr.timer")
    assert timer["OnBootSec"] == ["3min"] and timer["OnUnitActiveSec"] == ["5min"]


def test_follow_nvr_unit_explains_every_capability() -> None:
    lines = (KIT / "systemd" / "vigilia-relay-follow-nvr.service").read_text(encoding="utf-8").splitlines()
    comments = "\n".join(line for line in lines if line.startswith("#"))
    caps = unit("vigilia-relay-follow-nvr.service")["CapabilityBoundingSet"][0].split()
    for cap in caps:
        assert re.search(rf"^# - {cap}\b|^# - .*\b{cap}\b.*:", comments, re.MULTILINE), cap


def test_relay_unit_base_allowlist_is_fail_closed() -> None:
    service = unit("vigilia-relay.service")
    assert service["IPAddressAllow"] == ["localhost 100.64.0.0/10 fd7a:115c:a1e0::/48"]
    assert service["Restart"] == ["always"]


def test_readme_documents_follow_nvr() -> None:
    readme = (KIT / "README.md").read_text(encoding="utf-8")
    assert "### IP del NVR por DHCP: seguimiento automático" in readme
    assert "journalctl -u vigilia-relay-follow-nvr" in readme
    for code in ("| 9 |", "| 10 |", "| 11 |"):
        assert code in readme
