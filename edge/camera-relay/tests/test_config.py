"""Parseo y validación de relay.env y cameras.conf (sin shell, sin filtrar claves)."""

from __future__ import annotations

import pytest

from conftest import FAKE_NVR_PASS, nvr_env
import vigilia_relay as vr

LINE_SEPARATOR = chr(0x2028)  # U+2028: str.splitlines() corta ahí


# --- relay.env -----------------------------------------------------------------
def test_parse_env_basic_comments_quotes_bom_and_crlf() -> None:
    text = vr.BOM + "# comentario\r\nNVR_HOST=192.0.2.10\r\n\r\nNVR_USER = 'viewer'\r\nNVR_PASS=\"a b\"\r\n"
    assert vr.parse_env_text(text) == {"NVR_HOST": "192.0.2.10", "NVR_USER": "viewer", "NVR_PASS": "a b"}


def test_parse_env_value_keeps_everything_after_first_equals() -> None:
    assert vr.parse_env_text("NVR_PASS=a=b#c$d\n") == {"NVR_PASS": "a=b#c$d"}


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("NVR_HOST\n", "se esperaba CLAVE=valor"),
        ("nvr_host=x\n", "se esperaba CLAVE=valor"),
        ("NVR_HOTS=x\n", "clave desconocida NVR_HOTS"),
        ("NVR_HOST=a\nNVR_HOST=b\n", "repetida"),
        ("NVR_PASS=ab\x01c\n", "caracteres de control"),
    ],
)
def test_parse_env_errors(text: str, message: str) -> None:
    with pytest.raises(vr.ConfigError, match=message):
        vr.parse_env_text(text)


def test_parse_env_error_never_quotes_the_value() -> None:
    with pytest.raises(vr.ConfigError) as excinfo:
        vr.parse_env_text(f"NVR_PASS=x\nNVR_PASS={FAKE_NVR_PASS}\n")
    assert FAKE_NVR_PASS not in str(excinfo.value)
    with pytest.raises(vr.ConfigError) as excinfo:
        vr.parse_env_text(f"UNKNOWN_KEY_WITH_SECRET={FAKE_NVR_PASS}\n")
    assert FAKE_NVR_PASS not in str(excinfo.value)


def test_parse_env_does_not_split_on_unicode_line_separators() -> None:
    assert vr.parse_env_text(f"NVR_PASS=a{LINE_SEPARATOR}b\n") == {"NVR_PASS": f"a{LINE_SEPARATOR}b"}


@pytest.mark.parametrize(
    "value",
    [FAKE_NVR_PASS, "it's", "'quoted'", '"dq"', "  spaced  ", "#hash", "a=b", "$HOME", "\\back\\slash"],
)
def test_update_env_roundtrip_preserves_any_value(value: str) -> None:
    text = vr.update_env_text("# cabecera\nNVR_HOST=192.0.2.1\n", {"NVR_PASS": value})
    assert text.startswith("# cabecera\nNVR_HOST=192.0.2.1\n")
    assert vr.parse_env_text(text)["NVR_PASS"] == value


def test_update_env_replaces_in_place_and_removes() -> None:
    text = "# a\nNVR_HOST=192.0.2.1\n# NVR_USER=comentado\nNVR_USER=old\nRTSP_PORT=8554\n"
    updated = vr.update_env_text(text, {"NVR_USER": "new", "RTSP_PORT": None, "NVR_PORT": "554"})
    assert updated == "# a\nNVR_HOST=192.0.2.1\n# NVR_USER=comentado\nNVR_USER='new'\nNVR_PORT='554'\n"


def test_update_env_rejects_newlines() -> None:
    with pytest.raises(vr.ConfigError):
        vr.update_env_text("", {"NVR_PASS": "a\nNVR_HOST=evil"})


