"""Puntaje y parseo de `tools/replay_eval.py` (la parte pura, sin video ni modelos)."""
from pathlib import Path

import pytest

from lpr.tools import replay_eval as ev

GT = [
    ev.GtRow('c1', 10.0, 16.0, 'BBCD12', 'alta', 'entry'),
    ev.GtRow('c1', 20.0, 24.0, 'BKZT21', 'media', 'exit'),
    ev.GtRow('c1', 30.0, 31.0, '(no es patente)', 'no-placa'),
    ev.GtRow('c1', 40.0, 42.0, '', 'ilegible'),
    ev.GtRow('c2', 10.0, 16.0, 'PGHZ30', 'alta'),
]


def _em(clip, t, text, direction='unknown'):
    return ev.Emission(clip=clip, t=t, text=text, direction=direction)


def test_correcta_incorrecta_y_sin_lectura():
    sc = ev.score([_em('c1', 13, 'BBCD12', 'entry'), _em('c1', 22, 'BKZT2A')], GT)
    assert (sc.n_real, sc.correct, sc.wrong, sc.missed) == (3, 1, 1, 1)
    # por defecto el reporte enmascara las patentes (AB**12), no las imprime
    assert 'BK**2A' in sc.wrong_detail[0] and 'BK**21' in sc.wrong_detail[0]
    assert 'BKZT2A' not in sc.wrong_detail[0] and 'BKZT21' not in sc.wrong_detail[0]
    assert sc.latencies == [3.0]
    assert (sc.direction_ok, sc.direction_total) == (1, 1)


def test_una_lectura_mala_junto_a_la_buena_sigue_contando_como_incorrecta():
    sc = ev.score([_em('c1', 12, 'BBCD12'), _em('c1', 14, 'BBCD1Z')], GT)
    assert sc.correct == 1 and sc.wrong == 1


def test_emision_en_falso_positivo_ilegible_o_huerfana_es_extra():
    sc = ev.score([_em('c1', 30.5, 'XXXX11'), _em('c1', 41, 'YYYY22'), _em('c1', 100, 'ZZZZ33')], GT)
    assert sc.extra == 3 and sc.wrong == 0


def test_margen_alrededor_de_la_ventana_y_clip_correcto():
    assert ev.score([_em('c1', 16.9, 'BBCD12')], GT, margin=1.0).correct == 1
    assert ev.score([_em('c1', 17.5, 'BBCD12')], GT, margin=1.0).correct == 0
    assert ev.score([_em('c2', 13, 'BBCD12')], GT).wrong == 1   # otro clip: la patente no es de ese


def test_direccion_equivocada_se_cuenta():
    sc = ev.score([_em('c1', 13, 'BBCD12', 'exit')], GT)
    assert (sc.direction_ok, sc.direction_total) == (0, 1)


def test_load_gt(tmp_path: Path):
    f = tmp_path / 'gt.csv'
    f.write_text('clip,pasada,t_inicio_s,t_fin_s,entra_sale,patente_real,certeza\n'
                 'clip001,1,34.4,41.0,entra,bkzt21,alta\nclip002,2,86.0,86.8,,(no es patente),no-placa\n',
                 encoding='utf-8')
    rows = ev.load_gt(f)
    assert rows[0].plate == 'BKZT21' and rows[0].direction == 'entry' and rows[0].real
    assert rows[1].real is False and rows[1].direction == ''


def test_parse_zone_y_crop():
    zone = ev.parse_zone('0.1,0.2;0.9,0.2;0.5,0.9|0,0;1,0;1,1')
    assert len(zone) == 2 and zone[0][1] == {'x': 0.9, 'y': 0.2}
    assert ev.parse_zone(None) is None
    with pytest.raises(ValueError):
        ev.parse_zone('0,0;1,1')
    assert ev.parse_crop('60,250,0.8,6') == {
        'min_crop_w': 60, 'max_crop_w': 250, 'min_crop_ratio': 0.8, 'max_crop_ratio': 6.0}
    assert ev.parse_crop('30,,2,12')['max_crop_w'] is None
    with pytest.raises(ValueError):
        ev.parse_crop('1,2')


def test_clip_matches():
    p = Path('cam-clip001-patente+vehiculo.mkv')
    assert ev.clip_matches('clip001', p) and not ev.clip_matches('clip00', p)


def test_show_plates_imprime_las_patentes_completas():
    sc = ev.score([_em('c1', 22, 'BKZT2A'), _em('c1', 100, 'ZZZZ33')], GT, show_plates=True)
    assert 'BKZT2A' in sc.wrong_detail[0] and 'BKZT21' in sc.wrong_detail[0]
    assert 'ZZZZ33' in sc.extra_detail[0]


def test_extras_tambien_van_enmascarados_por_defecto():
    sc = ev.score([_em('c1', 100, 'ZZZZ33')], GT)
    assert 'ZZZZ33' not in sc.extra_detail[0] and 'ZZ**33' in sc.extra_detail[0]


def test_salida_por_defecto_dentro_de_eval_data():
    assert ev.DEFAULT_DATA_DIR.name == 'eval-data' and ev.DEFAULT_DATA_DIR.parent.name == 'lpr'


def test_parse_direction_line():
    assert ev.parse_direction_line(None) is None
    assert ev.parse_direction_line('0.45,0.6;0.85,0.6;left') == {
        'from': {'x': 0.45, 'y': 0.6}, 'to': {'x': 0.85, 'y': 0.6}, 'exitSide': 'left'}
    for bad in ('0.4,0.6;0.8,0.6', '0.4,0.6;0.8,0.6;up', '0.4,0.6;0.41,0.6;left', '1.4,0.6;0.8,0.6;left'):
        with pytest.raises(ValueError):
            ev.parse_direction_line(bad)


def test_direccion_se_desglosa_por_fuente_y_distingue_equivocada_de_unknown():
    gt = [ev.GtRow('c1', 10, 16, 'BBCD12', 'alta', 'entry'),
          ev.GtRow('c1', 20, 26, 'BKZT21', 'alta', 'exit'),
          ev.GtRow('c1', 30, 36, 'PGHZ30', 'alta', 'exit'),
          ev.GtRow('c1', 40, 46, 'KRZT45', 'alta', 'entry')]
    ems = [
        ev.Emission('c1', 12, 'BBCD12', 'entry', direction_source='line'),
        ev.Emission('c1', 22, 'BKZT21', 'entry', direction_source='width'),     # equivocada
        ev.Emission('c1', 32, 'PGHZ30', 'unknown', direction_source='none'),    # unknown
        ev.Emission('c1', 42, 'KRZT45', 'entry', direction_source='motion'),
    ]
    sc = ev.score(ems, gt)
    assert (sc.direction_ok, sc.direction_wrong, sc.direction_unknown, sc.direction_total) == (2, 1, 1, 4)
    assert sc.direction_by_source == {
        'line': {'ok': 1, 'wrong': 0, 'unknown': 0}, 'width': {'ok': 0, 'wrong': 1, 'unknown': 0},
        'none': {'ok': 0, 'wrong': 0, 'unknown': 1}, 'motion': {'ok': 1, 'wrong': 0, 'unknown': 0}}
