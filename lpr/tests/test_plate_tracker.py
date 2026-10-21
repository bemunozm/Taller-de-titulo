"""Tracker de patentes: asociacion entre frames, voto y una emision por vehiculo."""
import pytest

from lpr.processor.plate_tracker import (
    DIRECTION_ENTRY,
    DIRECTION_EXIT,
    DIRECTION_UNKNOWN,
    PlateTracker,
    TrackObservation,
    infer_direction,
)


def box(cx, cy, w=60, h=30):
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def obs(cx, cy, text='BBCD12', ocr=0.9, det=0.8, w=60):
    return TrackObservation(box=box(cx, cy, w=w), text=text, ocr_conf=ocr, det_conf=det)


def test_emite_una_sola_vez_al_llegar_a_n_lecturas():
    tr = PlateTracker(confirm_reads=3)
    assert tr.update([obs(500, 500)], now=0.0) == []
    assert tr.update([obs(505, 500)], now=0.1) == []
    (em,) = tr.update([obs(510, 500)], now=0.2)
    assert em.text == 'BBCD12' and em.reads == 3 and em.votes == 3
    # el mismo vehiculo sigue frente a la camara: no vuelve a emitir
    for i in range(3, 12):
        assert tr.update([obs(510 + i, 500)], now=0.1 * i) == []


def test_lecturas_distintas_no_suman_entre_si():
    tr = PlateTracker(confirm_reads=3)
    out = []
    for i, text in enumerate(['AAAA11', 'BBBB22', 'CCCC33', 'DDDD44']):
        out += tr.update([obs(500 + i, 500, text=text)], now=0.1 * i)
    assert out == []


def test_voto_pondera_por_confianza_y_exige_n_del_ganador():
    tr = PlateTracker(confirm_reads=3)
    seq = [('BBCD12', 0.9), ('BBCD12', 0.9), ('BBCD18', 0.5), ('BBCD12', 0.8)]
    out = []
    for i, (text, conf) in enumerate(seq):
        out += tr.update([obs(500 + i, 500, text=text, ocr=conf)], now=0.1 * i)
    (em,) = out
    assert em.text == 'BBCD12'
    assert em.reads == 4 and em.votes == 3
    assert em.winner_share == pytest.approx(2.6 / 3.1, abs=1e-6)
    assert em.track_meta() == {'id': em.track_id, 'reads': 4, 'votes': 3, 'winner_share': 0.839}


def test_lectura_invalida_mantiene_vivo_el_track_pero_no_vota():
    tr = PlateTracker(confirm_reads=2)
    tr.update([obs(500, 500)], now=0.0)
    tr.update([obs(505, 500, text=None)], now=0.5)
    # si la invalida hubiera abierto otro track, esta lectura seria la primera de ese otro
    (em,) = tr.update([obs(510, 500)], now=1.0)
    assert em.reads == 2 and tr.active_tracks == 1


def test_el_track_se_cierra_tras_el_hueco_y_el_siguiente_es_otro():
    tr = PlateTracker(confirm_reads=2, max_gap_seconds=1.5)
    tr.update([obs(500, 500)], now=0.0)
    assert tr.update([obs(500, 500)], now=3.0) == []   # hueco de 3 s: track nuevo con 1 lectura
    (em,) = tr.update([obs(500, 500)], now=3.1)
    assert em.track_id == 2 and em.reads == 2


def test_dentro_del_hueco_sigue_siendo_el_mismo_track():
    tr = PlateTracker(confirm_reads=2, max_gap_seconds=1.5)
    tr.update([obs(500, 500)], now=0.0)
    (em,) = tr.update([obs(520, 500)], now=1.2)
    assert em.track_id == 1


def test_dos_vehiculos_simultaneos_emiten_cada_uno_con_su_texto():
    tr = PlateTracker(confirm_reads=3)
    out = []
    for i in range(4):
        out += tr.update([obs(400 + 5 * i, 400, text='AAAA11'), obs(1400 - 5 * i, 800, text='BBBB22')], now=0.1 * i)
    assert sorted(e.text for e in out) == ['AAAA11', 'BBBB22']
    assert len({e.track_id for e in out}) == 2


def test_caja_lejana_abre_un_track_nuevo():
    tr = PlateTracker(confirm_reads=2)
    tr.update([obs(300, 300)], now=0.0)
    assert tr.update([obs(1500, 900)], now=0.1) == []
    assert tr.active_tracks == 2


