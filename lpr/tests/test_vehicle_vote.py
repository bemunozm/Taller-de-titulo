"""Voto por VEHICULO en `PlateTracker`: una pista por vehiculo vivo, vehiculo
consumido tras emitir y espera de asentamiento ("settle") del texto.

Todo con `now=` explicito. `paths` = vehiculos vivos (sus llaves) como los entrega
`VehicleTracker.paths()`. Solo patentes sinteticas.
"""
import logging

from lpr.processor.plate_tracker import PlateTracker, TrackObservation
from lpr.utils.direction import DirectionLine

A, B = 'BBCD12', 'BBCD17'    # lectura equivocada (A) y correcta (B) de un mismo auto
FRAME = (1000, 1000)
LINE = DirectionLine(0.2, 0.5, 0.8, 0.5, 'right')


def box(cx, cy, w=60, h=30):
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def obs(vehicle_id, text=A, cx=500, cy=400, ocr=0.9, det=0.8, evidence=None):
    return TrackObservation(box=box(cx, cy), text=text, ocr_conf=ocr, det_conf=det,
                            vehicle_id=vehicle_id, evidence=evidence)


def alive(*ids):
    return {i: [(0.0, 500.0, 400.0)] for i in ids}


def tracker(**kw):
    kw.setdefault('confirm_reads', 3)
    kw.setdefault('max_gap_seconds', 1.5)
    kw.setdefault('min_winner_share', 0.6)
    kw.setdefault('vote_settle_seconds', 1.0)
    return PlateTracker(**kw)


def feed(tr, vehicle_id, texts, start, step=0.1, paths=None, **kw):
    """Una lectura por cuadro del mismo vehiculo; devuelve todas las emisiones."""
    out = []
    for i, text in enumerate(texts):
        out += tr.update([obs(vehicle_id, text, **kw)], now=start + i * step,
                         paths=alive(vehicle_id) if paths is None else paths)
    return out


# --------------------------------------------------------------------------
# Una pista por vehiculo vivo
# --------------------------------------------------------------------------
def test_caso_real_mismo_vehiculo_hueco_largo_y_otra_lectura_emite_una_sola_vez():
    tr = tracker()
    first = feed(tr, 7, [A] * 3, start=0.0)
    assert [e.text for e in first] == [A]
    # la patente desaparece 5 s (> max_gap) con el vehiculo vivo; luego se lee B varias veces
    later = feed(tr, 7, [B] * 4, start=5.0)
    assert later == []
    assert tr.active_tracks == 1


def test_sin_seguimiento_de_vehiculos_el_hueco_cierra_la_pista_como_antes():
    # Control: sin `paths` (no hay vehicle tracker) rige el cierre por hueco y se reemite.
    tr = tracker()
    out = []
    for i, text in enumerate([A] * 3 + [B] * 3):
        t = 0.1 * i if i < 3 else 5.0 + 0.1 * i
        out += tr.update([TrackObservation(box=box(500, 400), text=text, ocr_conf=0.9, det_conf=0.8)], now=t)
    assert [e.text for e in out] == [A, B]


def test_lecturas_sin_vehiculo_no_cambian_aunque_haya_vehiculos_vivos():
    tr = tracker()
    out = []
    for i in range(3):
        out += tr.update([TrackObservation(box=box(500 + i, 400), text=A, ocr_conf=0.9, det_conf=0.8)],
                         now=0.1 * i, paths=alive(9))
    assert [e.text for e in out] == [A] and out[0].vehicle_id is None


def test_dos_vehiculos_simultaneos_quedan_separados():
    tr = tracker()
    out = []
    for i in range(3):
        out += tr.update([obs(1, A, cx=500), obs(2, B, cx=540)], now=0.1 * i, paths=alive(1, 2))
    assert sorted((e.vehicle_id, e.text) for e in out) == [(1, A), (2, B)]
    assert tr.active_tracks == 2


