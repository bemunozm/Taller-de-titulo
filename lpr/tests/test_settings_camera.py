"""Configuracion de vision por camara: precedencia del muestreo y fusion de `lprSettings`."""
import logging

import pytest

from lpr.settings import (
    WorkerConfig,
    apply_camera_settings,
    build_worker_config,
    camera_settings_updates,
    resolve_sample_fps,
    settings,
)

ZONE = [[{'x': 0.1, 'y': 0.1}, {'x': 0.9, 'y': 0.1}, {'x': 0.9, 'y': 0.9}]]


@pytest.fixture
def env(monkeypatch):
    """Env limpio: sin fuentes de muestreo configuradas."""
    monkeypatch.setattr(settings, 'LPR_SAMPLE_FPS', None)
    monkeypatch.setattr(settings, 'LPR_POLL_INTERVAL', None)
    return monkeypatch


@pytest.fixture
def base(env):
    return build_worker_config('rtsp://x', 'cam-1', 'http://backend.test', None)


# --- precedencia del muestreo ----------------------------------------------

def test_sin_nada_configurado_son_1_fps(env):
    assert resolve_sample_fps(None) == 1.0


def test_el_argv_del_manager_ahora_se_respeta(env):
    # antes `LPR_POLL_INTERVAL` (default 1.0) tapaba siempre al argv
    assert resolve_sample_fps(0.5) == pytest.approx(2.0)


def test_poll_interval_obsoleto_gana_al_argv(env):
    env.setattr(settings, 'LPR_POLL_INTERVAL', 0.25)
    assert resolve_sample_fps(2.0) == pytest.approx(4.0)


def test_sample_fps_gana_a_todo_lo_demas(env):
    env.setattr(settings, 'LPR_SAMPLE_FPS', 8.0)
    env.setattr(settings, 'LPR_POLL_INTERVAL', 1.0)
    assert resolve_sample_fps(2.0) == 8.0


def test_build_deriva_el_intervalo_del_fps(env):
    env.setattr(settings, 'LPR_SAMPLE_FPS', 4.0)
    cfg = build_worker_config('rtsp://x', 'cam-1', None, None)
    assert cfg.sample_fps == 4.0 and cfg.poll_interval == pytest.approx(0.25)


def test_defaults_globales_equivalen_al_comportamiento_previo(base):
    assert (base.min_crop_w, base.max_crop_w, base.min_crop_h, base.min_crop_area) == (30, None, 10, 300)
    assert (base.min_crop_ratio, base.max_crop_ratio) == (2.0, 12.0)
    assert base.detector_imgsz == 640 and base.confirm_reads == 3
    assert base.device is None and base.ocr_device == 'cpu'
    assert base.zone is None and base.action == 'access' and base.direction == 'unknown'


def test_env_alimenta_la_config(env):
    env.setattr(settings, 'LPR_DETECTOR_IMGSZ', 1280)
    env.setattr(settings, 'LPR_CROP_MAX_W', 250)
    env.setattr(settings, 'LPR_CONFIRM_READS', 5)
    env.setattr(settings, 'LPR_DEVICE', 'cuda:0')
    env.setattr(settings, 'LPR_OCR_DEVICE', 'cuda:0')
    cfg = build_worker_config('rtsp://x', 'cam-1', None, None)
    assert (cfg.detector_imgsz, cfg.max_crop_w, cfg.confirm_reads) == (1280, 250, 5)
    assert cfg.device == 'cuda:0' and cfg.ocr_device == 'cuda:0'


# --- fusion de lprSettings --------------------------------------------------

def test_configuracion_completa_de_la_camara_del_porton(base):
    cfg = apply_camera_settings(base, {
        'action': 'register', 'direction': 'both', 'zone': ZONE, 'detectorImgsz': 1920,
        'sampleFps': 8, 'crop': {'minWidth': 60, 'maxWidth': 250, 'minRatio': 0.8, 'maxRatio': 6},
        'confirmReads': 3,
    })
    assert cfg.action == 'register' and cfg.direction == 'both' and cfg.zone == ZONE
    assert cfg.detector_imgsz == 1920 and cfg.sample_fps == 8.0 and cfg.poll_interval == pytest.approx(0.125)
    assert (cfg.min_crop_w, cfg.max_crop_w, cfg.min_crop_ratio, cfg.max_crop_ratio) == (60, 250, 0.8, 6.0)
    assert cfg.confirm_reads == 3