def test_un_track_toma_a_lo_sumo_una_caja_por_frame():
    tr = PlateTracker(confirm_reads=2)
    tr.update([obs(500, 500)], now=0.0)
    # dos cajas pegadas en el mismo frame: una se asocia, la otra abre su track
    tr.update([obs(505, 500, det=0.9), obs(560, 500, det=0.5)], now=0.1)
    assert tr.active_tracks == 2


def test_reloj_inyectable():
    clock = iter([10.0, 10.1, 10.2])
    tr = PlateTracker(confirm_reads=3, clock=lambda: next(clock))
    assert tr.update([obs(500, 500)]) == []
    assert tr.update([obs(500, 500)]) == []
    assert len(tr.update([obs(500, 500)])) == 1


def test_emision_trae_la_mejor_lectura_ganadora():
    tr = PlateTracker(confirm_reads=3)
    out = []
    for i, conf in enumerate([0.6, 0.95, 0.7]):
        o = obs(500 + i, 500, ocr=conf)
        o.ref = f'read-{i}'
        out += tr.update([o], now=0.1 * i)
    (em,) = out
    assert em.best_ref == 'read-1'
    assert em.ocr_conf == pytest.approx((0.6 + 0.95 + 0.7) / 3)


# --- direccion --------------------------------------------------------------

def _run(widths, direction='both', n=3):
    tr = PlateTracker(confirm_reads=n, direction=direction)
    out = []
    for i, w in enumerate(widths):
        out += tr.update([obs(500 + i, 500, w=w)], now=0.125 * i)
    return out[0] if out else None


def test_ancho_creciente_es_entrada():
    assert _run([40, 44, 48, 52, 56]).direction == DIRECTION_ENTRY


def test_ancho_decreciente_es_salida():
    assert _run([80, 74, 68, 62, 56]).direction == DIRECTION_EXIT


def test_ancho_estable_es_desconocida():
    assert _run([60, 61, 60, 60, 61]).direction == DIRECTION_UNKNOWN


def test_camara_fija_ignora_la_tendencia():
    assert _run([40, 44, 48], direction='exit').direction == DIRECTION_EXIT
    assert _run([80, 70, 60], direction='entry').direction == DIRECTION_ENTRY


def test_camara_sin_config_no_infiere():
    assert _run([40, 44, 48, 60], direction='unknown').direction == DIRECTION_UNKNOWN


def test_infer_direction_pocas_muestras():
    assert infer_direction([(0, 40.0), (1, 80.0)]) == DIRECTION_UNKNOWN


# --- participacion minima del ganador -----------------------------------------

def _votes(tracker, seq):
    out = []
    for i, (text, conf) in enumerate(seq):
        out += tracker.update([obs(500 + i, 500, text=text, ocr=conf)], now=0.1 * i)
    return out


SPLIT = [('BBCD18', 0.9), ('BBCD19', 0.9), ('BBCD17', 0.9),
         ('BBCD12', 0.9), ('BBCD12', 0.9), ('BBCD12', 0.9)]   # 3 de 6 lecturas: participacion 0.5


def test_sin_participacion_minima_emite_con_n_votos_aunque_esten_divididos():
    (em,) = _votes(PlateTracker(confirm_reads=3), SPLIT)
    assert em.text == 'BBCD12' and em.winner_share == pytest.approx(0.5, abs=1e-6)


def test_participacion_minima_bloquea_el_track_dividido():
    assert _votes(PlateTracker(confirm_reads=3, min_winner_share=0.6), SPLIT) == []


def test_participacion_minima_deja_pasar_cuando_el_ganador_se_impone():
    tr = PlateTracker(confirm_reads=3, min_winner_share=0.6)
    out = _votes(tr, SPLIT)
    assert out == []
    # el vehiculo sigue visible y el ganador acumula lecturas hasta superar el umbral
    for i in range(6, 14):
        out += tr.update([obs(506 + i, 500, text='BBCD12', ocr=0.9)], now=0.1 * i)
    (em,) = out
    assert em.text == 'BBCD12' and em.winner_share >= 0.6


def test_lectura_limpia_no_se_ve_afectada_por_la_participacion_minima():
    tr = PlateTracker(confirm_reads=3, min_winner_share=0.6)
    assert len(_votes(tr, [('BBCD12', 0.9)] * 3)) == 1
