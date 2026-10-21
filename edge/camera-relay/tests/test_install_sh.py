"""install.sh: limpieza de las copias de la clave del Wi-Fi y de cloud-init.

Carga install.sh con `source` (no corre main) en bash, con las rutas apuntando a
una carpeta temporal y las dependencias del sistema reemplazadas por funciones:
eth0_is_primary (ip route) y netplan. La prueba con el netplan real y systemd es
la del contenedor (README, "Desarrollo"). Todas las claves son FALSAS.
"""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
from pathlib import Path

import pytest

KIT = Path(__file__).resolve().parents[1]
INSTALL = KIT / "install.sh"
BASH = shutil.which("bash")

pytestmark = pytest.mark.skipif(os.name != "posix" or BASH is None, reason="install.sh: solo POSIX con bash")

WIFI_PSK = "wifi-FALSA-de-prueba"

# Un netplan de mentira para la verificación: `get --root-dir R clave` devuelve las
# líneas de esa clave a nivel `network:` (2 espacios) de los YAML bajo R.
FAKE_NETPLAN = r"""
netplan() {
    [[ "$1" == get && "$2" == --root-dir ]] || return 2
    if [[ -n "${NETPLAN_BROKEN:-}" ]]; then return 1; fi
    find "$3" -name '*.yaml' -exec grep -h -E "^  $4:" {} + 2> /dev/null | sort
    return 0
}
"""


def keyfile(path: Path, kind: str, *, iface: str | None = None, extra: str = "") -> Path:
    lines = ["[connection]", f"id={path.stem}", f"type={kind}"]
    if iface:
        lines.append(f"interface-name={iface}")
    path.write_text("\n".join(lines) + "\n" + extra, encoding="utf-8")
    return path


WIFI_ONLY = f"""network:
  version: 2
  wifis:
    NM-1234:
      renderer: NetworkManager
      access-points:
        "MiCasa":
          auth:
            password: "{WIFI_PSK}"
"""
WIFI_ONLY_PLAIN = f"""network:
  version: 2
  wifis:
    wlan0:
      access-points:
        "MiCasa":
          password: "{WIFI_PSK}"
"""
WIFI_WITH_GLOBAL_RENDERER = f"""network:
  version: 2
  renderer: NetworkManager
  wifis:
    wlan0:
      access-points:
        "MiCasa":
          password: "{WIFI_PSK}"
"""
MIXED = f"""network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true
  wifis:
    wlan0:
      access-points:
        "MiCasa":
          password: "{WIFI_PSK}"
"""
ETH0_ONLY = """network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true
"""


class Tree:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.nm = root / "etc" / "NetworkManager" / "system-connections"
        self.netplan = root / "etc" / "netplan"
        self.cloud = root / "var" / "lib" / "cloud"
        self.logs = [root / "var" / "log" / "cloud-init.log", root / "var" / "log" / "cloud-init-output.log"]
        for directory in (self.nm, self.netplan, self.cloud, self.logs[0].parent):
            directory.mkdir(parents=True, exist_ok=True)

    def run(self, script: str, *, eth0_primary: bool = True, netplan: bool = False, env: dict[str, str] | None = None) -> tuple[int, int, str]:
        q = shlex.quote
        prelude = "\n".join(
            [
                f"source {q(str(INSTALL))}",
                f"NM_CONNECTIONS_DIR={q(str(self.nm))}",
                f"NETPLAN_DIR={q(str(self.netplan))}",
                "NETPLAN_OTHER_DIRS=()",  # el /run/netplan o /lib/netplan del runner no cuentan
                f"CLOUD_STATE_DIR={q(str(self.cloud))}",
                f"CLOUD_LOGS=({' '.join(q(str(log)) for log in self.logs)})",
                "eth0_is_primary() { return %d; }" % (0 if eth0_primary else 1),
                "netplan_available() { return %d; }" % (0 if netplan else 1),
                FAKE_NETPLAN,
            ]
        )
        epilogue = '\necho "RESULT $CHANGES $WIFI_LEFT"\n'
        completed = subprocess.run(
            [BASH or "bash", "-c", prelude + "\n" + script + epilogue],
            capture_output=True,
            text=True,
            timeout=60,
            env={**os.environ, **(env or {})},
            check=False,
        )
        assert completed.returncode == 0, completed.stderr + completed.stdout
        result = [line for line in completed.stdout.splitlines() if line.startswith("RESULT ")][-1].split()
        return int(result[1]), int(result[2]), completed.stdout + completed.stderr


@pytest.fixture
def tree(tmp_path: Path) -> Tree:
    return Tree(tmp_path)


def test_nm_connection_key_reads_only_the_connection_section(tree: Tree) -> None:
    wifi = keyfile(tree.nm / "MiCasa.nmconnection", "wifi", iface="wlan0", extra=f"[wifi-security]\nkey-mgmt=wpa-psk\npsk={WIFI_PSK}\n")
    spaced = tree.nm / "spaced.nmconnection"
    spaced.write_text("[vpn]\ntype=wifi\n\n[ connection ]\n  type = 802-11-wireless \n", encoding="utf-8")
    vpn = tree.nm / "vpn.nmconnection"
    vpn.write_text("[connection]\ntype=vpn\n[vpn]\ntype=wifi\n", encoding="utf-8")
    script = "\n".join(f"echo \"[$(nm_connection_key {shlex.quote(str(p))} type)]\"" for p in (wifi, spaced, vpn))
    _, _, output = tree.run(script + f"\necho \"[$(nm_connection_key {shlex.quote(str(wifi))} interface-name)]\"")
    assert output.splitlines()[:4] == ["[wifi]", "[802-11-wireless]", "[vpn]", "[wlan0]"]