def test_es_pura_no_muta_la_base(base):
    snapshot = base.model_dump()
    apply_camera_settings(base, {'detectorImgsz': 1920, 'sampleFps': 10})
    assert base.model_dump() == snapshot


def test_sin_settings_devuelve_la_base(base):
    assert apply_camera_settings(base, None) is base
    assert apply_camera_settings(base, {}) is base
    assert apply_camera_settings(base, 'basura') is base


def test_ausente_o_null_significa_default_del_env(base):
    cfg = apply_camera_settings(base, {'detectorImgsz': None, 'sampleFps': None, 'crop': {'minWidth': None}})
    assert cfg == base


def test_solo_pisa_lo_que_viene(base):
    cfg = apply_camera_settings(base, {'confirmReads': 5})
    assert cfg.confirm_reads == 5
    assert cfg.model_copy(update={'confirm_reads': base.confirm_reads}) == base


def test_max_width_null_quita_el_tope_del_env(env):
    env.setattr(settings, 'LPR_CROP_MAX_W', 250)
    cfg = build_worker_config('rtsp://x', 'cam-1', None, None)
    assert apply_camera_settings(cfg, {'crop': {'minWidth': 30, 'maxWidth': None}}).max_crop_w is None
    assert apply_camera_settings(cfg, {'crop': {}}).max_crop_w == 250


def test_zona_vacia_limpia_la_zona(base):
    with_zone = apply_camera_settings(base, {'zone': ZONE})
    assert apply_camera_settings(with_zone, {'zone': []}).zone is None


@pytest.mark.parametrize('settings_dict', [
    {'action': 'delete'}, {'direction': 'sideways'}, {'detectorImgsz': 800}, {'detectorImgsz': True},
    {'sampleFps': 0.5}, {'sampleFps': 99}, {'sampleFps': '8'}, {'confirmReads': 0}, {'confirmReads': 11},
    {'confirmReads': 2.5}, {'crop': 'x'}, {'crop': {'minWidth': -1}}, {'crop': {'minRatio': 0}},
    {'crop': {'maxWidth': 0}},
    # el modo acceso (action ausente) exige al menos 3 lecturas
    {'confirmReads': 1}, {'action': 'access', 'confirmReads': 2},
    # los pares de recorte van completos o no van
    {'crop': {'minRatio': 0.8}}, {'crop': {'maxWidth': 250}}, {'crop': {'minWidth': 60}},
])
def test_valores_invalidos_se_ignoran_sin_lanzar(base, settings_dict, caplog):
    with caplog.at_level(logging.WARNING):
        assert apply_camera_settings(base, settings_dict) == base
    assert 'lprSettings' in caplog.text


def test_valido_e_invalido_juntos_aplican_solo_lo_valido(base):
    cfg = apply_camera_settings(base, {'detectorImgsz': 1280, 'sampleFps': 99})
    assert cfg.detector_imgsz == 1280 and cfg.sample_fps == base.sample_fps


def test_zona_con_un_poligono_roto_conserva_los_buenos(base):
    cfg = apply_camera_settings(base, {'zone': [ZONE[0], [{'x': 0, 'y': 0}]]})
    assert cfg.zone == ZONE


def test_rangos_cruzados_se_descartan(base):
    assert apply_camera_settings(base, {'crop': {'minRatio': 9, 'maxRatio': 3}}) == base
    assert apply_camera_settings(base, {'crop': {'minWidth': 300, 'maxWidth': 100}}) == base


# --- la zona nunca se pierde (SEC) -----------------------------------------

@pytest.mark.parametrize('crop', [
    {'maxRatio': 1.5},                       # incoherente con el min del env (2.0)
    {'maxWidth': 20},                        # incoherente con el min del env (30)
    {'minWidth': 60},
    {'minRatio': 9, 'maxRatio': 3},
    {'minWidth': 300, 'maxWidth': 100},
    {'minRatio': 0.8, 'maxRatio': 6, 'minWidth': 300, 'maxWidth': 100},   # un par bueno, uno malo
])
def test_recorte_incoherente_no_descarta_la_zona_ni_el_resto(base, crop):
    cfg = apply_camera_settings(base, {'zone': ZONE, 'detectorImgsz': 1920, 'crop': crop})
    assert cfg.zone == ZONE and cfg.detector_imgsz == 1920
    assert cfg.detection_blocked is False


