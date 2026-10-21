"""Encoding, hash, render de la config de MediaMTX y redacción."""

from __future__ import annotations

import json
import re
import time
import urllib.parse

import pytest

from conftest import FAKE_NVR_PASS, FAKE_NVR_PASS_ENCODED, nvr_env
import vigilia_relay as vr

FAKE_HASH = vr.hash_password("fake-reader-password-0123456789")
FAKE_ADMIN_HASH = vr.hash_password("fake-admin-secret-0123456789")


def render(values: dict[str, str], cameras_text: str | None = None) -> dict:
    settings = vr.settings_from_env(values)
    paths = vr.build_paths(settings, vr.resolve_cameras(settings, cameras_text))
    return vr.build_mediamtx_config(settings, paths, reader_hash=FAKE_HASH, admin_hash=FAKE_ADMIN_HASH)


# --- encoding ------------------------------------------------------------------
@pytest.mark.parametrize("value", [FAKE_NVR_PASS, "a b+c", "ñandú", "it's", "x?y&z=1", "[ipv6]", "100%"])
def test_encode_userinfo_only_unreserved_or_escapes(value: str) -> None:
    encoded = vr.encode_userinfo(value)
    assert re.fullmatch(r"(?:[A-Za-z0-9_.~-]|%[0-9A-F]{2})+", encoded), encoded
    assert urllib.parse.unquote(encoded) == value


def test_encode_userinfo_fake_password() -> None:
    encoded = vr.encode_userinfo(FAKE_NVR_PASS)
    assert encoded == FAKE_NVR_PASS_ENCODED
    assert "$" not in encoded


def test_nvr_stream_url_hikvision_channels_and_roundtrip() -> None:
    nvr = vr.NvrSettings("192.0.2.10", 554, "vi@ewer", FAKE_NVR_PASS)
    sub = vr.nvr_stream_url(nvr, 1, "sub")
    assert sub == f"rtsp://vi%40ewer:{FAKE_NVR_PASS_ENCODED}@192.0.2.10:554/Streaming/Channels/102"
    assert vr.nvr_stream_url(nvr, 1, "main").endswith("/Streaming/Channels/101")
    assert vr.nvr_stream_url(nvr, 11, "sub").endswith("/Streaming/Channels/1102")
    assert vr.nvr_stream_url(nvr, 16, "main").endswith("/Streaming/Channels/1601")
    parts = urllib.parse.urlsplit(sub)
    assert parts.hostname == "192.0.2.10"
    assert parts.port == 554
    assert urllib.parse.unquote(parts.username or "") == "vi@ewer"
    assert urllib.parse.unquote(parts.password or "") == FAKE_NVR_PASS


def test_nvr_stream_url_brackets_ipv6() -> None:
    nvr = vr.NvrSettings("fd00::10", 554, "viewer", "fake-pass")
    assert "@[fd00::10]:554/" in vr.nvr_stream_url(nvr, 2, "sub")


def test_hash_password_matches_mediamtx_format() -> None:
    # echo -n hello | openssl dgst -binary -sha256 | openssl base64
    assert vr.hash_password("hello") == "sha256:LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ="
    assert vr.HASH_PATTERN.fullmatch(FAKE_HASH)


def test_invalid_hash_is_rejected() -> None:
    settings = vr.settings_from_env({})
    with pytest.raises(vr.ConfigError, match="reader.hash"):
        vr.build_mediamtx_config(settings, [], reader_hash="sha256:corto", admin_hash=FAKE_ADMIN_HASH)


# --- render ----------------------------------------------------------------------
def test_render_servers_and_auth() -> None:
    config = render(nvr_env())
    assert config["rtsp"] is True
    assert config["rtspTransports"] == ["tcp"]
    assert config["rtspAuthMethods"] == ["basic"]
    assert config["rtspEncryption"] == "no"  # string, no booleano (yaml.v2 + UnmarshalStrict)
    assert config["rtspAddress"] == ":8554"
    assert config["api"] is True
    assert config["apiAddress"] == "127.0.0.1:9997"
    for server in ("webrtc", "hls", "rtmp", "srt", "playback", "metrics", "pprof"):
        assert config[server] is False, server
    assert config["authMethod"] == "internal"
    users = {user["user"]: user for user in config["authInternalUsers"]}
    assert set(users) == {"relay-reader", "vigilia-admin"}  # sin usuario "any"
    assert users["relay-reader"]["permissions"] == [{"action": "read", "path": ""}]
    assert users["relay-reader"]["ips"] == ["100.101.102.103/32", "127.0.0.1/32", "::1/128"]
    assert users["vigilia-admin"]["permissions"] == [{"action": "api", "path": ""}]
    assert users["vigilia-admin"]["ips"] == ["127.0.0.1/32", "::1/128"]
    assert users["relay-reader"]["pass"] == FAKE_HASH
    assert users["vigilia-admin"]["pass"] == FAKE_ADMIN_HASH