def test_la_pista_se_cierra_cuando_el_vehiculo_deja_de_estar_vivo():
    tr = tracker()
    feed(tr, 7, [A], start=0.0)
    assert tr.active_tracks == 1
    tr.update([], now=0.2, paths=alive(7))
    assert tr.active_tracks == 1
    tr.update([], now=0.3, paths=alive())      # el vehiculo expiro
    assert tr.active_tracks == 0


def test_un_segundo_cuadro_del_mismo_vehiculo_no_vota_dos_veces():
    tr = tracker()
    out = []
    for i in range(2):
        out += tr.update([obs(7, A, det=0.9), obs(7, A, cx=520, det=0.4)], now=0.1 * i, paths=alive(7))
    assert out == []                           # 2 cuadros = 2 lecturas, no 4
    (em,) = tr.update([obs(7, A)], now=0.2, paths=alive(7))
    assert em.reads == 3


def test_caja_led_sin_texto_con_det_alta_no_le_gana_a_la_patente_real():
    tr = tracker()
    out = []
    for i in range(3):
        led = obs(7, None, cx=560, det=0.80, ocr=0.0)
        plate = obs(7, A, cx=500, det=0.40, ocr=0.7)
        out += tr.update([led, plate], now=0.1 * i, paths=alive(7))
    (em,) = out
    assert em.text == A and em.reads == 3


def test_caja_led_con_texto_de_ocr_bajo_y_det_alta_no_le_gana_a_la_patente_real():
    tr = tracker()
    out = []
    for i in range(3):
        led = obs(7, 'CS5333', cx=560, det=0.80, ocr=0.35)
        plate = obs(7, A, cx=500, det=0.40, ocr=0.8)
        out += tr.update([led, plate], now=0.1 * i, paths=alive(7))
    (em,) = out
    assert em.text == A and em.reads == 3


def test_dos_textos_validos_en_un_cuadro_vota_el_de_mayor_ocr_conf():
    tr = tracker()
    out = []
    for i in range(3):
        out += tr.update([obs(7, 'ZZ1234', cx=560, det=0.9, ocr=0.5), obs(7, A, cx=500, det=0.4, ocr=0.9)],
                         now=0.1 * i, paths=alive(7))
    (em,) = out
    assert em.text == A and em.reads == 3


def test_a_igual_ocr_conf_desempata_la_confianza_de_deteccion():
    tr = tracker()
    out = []
    for i in range(3):
        out += tr.update([obs(7, 'ZZ1234', cx=560, det=0.4, ocr=0.8), obs(7, A, cx=500, det=0.9, ocr=0.8)],
                         now=0.1 * i, paths=alive(7))
    (em,) = out
    assert em.text == A


def test_sin_texto_valido_en_el_cuadro_manda_la_deteccion_y_no_vota():
    tr = tracker()
    for i in range(5):
        out = tr.update([obs(7, None, det=0.9, ocr=0.0), obs(7, None, cx=520, det=0.4, ocr=0.99)],
                        now=0.1 * i, paths=alive(7))
        assert out == []
    assert tr.active_tracks == 1


def test_pista_sin_vehiculo_que_luego_recibe_uno_lo_adopta_y_no_duplica():
    tr = tracker()
    tr.update([TrackObservation(box=box(500, 400), text=A, ocr_conf=0.9, det_conf=0.8)], now=0.0, paths=alive(7))
    tr.update([obs(7, A, cx=505)], now=0.1, paths=alive(7))
    (em,) = tr.update([obs(7, A, cx=510)], now=0.2, paths=alive(7))
    assert em.reads == 3 and em.vehicle_id == 7 and tr.active_tracks == 1


def test_pista_sin_vehiculo_cercana_se_fusiona_en_la_del_vehiculo():
    tr = tracker()
    tr.update([obs(7, A, cx=100, cy=100)], now=0.0, paths=alive(7))
    # lectura sin vehiculo lejos de la pista del 7: pista propia
    tr.update([TrackObservation(box=box(900, 500), text=A, ocr_conf=0.9, det_conf=0.8)], now=0.1, paths=alive(7))
    assert tr.active_tracks == 2
    # el vehiculo 7 aparece junto a la pista huerfana: se funden (1 + 1 + 1 lecturas)
    (em,) = tr.update([obs(7, A, cx=880, cy=500)], now=0.2, paths=alive(7))
    assert em.reads == 3 and tr.active_tracks == 1