def test_solo_se_descartan_las_claves_en_conflicto(base):
    cfg = apply_camera_settings(base, {'zone': ZONE, 'crop': {
        'minRatio': 0.8, 'maxRatio': 6, 'minWidth': 300, 'maxWidth': 100}})
    assert (cfg.min_crop_ratio, cfg.max_crop_ratio) == (0.8, 6.0)               # el par bueno se aplica
    assert (cfg.min_crop_w, cfg.max_crop_w) == (base.min_crop_w, base.max_crop_w)  # el malo vuelve al env
    assert cfg.zone == ZONE


BROKEN_ZONES = [
    'x', [[{'x': 0.1, 'y': 0.1}, {'x': 2.0, 'y': 0.1}, {'x': 0.5, 'y': 0.5}]],
    [[{'x': 0.1, 'y': 0.1}, {'x': 0.2, 'y': 0.2}]], [[{'x': 'a', 'y': 0}] * 3],
    [ZONE[0]] * 21,   # mas poligonos que el maximo del contrato
]


@pytest.mark.parametrize('broken', BROKEN_ZONES)
def test_zona_invalida_conserva_la_ultima_zona_valida(base, broken, caplog):
    previous = apply_camera_settings(base, {'zone': ZONE, 'sampleFps': 4})
    with caplog.at_level(logging.WARNING):
        cfg = apply_camera_settings(base, {'zone': broken, 'sampleFps': 8}, previous=previous)
    assert cfg.zone == ZONE and cfg.detection_blocked is False
    assert cfg.sample_fps == 8.0   # lo demas de la config nueva si se aplica


@pytest.mark.parametrize('broken', BROKEN_ZONES)
def test_zona_invalida_sin_zona_previa_es_fail_closed(base, broken, caplog):
    with caplog.at_level(logging.ERROR):
        cfg = apply_camera_settings(base, {'zone': broken, 'sampleFps': 8}, previous=base)
    assert cfg.zone is None and cfg.detection_blocked is True
    assert cfg.sample_fps == 8.0
    assert 'fail-closed' in caplog.text
    # sin `previous` (primer uso) tambien falla cerrado
    assert apply_camera_settings(base, {'zone': broken}).detection_blocked is True


def test_fail_closed_se_mantiene_hasta_recibir_una_zona_valida(base):
    blocked = apply_camera_settings(base, {'zone': 'x'}, previous=base)
    assert apply_camera_settings(base, {'zone': 'x'}, previous=blocked).detection_blocked is True
    fixed = apply_camera_settings(base, {'zone': ZONE}, previous=blocked)
    assert fixed.zone == ZONE and fixed.detection_blocked is False
    # si el backend quita la zona a proposito (sin clave o []), vuelve al cuadro completo
    assert apply_camera_settings(base, {}, previous=blocked).detection_blocked is False
    assert apply_camera_settings(base, {'zone': []}, previous=blocked).detection_blocked is False


def test_previous_no_se_muta(base):
    previous = apply_camera_settings(base, {'zone': ZONE})
    snapshot = previous.model_dump()
    apply_camera_settings(base, {'zone': 'x'}, previous=previous)
    assert previous.model_dump() == snapshot


# --- minimos en modo acceso -------------------------------------------------

def test_modo_acceso_exige_al_menos_tres_lecturas(base):
    assert apply_camera_settings(base, {'confirmReads': 2}).confirm_reads == base.confirm_reads
    assert apply_camera_settings(base, {'action': 'access', 'confirmReads': 1}).confirm_reads == base.confirm_reads
    assert apply_camera_settings(base, {'confirmReads': 3}).confirm_reads == 3
    assert apply_camera_settings(base, {'confirmReads': 7}).confirm_reads == 7


def test_modo_registrar_puede_bajar_de_tres_lecturas(base):
    assert apply_camera_settings(base, {'action': 'register', 'confirmReads': 1}).confirm_reads == 1
    assert apply_camera_settings(base, {'action': 'register', 'confirmReads': 2}).confirm_reads == 2


def test_participacion_minima_del_ganador_por_defecto(base):
    assert base.min_winner_share == 0.6


def test_traduccion_a_campos_de_worker_config():
    updates = camera_settings_updates({'sampleFps': 4, 'crop': {'minWidth': 10, 'maxWidth': 200}})
    assert updates == {'sample_fps': 4.0, 'poll_interval': 0.25, 'min_crop_w': 10, 'max_crop_w': 200}
    assert set(updates) <= set(WorkerConfig.model_fields)