def test_render_path_defaults_exactly_as_planned() -> None:
    assert render({})["pathDefaults"] == {
        "sourceOnDemand": True,
        "sourceOnDemandStartTimeout": "15s",
        "sourceOnDemandCloseAfter": "30s",
        "rtspTransport": "tcp",
        "maxReaders": 3,
    }


def test_render_paths_nvr_and_url() -> None:
    config = render(nvr_env(), "porton nvr:3\ntest url:rtsp://10.0.0.5:8554/live\n")
    assert list(config["paths"]) == ["porton", "porton-hd", "test"]
    assert config["paths"]["porton"]["source"].endswith("@192.0.2.10:554/Streaming/Channels/302")
    assert config["paths"]["porton-hd"]["source"].endswith("@192.0.2.10:554/Streaming/Channels/301")
    assert config["paths"]["test"] == {"source": "rtsp://10.0.0.5:8554/live"}
    # Paths estáticos, sin comodín ni regex.
    assert not any(name.startswith("~") or name == "all_others" for name in config["paths"])


def test_render_without_cameras_conf_uses_nvr_channels() -> None:
    config = render(nvr_env(NVR_CHANNELS="3"))
    assert list(config["paths"]) == ["cam01", "cam01-hd", "cam02", "cam02-hd", "cam03", "cam03-hd"]


def test_render_without_nvr_has_no_paths() -> None:
    assert render({})["paths"] == {}


def test_nvr_camera_without_nvr_settings_is_an_error() -> None:
    with pytest.raises(vr.ConfigError, match="set-nvr"):
        render({}, "porton nvr:1\n")


def test_render_defaulted_reader_networks_are_loopback_only() -> None:
    users = {user["user"]: user for user in render({})["authInternalUsers"]}
    assert users["relay-reader"]["ips"] == ["127.0.0.1/32", "::1/128"]


def test_render_sorts_ips_like_mediamtx() -> None:
    # Orden exacto que devolvió la API de MediaMTX v1.15.2 para esta entrada.
    config = render(nvr_env(READER_ALLOWED_IPS="100.90.1.2, 100.101.102.103, fd7a:115c:a1e0::5"))
    users = {user["user"]: user for user in config["authInternalUsers"]}
    assert users["relay-reader"]["ips"] == [
        "100.101.102.103/32",
        "100.90.1.2/32",
        "127.0.0.1/32",
        "::1/128",
        "fd7a:115c:a1e0::5/128",
    ]


def test_canonical_ips_matches_mediamtx_normalization() -> None:
    assert vr.canonical_ips(["FD7A:115C:A1E0:0:0:0:0:5/128", "127.0.0.1", "::1"]) == [
        "127.0.0.1/32",
        "::1/128",
        "fd7a:115c:a1e0::5/128",
    ]
    assert vr.canonical_ips(["no-ip"]) == ["no-ip"]


def test_ip_allowlist_and_dropin() -> None:
    settings = vr.settings_from_env(nvr_env(NVR_HOST="192.0.2.10"))
    cameras = vr.parse_cameras_text(
        "porton nvr:1\nextra url:rtsp://u:p@192.0.2.20:554/x\nip url:rtsp://192.0.2.30/y\nv6 url:rtsp://[2001:DB8::20]/z\n"
    )
    allow = vr.build_ip_allowlist(settings, cameras)
    assert allow == [
        "localhost",
        "192.0.2.10/32",
        "192.0.2.20/32",
        "192.0.2.30/32",
        "2001:db8::20/128",
        "100.64.0.0/10",
        "fd7a:115c:a1e0::/48",
    ]
    text = vr.render_ip_dropin(allow)
    lines = text.splitlines()
    assert "[Service]" in lines
    # Primero el reset (vacío) y después la lista: reemplaza a la de la unidad base.
    assert lines.index("IPAddressAllow=") < lines.index("IPAddressAllow=" + " ".join(allow))


