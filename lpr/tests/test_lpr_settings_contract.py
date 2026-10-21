"""Contrato compartido de `lprSettings` (`contracts/lpr-settings.cases.json`).

Lo mismo que validan el DTO del backend y el zod del frontend, visto desde el
worker: cada caso `valid` debe aplicarse tal cual y de cada caso `invalid` la
clave `offending` NO debe llegar a la config (queda el valor base/env).
"""
import json
from pathlib import Path

import pytest

from lpr.settings import WorkerConfig, apply_camera_settings

# lpr/tests/ -> lpr/ -> raiz del repo: no depende del cwd.
CONTRACT = Path(__file__).resolve().parents[2] / 'contracts' / 'lpr-settings.cases.json'
CASES = json.loads(CONTRACT.read_text(encoding='utf-8'))


@pytest.fixture
def base():
    return WorkerConfig(camera_id='cam-1', backend_url='http://backend.test')


def _expected_fields(settings):
    """Campo(s) de WorkerConfig que deberia fijar cada clave del contrato."""
    expected = {}
    for key, value in settings.items():
        if key == 'action':
            expected['action'] = value
        elif key == 'direction':
            expected['direction'] = value
        elif key == 'zone':
            expected['zone'] = value
        elif key == 'detectorImgsz':
            expected['detector_imgsz'] = value
        elif key == 'sampleFps':
            expected['sample_fps'] = float(value)
        elif key == 'confirmReads':
            expected['confirm_reads'] = value
        elif key == 'crop':
            for ckey, cfield in (('minWidth', 'min_crop_w'), ('maxWidth', 'max_crop_w'),
                                 ('minRatio', 'min_crop_ratio'), ('maxRatio', 'max_crop_ratio')):
                if ckey in value:
                    expected[cfield] = value[ckey]
    return expected


def _fields_of(key):
    if key == 'crop' or key.startswith('crop.'):
        return ['min_crop_w', 'max_crop_w', 'min_crop_ratio', 'max_crop_ratio']
    return {'detectorImgsz': ['detector_imgsz'], 'sampleFps': ['sample_fps', 'poll_interval'],
            'confirmReads': ['confirm_reads']}.get(key, [key])


def test_el_contrato_existe_y_tiene_casos():
    assert len(CASES['valid']) >= 5 and len(CASES['invalid']) >= 10


@pytest.mark.parametrize('case', CASES['valid'], ids=lambda c: c['name'])
def test_casos_validos_se_aplican(base, case):
    cfg = apply_camera_settings(base, case['settings'])
    for field, value in _expected_fields(case['settings']).items():
        assert getattr(cfg, field) == value, f'{case["name"]}: {field}'
    assert cfg.detection_blocked is False
    if not case['settings']:
        assert cfg == base   # vacio = defaults del env


@pytest.mark.parametrize('case', CASES['invalid'], ids=lambda c: c['name'])
def test_clave_ofensora_no_se_aplica(base, case):
    cfg = apply_camera_settings(base, case['settings'])
    offending = case['offending']
    for field in _fields_of(offending):
        if field in WorkerConfig.model_fields:
            assert getattr(cfg, field) == getattr(base, field), f'{case["name"]}: {field} se aplico'
    # lo valido del mismo documento si se aplica (p. ej. action=register con N=11)
    if case['name'] == 'N sobre maximo':
        assert cfg.action == 'register'


def test_reglas_numericas_del_contrato_coinciden_con_el_worker(base):
    rules = CASES['rules']
    assert tuple(rules['detectorImgsz']) == (640, 960, 1280, 1920)
    for imgsz in rules['detectorImgsz']:
        assert apply_camera_settings(base, {'detectorImgsz': imgsz}).detector_imgsz == imgsz
    lo, hi = rules['sampleFps']['min'], rules['sampleFps']['max']
    assert apply_camera_settings(base, {'sampleFps': lo}).sample_fps == lo
    assert apply_camera_settings(base, {'sampleFps': hi}).sample_fps == hi
    assert apply_camera_settings(base, {'sampleFps': hi + 0.1}).sample_fps == base.sample_fps
    n = rules['confirmReads']
    assert apply_camera_settings(base, {'action': 'register', 'confirmReads': n['max']}).confirm_reads == n['max']
    assert apply_camera_settings(base, {'confirmReads': n['minWhenAccess']}).confirm_reads == n['minWhenAccess']
    assert apply_camera_settings(base, {'confirmReads': n['minWhenAccess'] - 1}).confirm_reads == base.confirm_reads


def test_limites_de_la_zona_del_contrato(base):
    zone_rules = CASES['rules']['zone']
    square = [{'x': 0.1, 'y': 0.1}, {'x': 0.9, 'y': 0.1}, {'x': 0.9, 'y': 0.9}]
    assert apply_camera_settings(base, {'zone': [square] * zone_rules['maxPolygons']}).zone is not None
    assert apply_camera_settings(base, {'zone': [square] * (zone_rules['maxPolygons'] + 1)}).zone is None
    big = [{'x': 0.1 + i * 0.001, 'y': 0.1} for i in range(zone_rules['maxPoints'])]
    assert apply_camera_settings(base, {'zone': [big]}).zone == [big]
    assert apply_camera_settings(base, {'zone': [big + [{'x': 0.5, 'y': 0.5}]]}).zone is None


def test_limites_del_recorte_del_contrato(base):
    crop = CASES['rules']['crop']
    ok = apply_camera_settings(base, {'crop': {'minWidth': crop['minWidth']['max'], 'maxWidth': crop['maxWidth']['max']}})
    assert (ok.min_crop_w, ok.max_crop_w) == (crop['minWidth']['max'], crop['maxWidth']['max'])
    over = apply_camera_settings(base, {'crop': {'minWidth': 10, 'maxWidth': crop['maxWidth']['max'] + 1}})
    assert over.max_crop_w == base.max_crop_w
    over = apply_camera_settings(base, {'crop': {'minRatio': 0.05, 'maxRatio': 6}})
    assert over.min_crop_ratio == base.min_crop_ratio
    over = apply_camera_settings(base, {'crop': {'minRatio': 1, 'maxRatio': crop['maxRatio']['max'] + 1}})
    assert over.max_crop_ratio == base.max_crop_ratio