# --- settings ------------------------------------------------------------------
def test_settings_defaults_are_fail_closed() -> None:
    settings = vr.settings_from_env({})
    assert settings.nvr is None
    assert settings.nvr_channels == 11
    assert settings.rtsp_port == 8554
    assert settings.api_port == 9997
    # Sin READER_ALLOWED_IPS: solo loopback (nadie del tailnet).
    assert settings.reader_networks_defaulted is True
    assert settings.reader_networks == vr.LOOPBACK_NETWORKS


def test_settings_with_nvr_and_reader_ips() -> None:
    settings = vr.settings_from_env(nvr_env(READER_ALLOWED_IPS="100.101.102.103, fd7a:115c:a1e0::1/128 100.101.102.103"))
    assert settings.nvr == vr.NvrSettings("192.0.2.10", 554, "viewer", FAKE_NVR_PASS)
    assert settings.reader_networks == (
        "100.101.102.103/32",
        "fd7a:115c:a1e0::1/128",
        "127.0.0.1/32",
        "::1/128",
    )
    assert settings.reader_networks_defaulted is False
    assert settings.secrets == (FAKE_NVR_PASS,)


def test_networks_outside_tailscale() -> None:
    networks = ("100.101.102.103/32", "192.168.1.50/32", "fd7a:115c:a1e0::1/128", "2001:db8::1/128", "127.0.0.1/32", "::1/128")
    assert vr.networks_outside_tailscale(networks) == ["192.168.1.50/32", "2001:db8::1/128"]


def test_nvr_settings_repr_hides_password() -> None:
    settings = vr.settings_from_env(nvr_env())
    assert FAKE_NVR_PASS not in repr(settings)


@pytest.mark.parametrize("missing", ["NVR_HOST", "NVR_USER", "NVR_PASS"])
def test_partial_nvr_is_rejected(missing: str) -> None:
    values = nvr_env()
    del values[missing]
    with pytest.raises(vr.ConfigError, match=f"falta {missing}"):
        vr.settings_from_env(values)


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("192.168.1.64", "192.168.1.64"),
        ("fd00::10", "fd00::10"),
        ("FD00:0:0:0:0:0:0:10", "fd00::10"),
        ("[fd00::10]", "fd00::10"),
    ],
)
def test_valid_hosts_are_ip_literals(host: str, expected: str) -> None:
    assert vr.validate_ip_host(host) == expected


@pytest.mark.parametrize(
    "host",
    [
        "",
        "nvr.local",  # nombres no: con IPAddressDeny=any no hay DNS
        "NVR.local",
        "nvr_1",
        "fe80::1%eth0",  # zona
        "::ffff:10.0.0.5",  # IPv6 con IPv4 incrustada (MediaMTX la rechaza)
        "::ffff:a00:5",
        "64:ff9b::10.0.0.5",
        "::10.0.0.5",
        "v1.x",  # IPvFuture
        "192.168.001.010",  # ceros a la izquierda
        "1.2.3",
        "4294967295",
        "192.168.1.64:554",
        "user@nvr",
        "http://nvr",
    ],
)
def test_invalid_hosts(host: str) -> None:
    with pytest.raises(vr.ConfigError, match="usa la IP del equipo"):
        vr.validate_ip_host(host)


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("NVR_PORT", "0"),
        ("NVR_PORT", "65536"),
        ("NVR_PORT", "５５４"),  # dígitos de ancho completo: no
        ("NVR_CHANNELS", "0"),
        ("NVR_CHANNELS", "65"),
        ("NVR_CHANNELS", "²"),
        ("RTSP_PORT", "80"),
        ("API_PORT", "abc"),
    ],
)
def test_invalid_numbers(key: str, value: str) -> None:
    with pytest.raises(vr.ConfigError, match=key):
        vr.settings_from_env(nvr_env(**{key: value}))


def test_rtsp_and_api_port_must_differ() -> None:
    with pytest.raises(vr.ConfigError, match="mismo puerto"):
        vr.settings_from_env({"RTSP_PORT": "9000", "API_PORT": "9000"})