def test_ip_allowlist_without_nvr_cameras_ignores_the_nvr() -> None:
    settings = vr.settings_from_env(nvr_env(NVR_HOST="192.0.2.99"))
    only_url = vr.parse_cameras_text("ip url:rtsp://192.0.2.30/y\n")
    assert vr.build_ip_allowlist(settings, only_url) == ["localhost", "192.0.2.30/32", *vr.TAILSCALE_NETWORKS]
    assert vr.build_ip_allowlist(vr.settings_from_env({}), []) == ["localhost", *vr.TAILSCALE_NETWORKS]


def test_nvr_host_must_be_an_ip() -> None:
    with pytest.raises(vr.ConfigError, match="NVR_HOST no es una IP: usa la IP del equipo"):
        vr.settings_from_env(nvr_env(NVR_HOST="nvr.lan"))


def test_render_custom_ports() -> None:
    config = render({"RTSP_PORT": "28554", "API_PORT": "29997"})
    assert config["rtspAddress"] == ":28554"
    assert config["apiAddress"] == "127.0.0.1:29997"


def test_rendered_text_is_json_with_header_and_no_dollar() -> None:
    config = render(nvr_env(), "porton nvr:1\n")
    text = vr.render_config_text(config)
    assert text.startswith("# Generado por vigilia-relay")
    body = "\n".join(line for line in text.splitlines() if not line.startswith("#"))
    assert json.loads(body) == config
    assert vr.parse_rendered_config(text) == config
    # La clave del NVR tiene '$G1': en `source` MediaMTX lo expandiría.
    assert "$" not in text
    assert FAKE_NVR_PASS not in text
    assert FAKE_NVR_PASS_ENCODED in text


def test_parse_rendered_config_rejects_foreign_files() -> None:
    assert vr.parse_rendered_config("logLevel: info\n") is None
    assert vr.parse_rendered_config("[1, 2]") is None


def test_expectation_from_config_covers_every_rendered_key() -> None:
    config = render(nvr_env(API_PORT="29997"), "porton nvr:1\n")
    expected = vr.ConfigExpectation.from_config(config)
    assert expected.api_port == 29997
    assert {key for key, _ in expected.global_values} == set(config) - {"paths", "pathDefaults"}
    assert {key for key, _ in expected.path_defaults} == set(vr.PATH_DEFAULTS)
    assert [name for name, _ in expected.paths] == ["porton", "porton-hd"]
    assert FAKE_NVR_PASS_ENCODED not in repr(expected)
    assert FAKE_HASH not in repr(expected)


def test_expectation_detects_a_change_only_in_reader_ips() -> None:
    before = vr.ConfigExpectation.from_config(render(nvr_env(READER_ALLOWED_IPS="100.101.102.103")))
    after = vr.ConfigExpectation.from_config(render(nvr_env(READER_ALLOWED_IPS="100.101.102.104")))
    assert before != after


def mediamtx_view(users: list) -> list:
    """Como devuelve MediaMTX v1.15.2 los usuarios: `ips` canónicas y ordenadas como string."""
    return [dict(user, ips=sorted(str(vr.ipaddress.ip_network(ip, strict=False)) for ip in user["ips"])) for user in users]


class StaticApi:
    def __init__(self, config: dict) -> None:
        self.config = config

    def get_json(self, path: str) -> dict:
        if path.startswith("/v3/config/global/get"):
            # La API real devuelve TODAS las claves (también las no renderizadas).
            extra = {"logFile": "mediamtx.log", "hls": False}
            view = {k: v for k, v in self.config.items() if k not in ("paths", "pathDefaults")}
            view["authInternalUsers"] = mediamtx_view(self.config["authInternalUsers"])
            return {**extra, **view}
        if path.startswith("/v3/config/pathdefaults/get"):
            return {"record": False, **self.config["pathDefaults"]}
        return {"items": [{"name": n, "source": s["source"], "record": False} for n, s in self.config["paths"].items()]}


def test_api_state_matches_compares_all_rendered_values() -> None:
    config = render(nvr_env(), "porton nvr:1\n")
    expected = vr.ConfigExpectation.from_config(config)
    assert vr.api_state_matches(StaticApi(config), expected) == (True, "config activa")
    other = render(nvr_env(READER_ALLOWED_IPS="100.101.102.104"), "porton nvr:1\n")
    assert vr.api_state_matches(StaticApi(other), expected)[0] is False
    defaults = dict(config, pathDefaults=dict(config["pathDefaults"], maxReaders=9))
    assert vr.api_state_matches(StaticApi(defaults), expected)[0] is False
    with_unknown = dict(config, unknownKey=1)
    assert vr.api_state_matches(StaticApi(config), vr.ConfigExpectation.from_config(with_unknown))[0] is False