def test_pista_huerfana_ya_emitida_consume_al_vehiculo_que_aparece_despues():
    tr = tracker()
    out = []
    for i in range(3):
        out += tr.update([TrackObservation(box=box(500 + i, 400), text=A, ocr_conf=0.9, det_conf=0.8)],
                         now=0.1 * i, paths=alive(7))
    assert [e.text for e in out] == [A]
    assert feed(tr, 7, [A, A, A, B, B, B], start=0.3, cx=505) == []


def test_pista_huerfana_emitida_cercana_consume_la_pista_ya_existente_del_vehiculo():
    tr = tracker()
    tr.update([obs(7, A, cx=100, cy=100)], now=0.0, paths=alive(7))        # pista del 7, lejos
    out = []
    for i in range(3):                                                   # pista sin vehiculo que emite
        out += tr.update([TrackObservation(box=box(900 + i, 500), text=A, ocr_conf=0.9, det_conf=0.8)],
                         now=0.1 * (i + 1), paths=alive(7))
    assert [e.text for e in out] == [A]
    # el 7 aparece junto a la pista ya emitida: el vehiculo queda consumido (no se reemite)
    assert feed(tr, 7, [A] * 4, start=0.5, cx=880, cy=500) == []


# --------------------------------------------------------------------------
# Vehiculo consumido
# --------------------------------------------------------------------------
def test_vehiculo_consumido_no_reemite_ni_tras_el_hueco():
    tr = tracker()
    assert len(feed(tr, 7, [A] * 3, start=0.0)) == 1
    assert feed(tr, 7, [A] * 5, start=3.0) == []
    assert feed(tr, 7, [B] * 5, start=10.0) == []


def test_ganador_que_cambia_tras_emitir_avisa_y_no_reenvia(caplog):
    tr = tracker()
    feed(tr, 7, [A] * 3, start=0.0)
    with caplog.at_level(logging.WARNING):
        out = feed(tr, 7, [B] * 6, start=4.0)
    assert out == []
    messages = [r.getMessage() for r in caplog.records if 'posible lectura corregida' in r.getMessage()]
    assert len(messages) == 1                              # una sola vez por vehiculo
    assert A not in messages[0] and B not in messages[0]   # enmascaradas
    assert 'BB**12' in messages[0] and 'BB**17' in messages[0]


def test_no_avisa_si_el_nuevo_ganador_no_llega_a_n_votos_o_a_la_participacion(caplog):
    tr = tracker()
    feed(tr, 7, [A] * 3, start=0.0)
    with caplog.at_level(logging.WARNING):
        feed(tr, 7, [B] * 3, start=4.0, ocr=0.95)          # B gana el voto con 3 votos pero participacion 0.51
    assert not [r for r in caplog.records if 'posible lectura corregida' in r.getMessage()]


# --------------------------------------------------------------------------
# Texto decidido al emitir + ventana de asentamiento
# --------------------------------------------------------------------------
def test_mayoria_correcta_dentro_de_la_ventana_gana_con_su_mejor_evidencia():
    tr = tracker()
    # A llega a 3 votos con participacion 0.75 (< 0.8): se confirma pero espera
    out = []
    for i, (text, frame) in enumerate([(A, 'fA1'), (B, 'fB0'), (A, 'fA2'), (A, 'fA3')]):
        out += tr.update([obs(7, text, ocr=0.9, evidence=frame)], now=0.1 * i, paths=alive(7))
    assert out == []
    # durante la espera llegan lecturas de B, una con la mejor confianza
    for i, (conf, frame) in enumerate([(0.9, 'fB1'), (0.95, 'fB-best'), (0.9, 'fB3'), (0.9, 'fB4')]):
        out += tr.update([obs(7, B, ocr=conf, evidence=frame)], now=0.4 + 0.1 * i, paths=alive(7))
    assert out == []                                       # B 5 votos / 0.65 de participacion: aun < 0.8
    (em,) = tr.update([], now=1.3, paths=alive(7))         # vence la ventana de 1 s (desde t=0.3)
    assert em.text == B and em.votes == 5 and em.settled is True
    assert em.evidence == 'fB-best'                        # la evidencia es la del texto FINAL
    assert em.track_meta()['settled'] is True