@pytest.mark.parametrize("value", ["100.64.0.0/10", "192.168.1.0/24", "fd7a:115c:a1e0::/48", "not-an-ip", "100.1.2.3/33"])
def test_reader_ips_must_be_single_hosts(value: str) -> None:
    with pytest.raises(vr.ConfigError, match="READER_ALLOWED_IPS"):
        vr.settings_from_env({"READER_ALLOWED_IPS": value})


def test_nvr_password_limits() -> None:
    with pytest.raises(vr.ConfigError, match="NVR_PASS supera"):
        vr.settings_from_env(nvr_env(NVR_PASS="x" * 129))


# --- cameras.conf ----------------------------------------------------------------
def test_parse_cameras_nvr_and_url() -> None:
    cameras = vr.parse_cameras_text(
        "# comentario\nporton nvr:3\n\npuerta_2 nvr:16\n  test-cam   url:rtsp://user:p%40ss@10.0.0.5:554/live  \n"
    )
    assert [(c.name, c.channel, c.url) for c in cameras] == [
        ("porton", 3, None),
        ("puerta_2", 16, None),
        ("test-cam", None, "rtsp://user:p%40ss@10.0.0.5:554/live"),
    ]
    assert "p%40ss" not in repr(cameras[2])


@pytest.mark.parametrize(
    ("line", "message"),
    [
        ("Porton nvr:1", "nombre de cámara inválido"),
        ("-porton nvr:1", "nombre de cámara inválido"),
        ("a" * 33 + " nvr:1", "nombre de cámara inválido"),
        ("cam² nvr:1", "nombre de cámara inválido"),
        ("ｃａｍ nvr:1", "nombre de cámara inválido"),
        ("porton-hd nvr:1", "reservado"),
        ("all nvr:1", "reservado por MediaMTX"),
        ("all_others nvr:1", "reservado por MediaMTX"),
        ("porton cam:192.168.1.10", "formato no soportado"),
        ("porton nvr:0", "canal inválido"),
        ("porton nvr:65", "canal inválido"),
        ("porton nvr:1x", "canal inválido"),
        ("porton nvr:", "canal inválido"),
        ("porton url:http://10.0.0.5/x", "rtsp://"),
        ("porton url:rtsp://10.0.0.5/$G1", "%24"),
        ("porton url:rtsp://10.0.0.5:99999/x", "puerto"),
        ("porton url:rtsp://cam.lan/x", "usa la IP del equipo"),
        ("porton url:rtsp:///x", "rtsp://"),
        ("porton nvr:1 extra", "se esperaba"),
        ("porton", "se esperaba"),
    ],
)
def test_parse_cameras_errors(line: str, message: str) -> None:
    with pytest.raises(vr.ConfigError, match=message):
        vr.parse_cameras_text(line + "\n")


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("rtsp://u:p%zz@10.0.0.5/x", "%XX válido"),
        ("rtsp://u:p%4@10.0.0.5/x", "%XX válido"),
        ("rtsp://u:p%@10.0.0.5/x", "%XX válido"),
        ("rtsp://u:p^x@10.0.0.5/x", "RFC 3986"),
        ('rtsp://u:p"x@10.0.0.5/x', "RFC 3986"),
        ("rtsp://u:p{x}@10.0.0.5/x", "RFC 3986"),
        ("rtsp://u:p|x@10.0.0.5/x", "RFC 3986"),
        ("rtsp://u:p\\x@10.0.0.5/x", "RFC 3986"),
        ("rtsp://u:p`x@10.0.0.5/x", "RFC 3986"),
        ("rtsp://u:p<x>@10.0.0.5/x", "RFC 3986"),
        ("rtsp://cámara.lan/x", "RFC 3986"),
        ("rtsp://u:p#x@10.0.0.5/x", "%23"),
        ("rtsp://u:p$x@10.0.0.5/x", "%24"),
        ("rtsp://u:p[x@10.0.0.5/x", "no es válida|caracteres no permitidos"),
        ("rtsp://host_name/x", "host de la URL"),
        ("rtsp://-bad.lan/x", "host de la URL"),
        ("rtsp://cam.lan/x", "usa la IP del equipo"),
        ("rtsp://[fd00::1%25eth0]/x", "host de la URL|no es válida"),
        ("rtsp://10.0.0.5:0/x", "puerto"),
        ("rtsp://10.0.0.5:55a4/x", "puerto"),
        ("rtsp://10.0.0.5:0000000554/x", "puerto"),
        ("rtsp://user@:554/x", "con host"),
        ("rtsp://ex ample/x", "espacios"),
        # Las tres clases que MediaMTX v1.15.2 rechaza imprimiendo la clave (cyber):
        ("RTSP://u:p@10.0.0.5/x", "en minúsculas"),
        ("Rtsp://u:p@10.0.0.5/x", "en minúsculas"),
        ("rtsps://u:p@[::ffff:10.0.0.5]/x", "IPv4 incrustada"),
        ("rtsp://u:p@[::ffff:a00:5]/x", "IPv4 incrustada"),
        ("rtsp://u:p@[64:ff9b::10.0.0.5]/x", "IPv4 incrustada"),
        ("rtsp://u:p@[v1.x]/x", "usa la IP del equipo|no es válida"),
        ("rtsp://u:p@[V7.ab]/x", "usa la IP del equipo|no es válida"),
        ("rtsp://u:p@[10.0.0.5]/x", "no es válida|no es una IP"),
        ("rtsp://u:p%00@10.0.0.5/x", "caracteres de control"),
        ("rtsp://u:p@192.168.001.010/x", "usa la IP del equipo"),
    ],
)
def test_url_validation_is_strict(url: str, message: str) -> None:
    with pytest.raises(vr.ConfigError, match=message) as excinfo:
        vr.validate_source_url(url)
    # Nunca cita la URL (puede traer la clave).
    assert "10.0.0.5" not in str(excinfo.value) and "u:p" not in str(excinfo.value)