def test_wifi_copies_are_removed_and_eth0_survives(tree: Tree) -> None:
    wifi = keyfile(tree.nm / "MiCasa.nmconnection", "wifi", iface="wlan0", extra=f"[wifi-security]\npsk={WIFI_PSK}\n")
    legacy = keyfile(tree.nm / "preconfigured.nmconnection", "802-11-wireless", extra=f"[wifi-security]\npsk={WIFI_PSK}\n")
    wired = keyfile(tree.nm / "Wired connection 1.nmconnection", "ethernet", iface="eth0")
    odd = keyfile(tree.nm / "odd.nmconnection", "wifi", iface="eth0")  # nombra a eth0: no se toca
    vpn = tree.nm / "vpn.nmconnection"
    vpn.write_text("[connection]\ntype=vpn\n[vpn]\ntype=wifi\n", encoding="utf-8")
    wifi_only = tree.netplan / "90-NM-1234.yaml"
    wifi_only.write_text(WIFI_ONLY_PLAIN, encoding="utf-8")
    mixed = tree.netplan / "50-cloud-init.yaml"
    mixed.write_text(MIXED, encoding="utf-8")
    eth0 = tree.netplan / "01-eth0.yaml"
    eth0.write_text(ETH0_ONLY, encoding="utf-8")
    changes, left, output = tree.run("remove_wifi_profiles")
    assert not wifi.exists() and not legacy.exists() and not wifi_only.exists()
    assert wired.exists() and odd.exists() and vpn.exists() and mixed.exists() and eth0.exists()
    assert eth0.read_text(encoding="utf-8") == ETH0_ONLY and mixed.read_text(encoding="utf-8") == MIXED
    assert (changes, left) == (3, 1)
    assert f"No se toca {mixed}: además del Wi-Fi configura eth0" in output
    assert "Copias de la clave del Wi-Fi" in output
    assert WIFI_PSK not in output
    # Idempotente: la segunda corrida no borra nada más y sigue avisando del mixto.
    changes, left, output = tree.run("remove_wifi_profiles")
    assert (changes, left) == (0, 1) and f"No se toca {mixed}" in output


def test_nothing_is_removed_when_eth0_is_not_the_primary_interface(tree: Tree) -> None:
    wifi = keyfile(tree.nm / "MiCasa.nmconnection", "wifi", iface="wlan0")
    wifi_only = tree.netplan / "90-NM-1234.yaml"
    wifi_only.write_text(WIFI_ONLY, encoding="utf-8")
    changes, left, output = tree.run("remove_wifi_profiles", eth0_primary=False)
    assert wifi.exists() and wifi_only.exists()
    assert (changes, left) == (0, 1)
    assert "no se borran los perfiles Wi-Fi" in output


def test_without_netplan_a_wifi_yaml_with_a_renderer_is_kept(tree: Tree) -> None:
    global_renderer = tree.netplan / "10-global.yaml"
    global_renderer.write_text(WIFI_WITH_GLOBAL_RENDERER, encoding="utf-8")
    changes, left, output = tree.run("remove_wifi_profiles", netplan=False)
    assert global_renderer.exists() and (changes, left) == (0, 1)
    assert "fija un renderer" in output


def test_netplan_verifies_that_the_rest_of_the_config_does_not_change(tree: Tree) -> None:
    # 90-NM: su renderer es del dispositivo Wi-Fi -> se borra. 10-global: es el
    # renderer global del que depende 01-eth0 -> sin él cambiaría eth0 -> se queda.
    (tree.netplan / "01-eth0.yaml").write_text(ETH0_ONLY, encoding="utf-8")
    wifi_only = tree.netplan / "90-NM-1234.yaml"
    wifi_only.write_text(WIFI_ONLY, encoding="utf-8")
    global_renderer = tree.netplan / "10-global.yaml"
    global_renderer.write_text(WIFI_WITH_GLOBAL_RENDERER, encoding="utf-8")
    changes, left, output = tree.run("remove_wifi_profiles", netplan=True)
    assert not wifi_only.exists() and global_renderer.exists()
    assert (changes, left) == (1, 1)
    assert "netplan verificó que eth0 y el resto no cambian" in output
    assert f"No se toca {global_renderer}: sin él cambiaría la config de red" in output


def test_netplan_unreadable_config_removes_nothing(tree: Tree) -> None:
    wifi_only = tree.netplan / "90-NM-1234.yaml"
    wifi_only.write_text(WIFI_ONLY, encoding="utf-8")
    changes, left, output = tree.run("remove_wifi_profiles", netplan=True, env={"NETPLAN_BROKEN": "1"})
    assert wifi_only.exists() and (changes, left) == (0, 1)
    assert "netplan no pudo leer la config de red" in output


def test_cloud_init_data_and_logs_are_removed(tree: Tree) -> None:
    instance = tree.cloud / "instances" / "rpi-imager-1"
    instance.mkdir(parents=True)
    (instance / "user-data.txt").write_text("#cloud-config\npasswd: $6$FALSO\n", encoding="utf-8")
    (instance / "network-config.json").write_text(f'{{"password": "{WIFI_PSK}"}}', encoding="utf-8")
    (tree.cloud / "instance").symlink_to(instance)
    for log in tree.logs:
        log.write_text("log FALSO\n", encoding="utf-8")
    changes, _, _ = tree.run("remove_cloud_init_data")
    assert tree.cloud.is_dir() and list(tree.cloud.iterdir()) == []
    assert not any(log.exists() for log in tree.logs)
    assert changes == 3
    changes, _, output = tree.run("remove_cloud_init_data")
    assert changes == 0 and "Borrad" not in output