def test_si_al_confirmar_la_participacion_es_alta_no_hay_espera():
    tr = tracker()
    out = feed(tr, 7, [A] * 3, start=0.0)                  # participacion 1.0
    assert len(out) == 1 and out[0].settled is False


def test_la_espera_termina_antes_si_la_participacion_sube_a_0_8():
    tr = tracker()
    feed(tr, 7, [A, B, A, A], start=0.0)                   # 0.75: espera
    out = feed(tr, 7, [A, A, A], start=0.4)                # con la 1a: 4 de 5 => 0.8, emite ya
    assert len(out) == 1 and out[0].text == A and out[0].settled is True
    assert out[0].votes == 4 and out[0].reads == 5


def test_la_espera_vence_a_la_ventana_si_nadie_mejora_la_participacion():
    tr = tracker()
    feed(tr, 7, [A, B, A, A], start=0.0)                   # confirmado en t=0.3
    assert tr.update([], now=1.2, paths=alive(7)) == []    # 0.9 s despues: aun espera
    (em,) = tr.update([], now=1.3, paths=alive(7))
    assert em.text == A and em.settled is True


def test_con_settle_en_cero_emite_al_confirmar():
    tr = tracker(vote_settle_seconds=0.0)
    out = feed(tr, 7, [A, B, A, A], start=0.0)
    assert len(out) == 1 and out[0].settled is False


def test_si_el_vehiculo_deja_de_estar_vivo_durante_la_espera_emite_lo_que_hay():
    tr = tracker()
    feed(tr, 7, [A, B, A, A], start=0.0)
    (em,) = tr.update([], now=0.5, paths=alive())          # el vehiculo expiro
    assert em.text == A


def test_la_espera_de_asentamiento_convive_con_la_de_direccion():
    # Direccion sin resolver (el auto no cruza): manda el plazo mayor (4 s), no el de 1 s.
    tr = tracker(direction='both', direction_wait_seconds=4.0, direction_line=LINE)
    still = {7: [(0.0, 500.0, 400.0), (0.1, 500.0, 400.0)]}
    out = []
    for i, text in enumerate([A, B, A, A]):
        out += tr.update([obs(7, text)], now=0.1 * i, paths=still, frame_size=FRAME)
    assert out == []
    assert tr.update([], now=2.0, paths=still, frame_size=FRAME) == []   # asentado, direccion pendiente
    assert tr.update([], now=3.2, paths=still, frame_size=FRAME) == []
    (em,) = tr.update([], now=4.4, paths=still, frame_size=FRAME)        # plazo de direccion (3 + 4 -> 0.3 + 4)
    assert em.text == A


def test_la_direccion_resuelta_no_salta_la_espera_de_asentamiento():
    tr = tracker(direction='both', direction_wait_seconds=4.0, direction_line=LINE)
    crossed = {7: [(0.0, 500.0, 300.0), (0.1, 500.0, 400.0), (0.2, 500.0, 550.0), (0.3, 500.0, 600.0)]}
    out = []
    for i, text in enumerate([A, B, A, A]):
        out += tr.update([obs(7, text)], now=0.1 * i, paths=crossed, frame_size=FRAME)
    assert out == []                                       # direccion lista, texto sin asentar
    (em,) = tr.update([], now=1.3, paths=crossed, frame_size=FRAME)
    assert em.direction_source == 'line'