def test_api_state_matches_normalizes_ips_on_both_sides() -> None:
    # Una config escrita a mano o por una versión vieja, con las ips desordenadas
    # y sin prefijo: MediaMTX las devuelve ordenadas, y debe coincidir igual.
    config = render(nvr_env(READER_ALLOWED_IPS="100.90.1.2, fd7a:115c:a1e0::5"))
    messy = json.loads(json.dumps(config))
    messy["authInternalUsers"][0]["ips"] = ["fd7a:115c:a1e0:0:0:0:0:5", "::1", "100.90.1.2", "127.0.0.1/32"]
    assert vr.api_state_matches(StaticApi(config), vr.ConfigExpectation.from_config(messy)) == (True, "config activa")
    other = render(nvr_env(READER_ALLOWED_IPS="100.90.1.3"))
    assert vr.api_state_matches(StaticApi(other), vr.ConfigExpectation.from_config(config))[0] is False


# --- redacción -------------------------------------------------------------------
def test_redactor_literal_plain_encoded_and_lowercase() -> None:
    redact = vr.Redactor([FAKE_NVR_PASS])
    lowercase = FAKE_NVR_PASS_ENCODED.replace("%3A", "%3a").replace("%2F", "%2f")
    for text in (FAKE_NVR_PASS, FAKE_NVR_PASS_ENCODED, lowercase, urllib.parse.quote_plus(FAKE_NVR_PASS)):
        assert FAKE_NVR_PASS not in redact(f"error con {text} al final")
        assert "Fake" not in redact(f"error con {text} al final", scrub_urls=False)


def test_redactor_urls_userinfo_and_quoted_source() -> None:
    redact = vr.Redactor()
    assert redact("rtsp://admin:otra@10.0.0.5:554/Streaming/Channels/102: 401") == "rtsp://[redacted] 401"
    assert redact("abrir rtsp://10.0.0.5:554/Streaming/Channels/102?user=a&password=b") == "abrir rtsp://10.0.0.5:554/***?***"
    assert redact("invalid source: 'rtsp//admin:secreta@x'") == "invalid source: '[redacted]'"
    assert redact("palabra admin:secreta@10.0.0.5 suelta") == "palabra [redacted] suelta"
    assert redact("http://127.0.0.1:9997/v3/config/global/get") == "http://127.0.0.1:9997/***"
    assert redact("rtsp://[fd00::1]:554/x") == "rtsp://[fd00::1]:554/***"
    assert redact("rtsp://host:99999/x") == "rtsp://[redacted]"


def test_redactor_url_with_unencoded_password_hides_everything() -> None:
    # Una clave con '/' o '@' sin codificar haría que parte pareciera el host.
    out = vr.Redactor()("rtsp://viewer:a/b@c@10.0.0.5:554/x")
    assert "a/b" not in out and "10.0.0.5" not in out


def test_redactor_short_secrets_are_not_literal_replaced() -> None:
    assert vr.Redactor(["abc"])("abc abc") == "abc abc"


def test_bound_text_head_and_tail() -> None:
    text = "inicio " + "x" * 3000 + " final"
    head = vr.bound_text(text)
    assert head.startswith("inicio") and head.endswith("[…]") and len(head) <= vr.MAX_REDACTION_INPUT
    tail = vr.bound_text(text, keep="tail")
    assert tail.endswith("final") and tail.startswith("[…]") and len(tail) <= vr.MAX_REDACTION_INPUT
    assert vr.bound_text("corto") == "corto"


def test_bound_then_scrub_never_leaves_a_partial_url() -> None:
    # Un corte en mitad de la URL dejaría `...clave@host` sin esquema.
    text = "x " * 900 + "rtsp://viewer:" + "p" * 400 + "@10.0.0.5/x"
    out = vr.Redactor()(text)
    assert "@10.0.0.5" not in out


@pytest.mark.parametrize("size", [100_000, 1_000_000])
@pytest.mark.parametrize("unit", [":", "a:", "rtsp://", "a@", ":@", "source '", "%41"])
def test_redactor_is_fast_on_adversarial_input(size: int, unit: str) -> None:
    redact = vr.Redactor([FAKE_NVR_PASS])
    text = unit * (size // len(unit))
    start = time.perf_counter()
    redact(text)
    redact(text, keep="tail")
    assert time.perf_counter() - start < 0.2