@pytest.mark.parametrize(
    ("url", "canonical"),
    [
        ("rtsp://user:p%40ss@10.0.0.5:554/live", "rtsp://user:p%40ss@10.0.0.5:554/live"),
        ("rtsps://[FD00:0:0:0:0:0:0:1]:322/a?b=c&d=e", "rtsps://[fd00::1]:322/a?b=c&d=e"),
        # '@' crudo en el userinfo: Go corta en el último; se re-codifica.
        ("rtsp://u:a@b@10.0.0.5/x", "rtsp://u:a%40b@10.0.0.5/x"),
        ("rtsp://u:!&'()*+,;=._~-@10.0.0.5/x", "rtsp://u:%21%26%27%28%29%2A%2B%2C%3B%3D._~-@10.0.0.5/x"),
        ("rtsp://u:p@10.0.0.5:0554/a[b]?q=[1]", "rtsp://u:p@10.0.0.5:554/a%5Bb%5D?q=%5B1%5D"),
        ("rtsp://u@10.0.0.5:/x", "rtsp://u@10.0.0.5/x"),
        ("rtsp://:pw@10.0.0.5", "rtsp://:pw@10.0.0.5"),
        ("rtsp://10.0.0.5//Streaming/Channels/101?", "rtsp://10.0.0.5//Streaming/Channels/101"),
    ],
)
def test_url_is_reserialized_from_validated_parts(url: str, canonical: str) -> None:
    assert vr.validate_source_url(url) == canonical
    # Idempotente: la forma canónica valida a sí misma.
    assert vr.validate_source_url(canonical) == canonical


def test_url_reserialization_keeps_the_same_credentials() -> None:
    original = "rtsp://us%65r:Fa@ke:k%2F@10.0.0.5/x"
    canonical = vr.validate_source_url(original)
    assert canonical == "rtsp://user:Fa%40ke%3Ak%2F@10.0.0.5/x"
    for url in (original, canonical):
        userinfo = vr.urllib.parse.urlsplit(url).netloc.rpartition("@")[0]
        user, _, password = userinfo.partition(":")
        assert (vr.urllib.parse.unquote(user), vr.urllib.parse.unquote(password)) == ("user", "Fa@ke:k/")