# --------------------------------------------------------------------------
# Telemetria (meta.track)
# --------------------------------------------------------------------------
def test_meta_track_lleva_vehicle_uid_ids_crudos_reads_y_settled():
    tr = tracker()
    out = []
    for i in range(3):
        out += tr.update([obs(7, A)], now=0.1 * i, paths=alive(7), raw_ids={7: (7, 11)})
    (em,) = out
    meta = em.track_meta()
    assert meta['vehicle_id'] == 7 and meta['vehicle_uid'] == 7
    assert meta['vehicle_ids'] == [7, 11] and meta['reads'] == 3 and meta['settled'] is False
    assert {'id', 'votes', 'winner_share'} <= set(meta)    # claves previas intactas


def test_meta_track_sin_vehiculo_no_lleva_claves_de_vehiculo():
    tr = tracker()
    out = []
    for i in range(3):
        out += tr.update([TrackObservation(box=box(500, 400), text=A, ocr_conf=0.9, det_conf=0.8)], now=0.1 * i)
    meta = out[0].track_meta()
    assert 'vehicle_uid' not in meta and 'vehicle_ids' not in meta and meta['settled'] is False


# --------------------------------------------------------------------------
# Las lecturas de la espera de direccion votan (o no, con freeze_text_after_settle)
# --------------------------------------------------------------------------
def _wait_for_direction(**kw):
    tr = tracker(direction='both', direction_wait_seconds=4.0, direction_line=LINE, **kw)
    still = {7: [(0.0, 500.0, 400.0), (0.1, 500.0, 400.0)]}      # el auto no cruza la linea
    out = []
    for i, text in enumerate([A] * 3 + [B] * 6):
        out += tr.update([obs(7, text)], now=0.1 * i, paths=still, frame_size=FRAME)
    assert out == []                                             # sigue esperando la direccion
    return tr.update([], now=4.3, paths=still, frame_size=FRAME)


def test_sin_freeze_las_lecturas_de_la_espera_de_direccion_tambien_votan():
    (em,) = _wait_for_direction()
    assert em.text == B and em.votes == 6


def test_con_freeze_el_texto_se_decide_sin_las_lecturas_de_la_espera_de_direccion():
    (em,) = _wait_for_direction(freeze_text_after_settle=True)
    assert em.text == A and em.votes == 3 and em.reads == 3


def test_el_defecto_de_settings_es_congelar_y_make_tracker_lo_aplica():
    from types import SimpleNamespace
    from lpr.processor.pipeline import make_tracker
    from lpr.settings import settings

    assert settings.LPR_VOTE_FREEZE_AFTER_SETTLE is True
    cfg = SimpleNamespace(confirm_reads=3, track_max_gap_seconds=1.5, direction='both',
                          min_winner_share=0.6, direction_line=None)
    assert make_tracker(cfg).freeze_text_after_settle is True


# --------------------------------------------------------------------------
# `_ready` con plazo vencido y vehiculos vivos parciales
# --------------------------------------------------------------------------
def _settling_track(tr):
    for i, text in enumerate([A, B, A, A]):                # confirmado con participacion 0.75: espera
        tr.update([obs(7, text)], now=0.1 * i, paths=alive(7))
    (track,) = tr._tracks
    assert track.pending is not None and track.settled
    return track


def test_ready_con_alive_parcial_y_plazo_vencido():
    tr = tracker()
    track = _settling_track(tr)
    assert tr._ready(track, 0.6, alive(7)) is False         # vivo y dentro del plazo: espera
    assert tr._ready(track, 0.6, alive(3, 9)) is True       # vivos parcial sin el 7: no espera
    assert tr._ready(track, 0.6, None) is True              # sin informacion de vivos: no espera
    assert tr._ready(track, 1.4, alive(7)) is True          # plazo vencido (1 s desde t=0.3)


def test_un_vehiculo_que_sale_de_los_vivos_con_la_pista_pendiente_la_emite_y_cierra():
    tr = tracker()
    _settling_track(tr)
    (em,) = tr.update([], now=0.5, paths=alive(3))          # p. ej. reinicio del seguimiento por cambio de fps
    assert em.text == A and tr.active_tracks == 0