def test_parse_cameras_rejects_duplicates_with_line_number() -> None:
    with pytest.raises(vr.ConfigError, match=r"línea 2: 'porton' está repetida"):
        vr.parse_cameras_text("porton nvr:1\nporton nvr:2\n")


def test_camera_errors_never_echo_urls_or_passwords() -> None:
    # Columnas invertidas: el "nombre" es la URL con clave.
    line = f"rtsp://viewer:{FAKE_NVR_PASS}@10.0.0.5/x porton\n"
    with pytest.raises(vr.ConfigError) as excinfo:
        vr.parse_cameras_text(line)
    assert FAKE_NVR_PASS not in str(excinfo.value)
    assert "rtsp://" not in str(excinfo.value)
    with pytest.raises(vr.ConfigError) as excinfo:
        vr.parse_cameras_text("porton url:rtsp://viewer:Secr3tFake@10.0.0.5/$x\n")
    assert "Secr3tFake" not in str(excinfo.value)


def test_default_cameras_and_resolution() -> None:
    assert [c.name for c in vr.default_cameras(3)] == ["cam01", "cam02", "cam03"]
    with_nvr = vr.settings_from_env(nvr_env(NVR_CHANNELS="2"))
    assert [c.name for c in vr.resolve_cameras(with_nvr, None)] == ["cam01", "cam02"]
    assert vr.resolve_cameras(vr.settings_from_env({}), None) == []
    assert [c.name for c in vr.resolve_cameras(with_nvr, "solo nvr:5\n")] == ["solo"]


@pytest.mark.parametrize(
    ("spec", "expected"),
    [("1-4", [1, 2, 3, 4]), ("3", [3]), ("5-7,1,6", [1, 5, 6, 7]), (" 2 , 4 ", [2, 4])],
)
def test_channel_spec(spec: str, expected: list[int]) -> None:
    assert vr.parse_channel_spec(spec) == expected


@pytest.mark.parametrize("spec", ["", "0", "1-65", "4-2", "a", "1;2", "1--2"])
def test_channel_spec_errors(spec: str) -> None:
    with pytest.raises(vr.ConfigError):
        vr.parse_channel_spec(spec)


def test_example_files_are_valid() -> None:
    kit = vr.Path(vr.__file__).parent
    values = vr.parse_env_text((kit / "relay.env.example").read_text(encoding="utf-8"))
    settings = vr.settings_from_env(values)
    assert settings.nvr is None and settings.nvr_channels == 11
    assert settings.reader_networks_defaulted is True
    assert vr.parse_cameras_text((kit / "cameras.conf.example").read_text(encoding="utf-8")) == []
    # Las líneas de ejemplo, descomentadas, también son válidas.
    example = (kit / "cameras.conf.example").read_text(encoding="utf-8")
    after_marker = example.split("# Ejemplo", 1)[1].splitlines()[1:]
    uncommented = "\n".join(line[2:] for line in after_marker if line.startswith("# "))
    assert [c.name for c in vr.parse_cameras_text(uncommented)] == ["porton", "puerta", "prueba"]


def test_kit_sources_have_no_invisible_characters() -> None:
    # Un BOM o un U+2028 literal en el código se vuelve invisible al revisar.
    kit = vr.Path(vr.__file__).parent
    suspects = {chr(0xFEFF), chr(0x2028), chr(0x2029), chr(0x00A0)}
    for path in [kit / "vigilia_relay.py", kit / "netwatch.sh", kit / "install.sh", *sorted((kit / "tests").glob("*.py"))]:
        text = path.read_text(encoding="utf-8")
        assert not suspects & set(text), path.name


def test_version_file_matches_cli() -> None:
    version = (vr.Path(vr.__file__).parent / "VERSION").read_text(encoding="utf-8").strip()
    assert version == vr.KIT_VERSION
